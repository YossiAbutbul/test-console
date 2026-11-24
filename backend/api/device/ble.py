"""HTTP routes for BLE radio test commands over the BLE transport.

Both test commands take the DUT off the link they arrive on (see `device/ble.py`),
so each route ends by releasing our side of it and the caller follows up with
`POST /ble/relink`. Reading the power back (`GET /device/ble/tx-power`) is
a plain read and leaves the link alone. The relink is a route of its own rather than folded in:
after a tone it must not start until the tone's duration has run out -- the
DUT will not take a connection while it transmits -- and that wait belongs to
the caller, which is measuring in the meantime.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...ble import manager
from ...device import (
    BLE_CHANNEL_MAX, BLE_DURATION_MAX_S, BLE_DURATION_MIN_S,
    BLE_TX_POWER_PARAM_MAX, BLE_TX_POWER_PARAM_MIN, ble_channel_freq_hz,
)
from ...device.info import WriteOutcome
from ..errors import handle_driver_errors
from ..runs import refuse_if_rig_busy
from ._common import get_device

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ble")


class BleWrite(BaseModel):
    """One frame's outcome.

    `acknowledged` and `ok` are separate questions, as for the Meter Info
    writes: these commands drop the link, so a reply can go missing because
    the DUT did what it was asked. `acknowledged: false` is doubtful, not
    failed, and the relink that follows is how the caller finds out.
    """

    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None

    @classmethod
    def of(cls, w: WriteOutcome) -> "BleWrite":
        return cls(**vars(w))


class BleTxPowerRequest(BaseModel):
    # The firmware's own parameter, not dBm -- see TX_POWER_PARAM_MIN.
    param: int = Field(
        ..., ge=BLE_TX_POWER_PARAM_MIN, le=BLE_TX_POWER_PARAM_MAX,
        description="Tone power parameter (firmware units, not dBm)",
    )
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class BleTxPowerResponse(BaseModel):
    """The set and the save-and-reset that makes it take.

    `reset` is absent when the set was refused: resetting then would reboot
    the DUT onto the power it already had, and report a change that never
    happened. `released` says the link was let go -- the caller relinks.
    """

    set: BleWrite
    reset: Optional[BleWrite] = None
    released: bool


class BleToneRequest(BaseModel):
    channel: int = Field(
        ..., ge=0, le=BLE_CHANNEL_MAX,
        description="BLE RF channel, 2402 + 2*channel MHz",
    )
    # Bounded at 255 s for a frame-layout reason -- see DURATION_MAX_S. Never
    # 0: a running tone cannot be stopped, so one without an end is a DUT
    # that only a power cycle gets back.
    duration_s: int = Field(
        ..., ge=BLE_DURATION_MIN_S, le=BLE_DURATION_MAX_S,
        description="Tone duration in seconds; the DUT is off the link for it",
    )
    offset: int = Field(
        default=0, ge=0, le=0xFF,
        description="Offset from the channel centre, raw firmware value",
    )
    timeout: float = Field(default=3.0, ge=0.1, le=30.0)


class BleToneResponse(BleWrite):
    freq_hz: int
    duration_s: int
    released: bool


class BleTxPowerReadResponse(BaseModel):
    """The tone power read back. `param` is null when it cannot be trusted --
    see `BleTxPowerRead` -- and `error` says why; `data_hex` is the raw value."""

    ok: bool
    status: int
    param: Optional[int] = None
    tx_hex: str
    rx_hex: str
    data_hex: str = ""
    error: Optional[str] = None


@router.get("/tx-power", response_model=BleTxPowerReadResponse)
async def ble_tx_power_read() -> BleTxPowerReadResponse:
    # A GET, as the Meter Info read is: it only asks, and the DUT stays on
    # the link.
    dev = get_device()
    with handle_driver_errors("device ble tx power read"):
        result = await dev.ble_tx_power_get()
    return BleTxPowerReadResponse(**vars(result))


@router.post("/tx-power", response_model=BleTxPowerResponse)
async def ble_tx_power(req: BleTxPowerRequest) -> BleTxPowerResponse:
    refuse_if_rig_busy()
    dev = get_device()
    with handle_driver_errors("device ble tx power"):
        set_ = await dev.ble_tx_power_set(req.param, timeout=req.timeout)
        if not (set_.acknowledged and set_.ok):
            return BleTxPowerResponse(set=BleWrite.of(set_), released=False)
        reset = await dev.save_and_reset(timeout=req.timeout)
    # Released whether or not the reset was answered: an unanswered one may
    # well have gone through, and a relink to a DUT that never went down
    # costs one connect. Holding on to a dead session costs the next connect.
    await manager.release()
    return BleTxPowerResponse(set=BleWrite.of(set_), reset=BleWrite.of(reset), released=True)


@router.post("/tone", response_model=BleToneResponse)
async def ble_tone(req: BleToneRequest) -> BleToneResponse:
    refuse_if_rig_busy()
    dev = get_device()
    with handle_driver_errors("device ble tone"):
        result = await dev.ble_tone_start(
            channel=req.channel, duration_s=req.duration_s, offset=req.offset,
            timeout=req.timeout,
        )
    # Always: the tone may be on air whether or not its reply got out, and a
    # session left open across it is the stale one the next connect trips on.
    await manager.release()
    if not result.acknowledged:
        log.info("BLE tone on ch %d: no reply before the link went (expected)", req.channel)
    return BleToneResponse(
        **vars(result), freq_hz=ble_channel_freq_hz(req.channel),
        duration_s=req.duration_s, released=True,
    )
