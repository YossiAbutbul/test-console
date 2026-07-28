"""HTTP routes for BLE scan/connect/GATT discovery. Logic in `backend.ble`."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..ble import manager
from ..ble.models import (
    ConnectionStatus,
    ConnectRequest,
    GattService,
    ScannedDevice,
    ScanRequest,
)
from .errors import handle_driver_errors

router = APIRouter(prefix="/ble", tags=["ble"])


@router.get("/scan", response_model=list[ScannedDevice])
async def scan_get(duration: float = 5.0) -> list[ScannedDevice]:
    with handle_driver_errors("ble scan"):
        return await manager.scan(duration=duration)


@router.post("/scan", response_model=list[ScannedDevice])
async def scan_post(req: ScanRequest | None = None) -> list[ScannedDevice]:
    duration = req.duration if req else 5.0
    with handle_driver_errors("ble scan"):
        return await manager.scan(duration=duration)


@router.get("/scan/stream")
async def scan_stream(request: Request, duration: float = 5.0) -> StreamingResponse:
    """Server-Sent Events stream of devices as they are discovered.

    Events:
      - `device`  : payload = ScannedDevice JSON
      - `done`    : payload = {"count": N}
      - `error`   : payload = {"detail": "..."}
    """

    async def gen():
        try:
            yield f"event: start\ndata: {json.dumps({'duration': duration})}\n\n"
            count = 0
            async for dev in manager.scan_stream(duration=duration):
                if await request.is_disconnected():
                    break
                count += 1
                yield f"event: device\ndata: {dev.model_dump_json()}\n\n"
            yield f"event: done\ndata: {json.dumps({'count': count})}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/connect", response_model=ConnectionStatus)
async def connect(req: ConnectRequest) -> ConnectionStatus:
    with handle_driver_errors("ble connect"):
        return await manager.connect(req.address, timeout=req.timeout)


@router.post("/disconnect", response_model=ConnectionStatus)
async def disconnect() -> ConnectionStatus:
    with handle_driver_errors("ble disconnect"):
        return await manager.disconnect()


@router.get("/status", response_model=ConnectionStatus)
async def status() -> ConnectionStatus:
    with handle_driver_errors("ble status"):
        return manager.status()


@router.get("/services", response_model=list[GattService])
async def services() -> list[GattService]:
    with handle_driver_errors("ble services"):
        return await manager.services()
