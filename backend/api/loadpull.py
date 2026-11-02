"""Load Pull: the run, and the workbook export.

Filed under `/test` so it shares the frontend's dev-server proxy. The run is
driven here (see loadpull/runner.py); the page only starts it, watches it and
answers its attenuator prompts. The export still takes its rows with the
request: the page holds the table, including rows a Continue started from.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import motor as motor_svc
from .. import servo as servo_svc
from ..ble import manager
from ..device import MODEM_ON_TIMEOUT_S, TX_POWER_SCALE, LteTstrfCmd, PaMode
from ..device.device import Device
from ..loadpull import (
    LoadPullExportRequest, LoadPullMeta, LoadPullRow, build_workbook, parse_workbook,
)
from ..loadpull.models import LoadPullRunConfig, LoadPullStatus, PlanPoint
from ..loadpull.runner import runner
from ..workbook import export_filename
from .errors import handle_driver_errors
from .instruments import measure as instruments_measure
from .instruments._state import state
from .instruments.network_analyzer import (
    FreqRequest, MeasureRequest, measure as vna_measure, set_freq as vna_set_freq,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test/load-pull", tags=["load-pull"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

#: A load pull is positions x frequencies x powers; tens of thousands of rows
#: would already be an unusable spreadsheet.
MAX_ROWS = 100_000


#: The test slug in export filenames -- see `export_filename`. LTE runs get
#: their own, so the two radios' files do not read as one test.
EXPORT_SLUG = "load-pull"
LTE_EXPORT_SLUG = "lte-load-pull"


def _with_rig(meta: LoadPullMeta | None) -> LoadPullMeta:
    """Fill in the bench from what this process holds, where the client left it.

    The run loop is in the browser, but the instrument sessions it measured
    through are the ones `/instruments` keeps here, so the backend is the side
    that can name them. Read from the holder only -- no instrument is queried.
    Anything the client did send wins: it was there for the run.
    """
    meta = meta or LoadPullMeta()
    ble = manager.status()
    # The connected device's name only describes the file's DUT if it *is* that
    # DUT -- the operator may have moved on to the next board before exporting.
    same_dut = meta.dut_mac is None or (ble.address or "").lower() == meta.dut_mac.lower()
    fill = {
        "dut_mac": ble.address,
        "dut_name": ble.name if same_dut else None,
        "power_sensor_idn": state.power_sensor_idn if state.power_sensor is not None else None,
        "dc_analyzer_idn": state.dc_analyzer_idn if state.dc_analyzer is not None else None,
        "dc_analyzer_address": state.dc_analyzer_resource if state.dc_analyzer is not None else None,
        "dc_channel": state.dc_analyzer_channel if state.dc_analyzer is not None else None,
    }
    return meta.model_copy(update={
        k: v for k, v in fill.items() if getattr(meta, k) is None and v is not None
    })


@router.post("/export")
async def export(req: LoadPullExportRequest) -> Response:
    if not req.rows:
        raise HTTPException(status_code=400, detail="No results to export")
    if len(req.rows) > MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"Too many rows (max {MAX_ROWS})")

    # A request without meta still gets no Run sheet, as before: it is the
    # client saying it has nothing to record, not an invitation to invent one.
    meta = _with_rig(req.meta) if req.meta is not None else None

    with handle_driver_errors("load pull export"):
        # openpyxl rendering is CPU-bound and grows with the row count.
        data = await asyncio.to_thread(build_workbook, req.rows, meta)

    slug = LTE_EXPORT_SLUG if meta is not None and meta.radio == "LTE" else EXPORT_SLUG
    filename = export_filename(meta.dut_mac if meta else manager.status().address, slug, "xlsx")
    return Response(
        content=data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


#: A Load Pull workbook is a few thousand rows at most.
MAX_IMPORT_BYTES = 25 * 1024 * 1024


@router.post("/import", response_model=list[LoadPullRow])
async def import_xlsx(request: Request) -> list[LoadPullRow]:
    """Read a previously exported workbook back into rows.

    Raw body rather than a multipart upload: that needs no `python-multipart`
    dependency, and the client has a single file to send.
    """
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="No file received")
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    try:
        return await asyncio.to_thread(parse_workbook, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read the workbook: {e}") from e


# ---------- The run ----------

#: Per-point LTE CW duration, a backstop only: each point is aborted as soon as
#: it has measured. Mirrors CW_TIME_MS on the LTE CW sweep.
LTE_CW_TIME_MS = 20_000

#: Longest a trombone move may take before the point fails. Mirrors
#: MOTOR_WAIT_TIMEOUT_MS in frontend/src/tests/loadPull/useTromboneJog.ts.
MOTOR_WAIT_S = 60.0
_MOTOR_POLL_S = 0.15


class LiveRig:
    """The bench, through the same calls its routes make.

    The DUT is looked up per command rather than held: the BLE manager builds a
    new Device when it reconnects, and the one a run started with stays bound
    to the dead client for good (see _send_cw in sweep/runner.py).
    """

    def __init__(self) -> None:
        #: The LTE point last keyed, so the end of the run can abort it.
        self._live: Optional[PlanPoint] = None

    @staticmethod
    def _device() -> Device:
        dev = manager.device
        if dev is None:
            raise RuntimeError("DUT not connected")
        return dev

    async def move(self, pos: int) -> None:
        await asyncio.to_thread(motor_svc.move, pos, True)

    async def wait_motor_idle(self, cancel: asyncio.Event) -> None:
        t0 = time.monotonic()
        # The move has to register before "not moving" means "arrived".
        await asyncio.sleep(0.12)
        while time.monotonic() - t0 < MOTOR_WAIT_S:
            if cancel.is_set():
                return
            s = await asyncio.to_thread(motor_svc.read_status)
            if not s.get("moving"):
                return
            await asyncio.sleep(_MOTOR_POLL_S)
        raise RuntimeError("motor move timed out")

    async def travel_limits(self, lo: int, hi: int) -> None:
        await asyncio.to_thread(motor_svc.set_limits, lo, hi)

    async def motor_stop(self) -> None:
        await asyncio.to_thread(motor_svc.stop)

    async def switch(self, target: str) -> None:
        await asyncio.to_thread(servo_svc.goto, target)

    async def vna_span(self, start_hz: int, stop_hz: int) -> None:
        await vna_set_freq(FreqRequest(start_hz=start_hz, stop_hz=stop_hz))

    async def vna_read(self, hz: int) -> Optional[dict]:
        m = await vna_measure(MeasureRequest(markers=[hz]))
        return m.markers[0].model_dump() if m.markers else None

    async def _send(self, send):
        """A DUT command, resent once on the new link if the old one dropped."""
        dev = self._device()
        try:
            return await send(dev)
        except Exception as e:
            log.warning("DUT command failed (%s: %s); checking the BLE link", type(e).__name__, e)
            fresh = await manager.wait_for_device(dev)
            return await send(fresh or self._device())

    async def tx_on(self, config: LoadPullRunConfig, point: PlanPoint):
        if config.radio == "LoRa":
            return await self._send(lambda d: d.lora_power(
                freq_hz=round(point.freq_mhz * 1_000_000), power_dbm=int(point.power_dbm),
                pa_mode=PaMode(config.pa_mode), timeout=config.cmd_timeout_s,
            ))
        r = await self._send(lambda d: d.lte_cw(
            earfcn=point.earfcn or 0, time_ms=LTE_CW_TIME_MS,
            tx_power=round(point.power_dbm * TX_POWER_SCALE), offset_hz=0,
            tstrf_cmd=LteTstrfCmd.START_TX_TEST, timeout=config.cmd_timeout_s,
        ))
        if r.ok:
            self._live = point
        return r

    async def tx_off(self, config: LoadPullRunConfig, point: PlanPoint) -> None:
        dev = self._device()
        if config.radio == "LoRa":
            await dev.stop_test(timeout=config.cmd_timeout_s)
            return
        # Not tidiness: the modem takes one test at a time and drops a START
        # that arrives while another runs, so an un-aborted point would have
        # every later point silently measure its channel.
        await dev.lte_cw(
            earfcn=point.earfcn or 0, time_ms=LTE_CW_TIME_MS,
            tx_power=round(point.power_dbm * TX_POWER_SCALE), offset_hz=0,
            tstrf_cmd=LteTstrfCmd.ABORT_TEST, timeout=config.cmd_timeout_s,
        )
        self._live = None

    async def measure(self, hz: int):
        m = await instruments_measure(freq_hz=hz)
        return m.power_dbm, m.current_a, m.error

    async def modem_cycle(self) -> None:
        # Down first and unconditionally: nothing reports the modem's power
        # state, and a test left running on it would swallow the first point's
        # START. A refusal most likely means it was already down, which is
        # where this was going.
        try:
            await self._device().lte_modem_off()
        except Exception as e:
            log.warning("LTE modem off (run start) failed: %s", e)
        r = await self._device().lte_modem_on(timeout=MODEM_ON_TIMEOUT_S)
        if not r.ok:
            raise RuntimeError(f"LTE modem did not come up (status {r.status})")

    async def end_run(self, config: LoadPullRunConfig) -> None:
        """Key the DUT down. LTE also powers the modem off: the run owns it
        from its first point to its last, and hands it back off."""
        dev = manager.device
        if dev is None:
            return
        if config.radio == "LoRa":
            await dev.stop_test(timeout=config.cmd_timeout_s)
            return
        if self._live is not None:
            try:
                await self.tx_off(config, self._live)
            except Exception as e:
                log.warning("LTE abort at end of run failed: %s", e)
        await dev.lte_modem_off()


class PromptAnswer(BaseModel):
    seq: int
    proceed: bool
    #: The setting actually dialled in, when it is not the one asked for.
    att_db: Optional[float] = Field(default=None, ge=0)


@router.post("/run", response_model=LoadPullStatus)
async def start_run(config: LoadPullRunConfig) -> LoadPullStatus:
    if manager.device is None:
        raise HTTPException(status_code=409, detail="DUT not connected. Connect first.")
    # A second start while one runs is refused as 409; see handle_driver_errors.
    with handle_driver_errors("load pull start"):
        return await runner.start(config, LiveRig())


@router.get("/status", response_model=LoadPullStatus)
async def run_status() -> LoadPullStatus:
    return runner.status()


@router.get("/rows", response_model=list[LoadPullRow])
async def run_rows(since: int = 0) -> list[LoadPullRow]:
    return runner.rows(max(0, since))


@router.post("/att", response_model=LoadPullStatus)
async def answer_att(req: PromptAnswer) -> LoadPullStatus:
    return runner.answer_prompt(req.seq, req.proceed, req.att_db)


@router.post("/cancel", response_model=LoadPullStatus)
async def cancel_run() -> LoadPullStatus:
    return await runner.cancel()


@router.post("/clear", response_model=LoadPullStatus)
async def clear_run() -> LoadPullStatus:
    with handle_driver_errors("load pull clear"):
        return runner.clear()
