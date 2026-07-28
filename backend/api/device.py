"""HTTP routes for device-under-test RF commands over the BLE transport."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..ble import manager
from ..device import CommandResult, Modem, PaMode
from .errors import handle_driver_errors

router = APIRouter(prefix="/device", tags=["device"])


class LoraCwRequest(BaseModel):
    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF, description="Radio frequency in Hz")
    power_dbm: int = Field(..., ge=0, le=255, description="Transmit power in dBm (positive)")
    pa_duty_cycle: int = Field(..., ge=0, le=255)
    hp_max: int = Field(..., ge=0, le=255)
    pa_mode: int = Field(default=2, ge=0, le=2, description="0=OFF 1=ON 2=AUTO")
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class LoraPowerRequest(BaseModel):
    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF)
    power_dbm: int = Field(..., ge=0, le=255)
    pa_mode: int = Field(default=2, ge=0, le=2, description="0=OFF 1=ON 2=AUTO")
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class LoraModulatedRequest(BaseModel):
    bandwidth: int = Field(..., ge=0, le=3, description="0=125k 1=250k 2=500k 3=reserved (FSK=0)")
    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF)
    power_dbm: int = Field(..., ge=0, le=255)
    modem: int = Field(..., ge=0, le=1, description="0=FSK 1=LoRa")
    datarate: int = Field(..., ge=0, le=0xFFFFFFFF, description="LoRa SF 6..12; FSK bps")
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class StopRequest(BaseModel):
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class CommandResponse(BaseModel):
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    reply_opcode_hex: str
    reply_payload_hex: str

    @classmethod
    def from_result(cls, r: CommandResult) -> CommandResponse:
        return cls(
            ok=r.ok,
            status=r.status,
            tx_hex=r.tx.hex(" "),
            rx_hex=r.rx.hex(" "),
            reply_opcode_hex=r.reply.opcode.hex(" "),
            reply_payload_hex=r.reply.payload.hex(" "),
        )


def _device():
    dev = manager.device
    if dev is None:
        raise HTTPException(
            status_code=409,
            detail="Device not ready (not connected or transport unavailable)",
        )
    return dev


@router.post("/lora-cw", response_model=CommandResponse)
async def lora_cw(req: LoraCwRequest) -> CommandResponse:
    dev = _device()
    with handle_driver_errors("device lora cw"):
        result = await dev.lora_cw(
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            pa_duty_cycle=req.pa_duty_cycle,
            hp_max=req.hp_max,
            pa_mode=PaMode(req.pa_mode),
            timeout=req.timeout,
        )
    return CommandResponse.from_result(result)


@router.post("/lora-power", response_model=CommandResponse)
async def lora_power(req: LoraPowerRequest) -> CommandResponse:
    dev = _device()
    with handle_driver_errors("device lora power"):
        result = await dev.lora_power(
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            pa_mode=PaMode(req.pa_mode),
            timeout=req.timeout,
        )
    return CommandResponse.from_result(result)


@router.post("/lora-modulated", response_model=CommandResponse)
async def lora_modulated(req: LoraModulatedRequest) -> CommandResponse:
    dev = _device()
    with handle_driver_errors("device lora modulated"):
        result = await dev.lora_modulated(
            bandwidth=req.bandwidth,
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            modem=Modem(req.modem),
            datarate=req.datarate,
            timeout=req.timeout,
        )
    return CommandResponse.from_result(result)


@router.post("/stop", response_model=CommandResponse)
async def stop(req: StopRequest | None = None) -> CommandResponse:
    dev = _device()
    timeout = req.timeout if req else 5.0
    with handle_driver_errors("device stop"):
        result = await dev.stop_test(timeout=timeout)
    return CommandResponse.from_result(result)
