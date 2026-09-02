"""HTTP route for the Meter Information read.

A GET rather than a POST like its neighbours in this package: those key the
PA or start a test, this only asks the unit to describe itself.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...ble import manager
from ...device.info import APP_MODES, PRIMARY_CHANNELS, SECONDARY_CHANNELS
from ..errors import handle_driver_errors
from ._common import get_device

log = logging.getLogger(__name__)

router = APIRouter()


class MeterInfoField(BaseModel):
    key: str
    label: str
    ok: bool
    status: int
    raw_hex: str
    value: Optional[str] = None
    error: Optional[str] = None


class MeterInfoResponse(BaseModel):
    """Every field the unit was asked for, answered or not.

    Failures ride along as `ok: false` rows instead of turning the whole read
    into an HTTP error: a unit that declines one query still has eight useful
    answers, and the UI needs to show "Not Supported" on the row rather than
    an empty dialog. Only a failure to reach the device at all is an error
    here, and `get_device` already raises that as a 409.
    """

    fields: list[MeterInfoField]


@router.get("/info", response_model=MeterInfoResponse)
async def meter_info() -> MeterInfoResponse:
    dev = get_device()
    with handle_driver_errors("device meter info"):
        fields = await dev.meter_info()
    return MeterInfoResponse(
        fields=[MeterInfoField(**vars(f)) for f in fields],
    )


class AppModeOption(BaseModel):
    mode: int
    label: str


class AppModesResponse(BaseModel):
    modes: list[AppModeOption]


class SetAppModeRequest(BaseModel):
    mode: int = Field(..., ge=0, le=255, description="App mode number, 0-6")
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class SetAppModeResponse(BaseModel):
    """`acknowledged` and `ok` are not the same question.

    The unit saves the mode and resets, so the reply can go missing simply
    because the link dropped underneath it. `acknowledged: false` means the
    write went out and nothing came back -- which is neither success nor
    failure, and the UI says so rather than picking one.
    """

    mode: int
    label: str
    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None


@router.get("/app-modes", response_model=AppModesResponse)
async def app_modes() -> AppModesResponse:
    """The mode list, served from the backend so the names have one home."""
    return AppModesResponse(
        modes=[AppModeOption(mode=m, label=label) for m, label in sorted(APP_MODES.items())],
    )


@router.post("/app-mode", response_model=SetAppModeResponse)
async def set_app_mode(req: SetAppModeRequest) -> SetAppModeResponse:
    dev = get_device()
    if req.mode not in APP_MODES:
        # 422 rather than letting the driver's ValueError become a 400: an
        # unknown mode is a bad request field, and this write reboots a meter.
        raise HTTPException(
            status_code=422,
            detail=f"Unknown app mode {req.mode}; known modes are {sorted(APP_MODES)}",
        )
    with handle_driver_errors("device set app mode"):
        result = await dev.set_app_mode(req.mode, timeout=req.timeout)
    return SetAppModeResponse(**vars(result))


class ChannelOptionsResponse(BaseModel):
    primary: list[AppModeOption]
    secondary: list[AppModeOption]


class SetChannelsRequest(BaseModel):
    primary: int = Field(..., ge=0, le=255)
    secondary: int = Field(..., ge=0, le=255)
    timeout: float = Field(default=5.0, ge=0.1, le=30.0)


class SetChannelsResponse(BaseModel):
    primary: int
    secondary: int
    primary_label: str
    secondary_label: str
    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None


@router.get("/channel-options", response_model=ChannelOptionsResponse)
async def channel_options() -> ChannelOptionsResponse:
    return ChannelOptionsResponse(
        primary=[AppModeOption(mode=v, label=n) for v, n in sorted(PRIMARY_CHANNELS.items())],
        secondary=[AppModeOption(mode=v, label=n) for v, n in sorted(SECONDARY_CHANNELS.items())],
    )


@router.post("/channels", response_model=SetChannelsResponse)
async def set_channels(req: SetChannelsRequest) -> SetChannelsResponse:
    dev = get_device()
    # Validated here as well as in the encoder: an unknown value is a bad
    # request field, and this writes to a live meter.
    if req.primary not in PRIMARY_CHANNELS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown primary channel {req.primary}; known are {sorted(PRIMARY_CHANNELS)}",
        )
    if req.secondary not in SECONDARY_CHANNELS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown secondary channel {req.secondary}; known are {sorted(SECONDARY_CHANNELS)}",
        )
    with handle_driver_errors("device set channels"):
        result = await dev.set_channels(req.primary, req.secondary, timeout=req.timeout)
    return SetChannelsResponse(**vars(result))


class SaveResetResponse(BaseModel):
    """Outcome of the save-and-reset.

    A success here means the meter accepted the command and is going down --
    the BLE link will drop and stay down until something reconnects. That is
    the expected result, not an error, so the caller should stop reading the
    unit rather than retrying.
    """

    acknowledged: bool
    ok: bool
    status: int
    tx_hex: str
    rx_hex: str
    error: Optional[str] = None


@router.post("/save-reset", response_model=SaveResetResponse)
async def save_reset() -> SaveResetResponse:
    dev = get_device()
    with handle_driver_errors("device save and reset"):
        result = await dev.save_and_reset()

    if result.ok:
        # The meter is rebooting, so the session we are holding is already
        # dead -- it just does not know it yet. Dropped here rather than left
        # for the heartbeat to notice, because until it goes the app still
        # reports "connected" and offers Disconnect for a link that is gone.
        # A stale session also refuses the next connect, which is the thing
        # this repo keeps having to unplug hardware to recover from.
        #
        # Best effort: the mode change itself succeeded, and failing the
        # response over the tidy-up would misreport that.
        try:
            await manager.disconnect()
        except Exception as e:
            log.warning("disconnect after save-and-reset failed: %s: %s", type(e).__name__, e)

    return SaveResetResponse(**vars(result))
