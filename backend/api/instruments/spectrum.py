"""Spectrum analyzer routes (generic VISA)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverResponse,
    list_visa_resources_idn,
    to_thread,
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
    state.spectrum_resource = resource or None
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
    details = await to_thread(list_visa_resources_idn)
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/spectrum/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    try:
        idn = await to_thread(_connect, req.address)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return ConnectResponse(connected=True, idn=idn)


@router.post("/spectrum/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    await to_thread(_disconnect)
    return ConnectResponse(connected=False, idn=None)
