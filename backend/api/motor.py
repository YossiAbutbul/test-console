"""HTTP routes for the trombone motor. All logic lives in `backend.motor`."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import motor as svc
from .errors import handle_driver_errors

router = APIRouter(prefix="/motor", tags=["motor"])


class MotorStatus(BaseModel):
    connected: bool
    moving: bool = False
    position: int | None = None
    device_index: int | None = None
    soft_min: int | None = None
    soft_max: int | None = None
    error: str | None = None


class LimitsRequest(BaseModel):
    soft_min: int | None = Field(default=None, description="Min travel limit (pulses); null = unbounded")
    soft_max: int | None = Field(default=None, description="Max travel limit (pulses); null = unbounded")


class ConnectRequest(BaseModel):
    device_index: int = Field(default=0, ge=0, le=15)


class MoveRequest(BaseModel):
    position: int = Field(..., description="Target position in pulses")
    absolute: bool = Field(default=True)


class HomeRequest(BaseModel):
    direction: str = Field(..., pattern="^(positive|negative)$")


class JogRequest(BaseModel):
    positive: bool = Field(..., description="True = jog toward max, False = toward min")
    speed: int | None = Field(default=None, ge=1, le=5000, description="Jog speed (pulses/s)")


class DiscoverResponse(BaseModel):
    candidates: list[str]


async def _status() -> MotorStatus:
    with handle_driver_errors("motor status"):
        return MotorStatus(**await asyncio.to_thread(svc.read_status))


@router.get("/status", response_model=MotorStatus)
async def status() -> MotorStatus:
    return await _status()


@router.get("/discover", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    with handle_driver_errors("motor discover"):
        cands = await asyncio.to_thread(svc.discover)
    return DiscoverResponse(candidates=cands)


@router.post("/connect", response_model=MotorStatus)
async def connect(req: ConnectRequest) -> MotorStatus:
    with handle_driver_errors("motor connect"):
        await asyncio.to_thread(svc.connect, req.device_index)
    return await _status()


@router.post("/disconnect", response_model=MotorStatus)
async def disconnect() -> MotorStatus:
    with handle_driver_errors("motor disconnect"):
        await asyncio.to_thread(svc.disconnect)
    return MotorStatus(connected=False)


@router.post("/move", response_model=MotorStatus)
async def move(req: MoveRequest) -> MotorStatus:
    with handle_driver_errors("motor move"):
        await asyncio.to_thread(svc.move, req.position, req.absolute)
    return await _status()


@router.post("/home", response_model=MotorStatus)
async def home(req: HomeRequest) -> MotorStatus:
    with handle_driver_errors("motor home"):
        await asyncio.to_thread(svc.home, req.direction == "positive")
    return await _status()


@router.post("/limits", response_model=MotorStatus)
async def set_limits(req: LimitsRequest) -> MotorStatus:
    with handle_driver_errors("motor set limits"):
        await asyncio.to_thread(svc.set_limits, req.soft_min, req.soft_max)
    return await _status()


@router.post("/jog/start", response_model=MotorStatus)
async def jog_start(req: JogRequest) -> MotorStatus:
    with handle_driver_errors("motor jog start"):
        await asyncio.to_thread(svc.jog_start, req.positive, req.speed)
    return await _status()


@router.post("/jog/stop", response_model=MotorStatus)
async def jog_stop() -> MotorStatus:
    with handle_driver_errors("motor jog stop"):
        await asyncio.to_thread(svc.jog_stop)
    return await _status()


@router.post("/stop", response_model=MotorStatus)
async def stop() -> MotorStatus:
    with handle_driver_errors("motor stop"):
        await asyncio.to_thread(svc.stop)
    return await _status()
