"""Shared schemas and helpers for instrument route modules."""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field


class DiscoverCandidate(BaseModel):
    resource: str
    idn: Optional[str] = None


class DiscoverResponse(BaseModel):
    candidates: list[str]
    details: Optional[list[DiscoverCandidate]] = None


class ConnectRequest(BaseModel):
    address: str = Field(..., description="Serial (power-sensor) or VISA resource (others)")
    channel: Optional[int] = Field(default=None, ge=1, le=4)


class ConnectResponse(BaseModel):
    connected: bool
    idn: Optional[str]


def to_thread(fn, *args, **kwargs):
    return asyncio.to_thread(fn, *args, **kwargs)


def list_visa_resources() -> list[str]:
    try:
        import pyvisa  # type: ignore
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"pyvisa not installed: {e}")
    rm = pyvisa.ResourceManager()
    try:
        return list(rm.list_resources())
    finally:
        try:
            rm.close()
        except Exception:
            pass


def list_visa_resources_idn() -> list[DiscoverCandidate]:
    """Enumerate VISA resources and probe `*IDN?` on each for a user-friendly label.

    Open/query timeouts kept short (500ms) so a single dead resource doesn't
    stall discovery. Resources that fail to open (e.g. already held by our
    own connected session) return idn=None.
    """
    try:
        import pyvisa  # type: ignore
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"pyvisa not installed: {e}")
    # Skip resources we already have an open session for — re-opening a held
    # USBTMC/VISA resource invalidates the live handle (VI_ERROR_INV_JOB_ID).
    from ._state import state as _state
    held = {
        r for r in (
            _state.dc_analyzer_resource,
            _state.spectrum_resource,
            _state.network_analyzer_resource,
        ) if r
    }
    rm = pyvisa.ResourceManager()
    out: list[DiscoverCandidate] = []
    try:
        for r in rm.list_resources():
            idn: Optional[str] = None
            # ASRL* = raw serial COM port. Opening it pulses DTR which resets
            # Arduino-class devices (2s boot) and collides with our pyserial
            # servo session. These aren't VISA test-instruments anyway; hide.
            if r.upper().startswith("ASRL"):
                continue
            if r in held:
                # Held by us — surface as a candidate with the cached IDN so
                # users still see what's connected, but never open it.
                cached = None
                if r == _state.dc_analyzer_resource:
                    cached = _state.dc_analyzer_idn
                elif r == _state.spectrum_resource:
                    cached = _state.spectrum_idn
                elif r == _state.network_analyzer_resource:
                    cached = _state.network_analyzer_idn
                out.append(DiscoverCandidate(resource=r, idn=cached))
                continue
            try:
                inst = rm.open_resource(r, open_timeout=500)
                try:
                    inst.timeout = 500
                    idn = inst.query("*IDN?").strip() or None
                except Exception:
                    idn = None
                finally:
                    try:
                        inst.close()
                    except Exception:
                        pass
            except Exception:
                idn = None
            out.append(DiscoverCandidate(resource=r, idn=idn))
    finally:
        try:
            rm.close()
        except Exception:
            pass
    return out
