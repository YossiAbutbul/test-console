"""HTTP routes for the Arduino servo (RF switch). Logic in `backend.servo`."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import servo as svc

router = APIRouter(prefix="/servo", tags=["servo"])


class ServoStatus(BaseModel):
    connected: bool
    port: Optional[str] = None
    idn: Optional[str] = None
    last_angle: Optional[int] = None
    last_command: Optional[str] = None
    last_response: Optional[str] = None
    baud: int = 9600
    error: Optional[str] = None


class ConnectRequest(BaseModel):
    port: str = Field(..., description="Serial port (e.g. COM3, /dev/ttyUSB0)")


class MoveRequest(BaseModel):
    angle: int = Field(..., ge=0, le=180)


class TargetRequest(BaseModel):
    target: str = Field(..., pattern="^(VNA|PCB|vna|pcb)$")


class DiscoverCandidate(BaseModel):
    port: str
    idn: Optional[str] = None


class DiscoverResponse(BaseModel):
    candidates: list[str]
    details: Optional[list[DiscoverCandidate]] = None


def _to_thread(fn, *args, **kwargs):
    return asyncio.to_thread(fn, *args, **kwargs)


async def _status() -> ServoStatus:
    return ServoStatus(**await _to_thread(svc.read_status))


@router.get("/status", response_model=ServoStatus)
async def status() -> ServoStatus:
    return await _status()


@router.get("/discover", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    # List ports only — never open/probe them here. Opening the Arduino during a
    # scan is what wedges the USB-serial driver (PermissionError 13). The IDN is
    # read once at connect and exposed via status afterwards.
    try:
        ports = await _to_thread(svc.discover)
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"discover failed: {e}")
    return DiscoverResponse(
        candidates=ports,
        details=[DiscoverCandidate(port=p, idn=None) for p in ports],
    )


@router.post("/connect", response_model=ServoStatus)
async def connect(req: ConnectRequest) -> ServoStatus:
    try:
        await _to_thread(svc.connect, req.port)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return await _status()


@router.post("/disconnect", response_model=ServoStatus)
async def disconnect() -> ServoStatus:
    await _to_thread(svc.disconnect)
    return ServoStatus(connected=False)


@router.post("/move", response_model=ServoStatus)
async def move(req: MoveRequest) -> ServoStatus:
    try:
        await _to_thread(svc.move_angle, req.angle)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"move failed: {e}")
    return await _status()


@router.post("/goto", response_model=ServoStatus)
async def goto(req: TargetRequest) -> ServoStatus:
    try:
        await _to_thread(svc.goto, req.target)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"goto failed: {e}")
    return await _status()


@router.post("/save", response_model=ServoStatus)
async def save(req: TargetRequest) -> ServoStatus:
    try:
        await _to_thread(svc.save, req.target)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"save failed: {e}")
    return await _status()
