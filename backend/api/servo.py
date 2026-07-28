"""HTTP routes for the Arduino servo (RF switch). Logic in `backend.servo`."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import servo as svc
from .errors import handle_driver_errors

router = APIRouter(prefix="/servo", tags=["servo"])


class ServoStatus(BaseModel):
    connected: bool
    port: str | None = None
    idn: str | None = None
    last_angle: int | None = None
    last_command: str | None = None
    last_response: str | None = None
    baud: int = 9600
    error: str | None = None


class ConnectRequest(BaseModel):
    port: str = Field(..., description="Serial port (e.g. COM3, /dev/ttyUSB0)")


class MoveRequest(BaseModel):
    angle: int = Field(..., ge=0, le=180)


class TargetRequest(BaseModel):
    target: str = Field(..., pattern="^(VNA|PCB|vna|pcb)$")


class DiscoverCandidate(BaseModel):
    port: str
    idn: str | None = None


class DiscoverResponse(BaseModel):
    candidates: list[str]
    details: list[DiscoverCandidate] | None = None


async def _status() -> ServoStatus:
    with handle_driver_errors("servo status"):
        return ServoStatus(**await asyncio.to_thread(svc.read_status))


@router.get("/status", response_model=ServoStatus)
async def status() -> ServoStatus:
    return await _status()


@router.get("/discover", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    # List ports only — never open/probe them here. Opening the Arduino during a
    # scan is what wedges the USB-serial driver (PermissionError 13). The IDN is
    # read once at connect and exposed via status afterwards.
    with handle_driver_errors("servo discover"):
        ports = await asyncio.to_thread(svc.discover)
    return DiscoverResponse(
        candidates=ports,
        details=[DiscoverCandidate(port=p, idn=None) for p in ports],
    )


@router.post("/connect", response_model=ServoStatus)
async def connect(req: ConnectRequest) -> ServoStatus:
    with handle_driver_errors("servo connect"):
        await asyncio.to_thread(svc.connect, req.port)
    return await _status()


@router.post("/disconnect", response_model=ServoStatus)
async def disconnect() -> ServoStatus:
    with handle_driver_errors("servo disconnect"):
        await asyncio.to_thread(svc.disconnect)
    return ServoStatus(connected=False)


@router.post("/move", response_model=ServoStatus)
async def move(req: MoveRequest) -> ServoStatus:
    with handle_driver_errors("servo move"):
        await asyncio.to_thread(svc.move_angle, req.angle)
    return await _status()


@router.post("/goto", response_model=ServoStatus)
async def goto(req: TargetRequest) -> ServoStatus:
    with handle_driver_errors("servo goto"):
        await asyncio.to_thread(svc.goto, req.target)
    return await _status()


@router.post("/save", response_model=ServoStatus)
async def save(req: TargetRequest) -> ServoStatus:
    with handle_driver_errors("servo save"):
        await asyncio.to_thread(svc.save, req.target)
    return await _status()
