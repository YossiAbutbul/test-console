"""Routes for the parameter sweep: start, cancel, poll, export.

The sweep owns its own power-sensor and DC-analyzer sessions rather than
borrowing the ones held by `/instruments`. That keeps a sweep reproducible
regardless of what the user connected by hand, and lets the runner close them
when it finishes.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..ble import manager
from ..hw.adapters import KeysightDCPowerAnalyzer, MiniCircuitsPowerMeter
from ..hw.base import CurrentMeter, PowerMeter
from ..sweep import ResultRow, RunStatus, SweepConfig, build_workbook, runner
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

        with handle_driver_errors("sweep start"):
            status = await runner.start(req.config, device, pm, cm)
    except Exception:
        # The runner never took ownership, so nothing else will close these.
        _close_quietly(pm, cm)
        raise

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


@router.get("/export")
async def export() -> Response:
    rows = runner.results()
    if not rows:
        raise HTTPException(status_code=404, detail="No results to export")

    with handle_driver_errors("sweep export"):
        # openpyxl rendering is CPU-bound and grows with the row count.
        data = await asyncio.to_thread(build_workbook, rows)

    filename = time.strftime("pa_modes_%Y%m%d_%H%M%S.xlsx")
    return Response(
        content=data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
