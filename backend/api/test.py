"""Routes for the parameter sweep: start, cancel, poll, export.

The sweep owns its own power-sensor and DC-analyzer sessions rather than
borrowing the ones held by `/instruments`. That keeps a sweep reproducible
regardless of what the user connected by hand, and lets the runner close them
when it finishes.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ..ble import manager
from ..hw.adapters import KeysightDCPowerAnalyzer, MiniCircuitsPowerMeter
from ..hw.base import CurrentMeter, PowerMeter
from ..sweep import (
    ResultRow, RunStatus, SweepConfig, build_workbook, parse_workbook, rebuild_workbook,
    runner,
)
from ..sweep.export import run_entry
from ..sweep.models import RigInfo
from ..workbook import export_filename
from .errors import handle_driver_errors
from .instruments._state import state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test", tags=["test"])

DEFAULT_DC_RESOURCE = "USB0::0x0957::0x0F07::MY50000200::INSTR"

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


class StartRequest(BaseModel):
    config: SweepConfig
    power_sensor_serial: str | None = None
    dc_analyzer_resource: str | None = None
    dc_analyzer_channel: int = 3


def _build_power_meter(req: StartRequest) -> PowerMeter:
    # Prefer the session `/instruments` already holds. Opening a second one to
    # the same physical sensor invalidates the live handle, which is exactly
    # what happens when the pre-run check connects it and then the sweep starts.
    if state.power_sensor is not None:
        return MiniCircuitsPowerMeter(session=state.power_sensor)
    return MiniCircuitsPowerMeter(serial=req.power_sensor_serial)


def _build_current_meter(req: StartRequest) -> CurrentMeter:
    if state.dc_analyzer is not None:
        return KeysightDCPowerAnalyzer(
            session=state.dc_analyzer,
            channel=state.dc_analyzer_channel,
        )
    return KeysightDCPowerAnalyzer(
        resource=req.dc_analyzer_resource or DEFAULT_DC_RESOURCE,
        channel=req.dc_analyzer_channel,
    )


#: The rig the last sweep started on, for its export's Run sheet. Kept here
#: rather than looked up at export time: by then the DUT may be disconnected or
#: a different sensor connected, and the file would name the wrong bench.
_last_rig: RigInfo | None = None

#: The test slug in export filenames -- see `export_filename`. It was
#: "pa_modes", which named neither the page nor the test.
EXPORT_SLUG = "power-sweep"


def _capture_rig(req: StartRequest, pm: PowerMeter, cm: CurrentMeter) -> RigInfo:
    """Who and what the sweep is about to measure with. Best-effort throughout:
    a missing IDN must never stop a run, so every lookup falls back to None.

    Borrowed sessions use what `/instruments` recorded when it opened them.
    Sessions the sweep opened itself are asked the same way those routes ask
    (attributes on the driver object, see power_sensor.py and dc_analyzer.py) --
    once, here, before the runner owns them, so nothing shares the session.
    """
    ble = manager.status()

    ps_idn = state.power_sensor_idn if state.power_sensor is not None else None
    if ps_idn is None:
        try:
            from .instruments.power_sensor import _format_idn
            sensor = getattr(pm, "_sensor", None)
            ps_idn = (_format_idn(sensor) or None) if sensor is not None else None
        except Exception as e:  # identity is a nicety, the run is not
            log.debug("power sensor IDN not captured: %s", e)

    if state.dc_analyzer is not None:
        dc_idn = state.dc_analyzer_idn
        dc_address = state.dc_analyzer_resource
        dc_channel = state.dc_analyzer_channel
    else:
        dc_idn = None
        try:
            idn = getattr(getattr(cm, "_analyzer", None), "idn", None)
            dc_idn = str(idn) if idn else None
        except Exception as e:
            log.debug("DC analyzer IDN not captured: %s", e)
        dc_address = req.dc_analyzer_resource or DEFAULT_DC_RESOURCE
        dc_channel = req.dc_analyzer_channel

    return RigInfo(
        dut_mac=ble.address,
        dut_name=ble.name,
        power_sensor_idn=ps_idn,
        power_sensor_address=req.power_sensor_serial or None,
        dc_analyzer_idn=dc_idn,
        dc_analyzer_address=dc_address,
        dc_channel=dc_channel,
    )


def _close_quietly(*instruments: PowerMeter | CurrentMeter | None) -> None:
    for inst in instruments:
        if inst is None:
            continue
        try:
            inst.disconnect()
        except Exception as e:
            log.warning("Instrument disconnect failed: %s", e)


@router.post("/run", response_model=RunStatus)
async def start(req: StartRequest) -> RunStatus:
    device = manager.device
    if device is None:
        raise HTTPException(status_code=409, detail="Device not ready — connect first")

    pm: PowerMeter | None = None
    cm: CurrentMeter | None = None
    try:
        with handle_driver_errors("instrument init"):
            pm = _build_power_meter(req)
            cm = _build_current_meter(req)
            # Opening a VISA/USB session blocks; keep it off the event loop.
            await asyncio.to_thread(pm.connect)
            await asyncio.to_thread(cm.connect)

        try:
            rig = await asyncio.to_thread(_capture_rig, req, pm, cm)
        except Exception as e:
            log.warning("Rig details not captured: %s", e)
            rig = None

        with handle_driver_errors("sweep start"):
            status = await runner.start(req.config, device, pm, cm)
    except Exception:
        # The runner never took ownership, so nothing else will close these.
        _close_quietly(pm, cm)
        raise

    global _last_rig
    _last_rig = rig
    return status


@router.post("/cancel", response_model=RunStatus)
async def cancel() -> RunStatus:
    return await runner.cancel()


@router.get("/status", response_model=RunStatus)
async def status() -> RunStatus:
    return runner.status()


@router.get("/results", response_model=list[ResultRow])
async def results() -> list[ResultRow]:
    return runner.results()


@router.post("/clear", response_model=RunStatus)
async def clear() -> RunStatus:
    # Refusing mid-run surfaces as 409 — see `handle_driver_errors`.
    with handle_driver_errors("sweep clear"):
        return runner.clear()


@router.get("/export")
async def export(operator: str | None = None, notes: str | None = None) -> Response:
    """`operator` and `notes` are optional free text for the Run sheet."""
    rows = runner.results()
    if not rows:
        raise HTTPException(status_code=404, detail="No results to export")

    # Carries the config and timing onto the Run sheet, so a saved workbook says
    # which path loss and settle time produced its numbers.
    status = runner.status()

    rig = (_last_rig or RigInfo(dut_mac=manager.status().address)).model_copy(
        update={"operator": operator or None, "notes": notes or None},
    )

    with handle_driver_errors("sweep export"):
        # openpyxl rendering is CPU-bound and grows with the row count.
        data = await asyncio.to_thread(
            build_workbook, rows, status.config, status.started_at, status.finished_at, rig,
        )

    filename = export_filename(rig.dut_mac, EXPORT_SLUG, "xlsx")
    return Response(
        content=data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


#: Refuse anything implausibly large before openpyxl tries to parse it — a
#: 600-row sweep workbook is well under a megabyte.
MAX_IMPORT_BYTES = 25 * 1024 * 1024


@router.post("/import", response_model=list[ResultRow])
async def import_xlsx(request: Request) -> list[ResultRow]:
    """Read a previously exported workbook back into rows.

    Takes the raw file as the request body rather than a multipart upload: this
    needs no `python-multipart` dependency, and the client has a single file to
    send. The rows are returned to the caller and deliberately *not* loaded into
    the runner — an imported file is someone else's finished run, not this
    process's, and pushing it into the run state would make Export, Clear and
    the status line all lie about what the backend just did.
    """
    data = await _workbook_body(request)
    try:
        # openpyxl parsing is CPU-bound and grows with the row count.
        return await asyncio.to_thread(parse_workbook, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read the workbook: {e}") from e


@router.post("/reexport")
async def reexport_xlsx(request: Request) -> Response:
    """Write an imported workbook back out in the current layout.

    Export proper writes the runner's rows, which are not what is on screen
    while a file is open. This takes the file itself instead, so an old export
    gains the sheets added since (Best settings) and keeps its own Run sheet.
    Like import, it never touches the run state.
    """
    data = await _workbook_body(request)
    try:
        out = await asyncio.to_thread(rebuild_workbook, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read the workbook: {e}") from e

    # The client names the saved file after the one it imported; this is only
    # the fallback. Named after the DUT the file records, when it records one.
    try:
        mac = run_entry(data, "DUT MAC")
    except Exception:
        mac = None
    filename = export_filename(mac if isinstance(mac, str) and mac != "—" else None, EXPORT_SLUG, "xlsx")
    return Response(
        content=out,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _workbook_body(request: Request) -> bytes:
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="No file received")
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    return data
