"""Spectrum analyzer routes (generic VISA)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from ..errors import handle_driver_errors
from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverResponse,
    bound_resource,
    discover_visa,
)
from ._state import state

router = APIRouter(prefix="/instruments", tags=["instruments"])


def _connect(resource: str) -> str:
    import pyvisa  # type: ignore
    rm = pyvisa.ResourceManager()
    inst = rm.open_resource(resource)
    try:
        idn = inst.query("*IDN?").strip()
    except Exception:
        idn = "Spectrum Analyzer"
    state.spectrum = inst
    state.spectrum_idn = idn
    # See dc_analyzer._connect — record what VISA resolved, not what was typed.
    state.spectrum_resource = bound_resource(inst, resource)
    return idn


def _disconnect() -> None:
    inst = state.spectrum
    state.spectrum = None
    state.spectrum_idn = None
    state.spectrum_resource = None
    if inst is not None:
        try:
            inst.close()
        except Exception:
            pass


@router.get("/discover/spectrum", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    with handle_driver_errors("spectrum discover"):
        details = await discover_visa()
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/spectrum/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    with handle_driver_errors("spectrum connect"):
        idn = await asyncio.to_thread(_connect, req.address)
    return ConnectResponse(connected=True, idn=idn)


@router.post("/spectrum/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    with handle_driver_errors("spectrum disconnect"):
        await asyncio.to_thread(_disconnect)
    return ConnectResponse(connected=False, idn=None)
