"""Keysight DC Power Analyzer routes (connect/disconnect + supply control)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverResponse,
    list_visa_resources_idn,
    to_thread,
)
from ._state import DC_VOLTAGE_SCALE, state

router = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Connect / Disconnect ----------

def _connect(resource: str, channel: int) -> str:
    from dc_power_analyzer import DCPowerAnalyzer  # type: ignore
    a = DCPowerAnalyzer(resource=resource) if resource else DCPowerAnalyzer()
    a.connect()
    state.dc_analyzer = a
    state.dc_analyzer_channel = channel
    state.dc_analyzer_resource = resource or None
    idn = getattr(a, "idn", None) or "Keysight DC Power Analyzer"
    state.dc_analyzer_idn = str(idn)
    return state.dc_analyzer_idn


def _disconnect() -> None:
    a = state.dc_analyzer
    state.dc_analyzer = None
    state.dc_analyzer_idn = None
    state.dc_analyzer_resource = None
    if a is not None:
        try:
            a.disconnect()
        except Exception:
            pass


@router.get("/discover/dc-analyzer", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    details = await to_thread(list_visa_resources_idn)
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/dc-analyzer/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    try:
        idn = await to_thread(_connect, req.address, req.channel or 1)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return ConnectResponse(connected=True, idn=idn)


@router.post("/dc-analyzer/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    await to_thread(_disconnect)
    return ConnectResponse(connected=False, idn=None)


# ---------- Supply control ----------

class SupplyRequest(BaseModel):
    enabled: bool
    voltage_v: float = Field(default=3.6, ge=0.0, le=60.0)
    channel: Optional[int] = Field(default=None, ge=1, le=4)


class SupplyResponse(BaseModel):
    enabled: bool
    voltage_v: Optional[float] = None
    channel: int


def _get_supply(channel: int) -> tuple[bool, Optional[float]]:
    a = state.dc_analyzer
    if a is None:
        return False, None
    try:
        en = bool(a.is_output_enabled(channel))  # type: ignore[attr-defined]
    except Exception:
        en = False
    try:
        raw = float(a.get_voltage_setpoint(channel))  # type: ignore[attr-defined]
        v = raw * DC_VOLTAGE_SCALE
    except Exception:
        v = None
    return en, v


def _apply_supply(enabled: bool, volts: float, channel: int) -> None:
    a = state.dc_analyzer
    if a is None:
        raise RuntimeError("dc_analyzer not connected")
    if enabled:
        # Touching set_voltage while disabling has been observed to drop the
        # channel/session on some units; only program voltage when enabling.
        a.set_voltage(volts / DC_VOLTAGE_SCALE, channel)  # type: ignore[attr-defined]
        a.enable_output(channel)  # type: ignore[attr-defined]
    else:
        a.disable_output(channel)  # type: ignore[attr-defined]


@router.get("/dc-analyzer/supply", response_model=SupplyResponse)
async def get_supply() -> SupplyResponse:
    ch = state.dc_analyzer_channel
    en, v = await to_thread(_get_supply, ch)
    return SupplyResponse(enabled=en, voltage_v=v, channel=ch)


@router.post("/dc-analyzer/supply", response_model=SupplyResponse)
async def set_supply(req: SupplyRequest) -> SupplyResponse:
    if state.dc_analyzer is None:
        raise HTTPException(status_code=409, detail="dc_analyzer not connected")
    ch = req.channel or state.dc_analyzer_channel
    try:
        await to_thread(_apply_supply, req.enabled, req.voltage_v, ch)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"supply apply failed: {e}")
    state.dc_analyzer_channel = ch
    return SupplyResponse(enabled=req.enabled, voltage_v=req.voltage_v, channel=ch)
