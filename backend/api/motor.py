"""HTTP routes for the trombone motor. All logic lives in `backend.motor`."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import motor as svc

router = APIRouter(prefix="/motor", tags=["motor"])


class MotorStatus(BaseModel):
    connected: bool
    moving: bool = False
    position: Optional[int] = None
    device_index: Optional[int] = None
    soft_min: int = svc.SOFT_MIN_POS
    soft_max: int = svc.SOFT_MAX_POS
    error: Optional[str] = None


class ConnectRequest(BaseModel):
    device_index: int = Field(default=0, ge=0, le=15)


class MoveRequest(BaseModel):
    position: int = Field(..., description="Target position in pulses")
    absolute: bool = Field(default=True)


class HomeRequest(BaseModel):
    direction: str = Field(..., pattern="^(positive|negative)$")


class DiscoverResponse(BaseModel):
    candidates: list[str]


def _to_thread(fn, *args, **kwargs):
    return asyncio.to_thread(fn, *args, **kwargs)


async def _status() -> MotorStatus:
    return MotorStatus(**await _to_thread(svc.read_status))


@router.get("/status", response_model=MotorStatus)
async def status() -> MotorStatus:
    return await _status()


@router.get("/discover", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    try:
        cands = await _to_thread(svc.discover)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"dmx_j_sa not installed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"discover failed: {e}")
    return DiscoverResponse(candidates=cands)


@router.post("/connect", response_model=MotorStatus)
async def connect(req: ConnectRequest) -> MotorStatus:
    try:
        await _to_thread(svc.connect, req.device_index)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"dmx_j_sa not installed: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return await _status()


@router.post("/disconnect", response_model=MotorStatus)
async def disconnect() -> MotorStatus:
    await _to_thread(svc.disconnect)
    return MotorStatus(connected=False)


@router.post("/move", response_model=MotorStatus)
async def move(req: MoveRequest) -> MotorStatus:
    try:
        await _to_thread(svc.move, req.position, req.absolute)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"move failed: {e}")
    return await _status()


@router.post("/home", response_model=MotorStatus)
async def home(req: HomeRequest) -> MotorStatus:
    try:
        await _to_thread(svc.home, req.direction == "positive")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"home failed: {e}")
    return await _status()


@router.post("/stop", response_model=MotorStatus)
async def stop() -> MotorStatus:
    try:
        await _to_thread(svc.stop)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"stop failed: {e}")
    return await _status()
