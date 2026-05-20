import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..ble import manager
from ..device import CommandResult

router = APIRouter(prefix="/device", tags=["device"])


class LoraCwRequest(BaseModel):
    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF, description="Radio frequency in Hz")
    power_dbm: int = Field(..., ge=0, le=255, description="Transmit power in dBm (positive)")
    pa_duty_cycle: int = Field(..., ge=0, le=255)
    hp_max: int = Field(..., ge=0, le=255)
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
    def from_result(cls, r: CommandResult) -> "CommandResponse":
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
    try:
        result = await dev.lora_cw(
            freq_hz=req.freq_hz,
            power_dbm=req.power_dbm,
            pa_duty_cycle=req.pa_duty_cycle,
            hp_max=req.hp_max,
            timeout=req.timeout,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="No reply within timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Send failed: {e}")
    return CommandResponse.from_result(result)


@router.post("/stop", response_model=CommandResponse)
async def stop(req: StopRequest | None = None) -> CommandResponse:
    dev = _device()
    timeout = req.timeout if req else 5.0
    try:
        result = await dev.stop_test(timeout=timeout)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="No reply within timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Send failed: {e}")
    return CommandResponse.from_result(result)
