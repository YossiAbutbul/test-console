from typing import Optional
from pydantic import BaseModel, Field


class ScannedDevice(BaseModel):
    address: str
    name: Optional[str] = None
    rssi: Optional[int] = None
    metadata: dict = Field(default_factory=dict)


class ScanRequest(BaseModel):
    duration: float = Field(default=5.0, ge=0.5, le=60.0)


class ConnectRequest(BaseModel):
    address: str
    timeout: float = Field(default=15.0, ge=1.0, le=60.0)


class ConnectionStatus(BaseModel):
    connected: bool
    address: Optional[str] = None
    name: Optional[str] = None
    transport_ready: bool = False
    transport_error: Optional[str] = None
    write_uuid: Optional[str] = None
    notify_uuid: Optional[str] = None


class GattCharacteristic(BaseModel):
    uuid: str
    properties: list[str]
    handle: Optional[int] = None
    description: Optional[str] = None


class GattService(BaseModel):
    uuid: str
    description: Optional[str] = None
    characteristics: list[GattCharacteristic]


class RelinkRequest(BaseModel):
    # Long enough for a reset (a reboot plus the first advertisement) with
    # room to spare; a tone's own duration is waited out by the caller before
    # it asks. See RELINK_TIMEOUT_S in manager.py.
    timeout: float = Field(default=30.0, ge=1.0, le=120.0)
