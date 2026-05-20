import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..ble import manager
from ..excel import build_workbook
from ..instruments.base import CurrentMeter, PowerMeter
from ..instruments.real import KeysightDCPowerAnalyzer, MiniCircuitsPowerMeter
from ..test_runner import ResultRow, RunStatus, SweepConfig, runner

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test", tags=["test"])


DEFAULT_DC_RESOURCE = "USB0::0x0957::0x0F07::MY50000200::INSTR"


class StartRequest(BaseModel):
    config: SweepConfig
    power_sensor_serial: str | None = None
    dc_analyzer_resource: str | None = None
    dc_analyzer_channel: int = 3


def _build_power_meter(req: StartRequest) -> PowerMeter:
    return MiniCircuitsPowerMeter(serial=req.power_sensor_serial)


def _build_current_meter(req: StartRequest) -> CurrentMeter:
    resource = req.dc_analyzer_resource or DEFAULT_DC_RESOURCE
    return KeysightDCPowerAnalyzer(
        resource=resource,
        channel=req.dc_analyzer_channel,
    )


@router.post("/run", response_model=RunStatus)
async def start(req: StartRequest) -> RunStatus:
    dev = manager.device
    if dev is None:
        raise HTTPException(
            status_code=409, detail="Device not ready — connect first"
        )

    try:
        pm = _build_power_meter(req)
        cm = _build_current_meter(req)
        pm.connect()
        cm.connect()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Instrument init failed: {type(e).__name__}: {e}"
        )

    try:
        return await runner.start(req.config, dev, pm, cm)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
    data = build_workbook(rows)
    fname = time.strftime("pa_modes_%Y%m%d_%H%M%S.xlsx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
