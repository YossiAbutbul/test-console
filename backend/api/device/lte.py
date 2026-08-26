"""HTTP routes for LTE modem RF commands over the BLE transport.

An LTE test needs the modem powered before it will take a command, but the two
are separate routes rather than one call: the operator holds the modem up
across several commands instead of paying its ~10 s boot each time. Powering
down is a request of its own and never a side effect of aborting.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...device import (
    MAX_TX_POWER_DBM, MODEM_ON_TIMEOUT_S, TX_POWER_SCALE, LteTstrfCmd,
)
from ..errors import handle_driver_errors
from ._common import CommandResponse, get_device

router = APIRouter(prefix="/lte")


class ModemRequest(BaseModel):
    # Powering the modem up is a radio boot, not a register write, so this
    # defaults far higher than the 5 s the LoRa commands use.
    timeout: float = Field(default=MODEM_ON_TIMEOUT_S, ge=0.1, le=60.0)


class LteCwRequest(BaseModel):
    earfcn: int = Field(..., ge=0, le=0xFFFFFFFF, description="E-UTRA channel number")
    # Milliseconds, matching the wire. The UI takes seconds, because a test
    # runs for tens of seconds and 200000 is harder to read than 200.
    time_ms: int = Field(..., ge=0, le=0xFFFFFFFF, description="Test duration in ms")
    # The modem tops out at 23 dBm, and the wire field is unsigned. Both limits
    # are enforced here so an out-of-range value is a 422 rather than either a
    # silent clamp or a wrap to ~4 billion.
    tx_power_dbm: float = Field(
        ..., ge=0, le=MAX_TX_POWER_DBM,
        description="Transmit power in dBm; encoded as 0.01 dBm",
    )
    offset_hz: int = Field(
        default=0, ge=-0x8000_0000, le=0x7FFF_FFFF,
        description="Offset from the channel centre, in Hz, signed",
    )
    start: bool = Field(
        default=True, description="True = START_TX_TEST, False = ABORT_TEST",
    )
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)

    @property
    def tx_power_raw(self) -> int:
        return round(self.tx_power_dbm * TX_POWER_SCALE)


@router.post("/modem-on", response_model=CommandResponse)
async def modem_on(req: ModemRequest | None = None) -> CommandResponse:
    dev = get_device()
    timeout = req.timeout if req else MODEM_ON_TIMEOUT_S
    with handle_driver_errors("device lte modem on"):
        result = await dev.lte_modem_on(timeout=timeout)
    return CommandResponse.from_result(result)


@router.post("/modem-off", response_model=CommandResponse)
async def modem_off(req: ModemRequest | None = None) -> CommandResponse:
    dev = get_device()
    timeout = req.timeout if req else 5.0
    with handle_driver_errors("device lte modem off"):
        result = await dev.lte_modem_off(timeout=timeout)
    return CommandResponse.from_result(result)


@router.post("/cw", response_model=CommandResponse)
async def lte_cw(req: LteCwRequest) -> CommandResponse:
    dev = get_device()
    with handle_driver_errors("device lte cw"):
        result = await dev.lte_cw(
            earfcn=req.earfcn,
            time_ms=req.time_ms,
            tx_power=req.tx_power_raw,
            offset_hz=req.offset_hz,
            tstrf_cmd=(
                LteTstrfCmd.START_TX_TEST if req.start else LteTstrfCmd.ABORT_TEST
            ),
            timeout=req.timeout,
        )
    return CommandResponse.from_result(result)
