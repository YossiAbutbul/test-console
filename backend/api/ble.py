import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..ble import manager
from ..ble.models import (
    ConnectionStatus,
    ConnectRequest,
    GattService,
    ScannedDevice,
    ScanRequest,
)

router = APIRouter(prefix="/ble", tags=["ble"])


@router.get("/scan", response_model=list[ScannedDevice])
async def scan_get(duration: float = 5.0) -> list[ScannedDevice]:
    try:
        return await manager.scan(duration=duration)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scan", response_model=list[ScannedDevice])
async def scan_post(req: ScanRequest | None = None) -> list[ScannedDevice]:
    duration = req.duration if req else 5.0
    try:
        return await manager.scan(duration=duration)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    try:
        return await manager.connect(req.address, timeout=req.timeout)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/disconnect", response_model=ConnectionStatus)
async def disconnect() -> ConnectionStatus:
    return await manager.disconnect()


@router.get("/status", response_model=ConnectionStatus)
async def status() -> ConnectionStatus:
    return manager.status()


@router.get("/services", response_model=list[GattService])
async def services() -> list[GattService]:
    try:
        return await manager.services()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
