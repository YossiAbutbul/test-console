from fastapi import APIRouter, HTTPException

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
