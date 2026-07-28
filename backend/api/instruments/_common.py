"""Shared schemas and helpers for instrument route modules."""
from __future__ import annotations

from pydantic import BaseModel, Field

from ..errors import DriverUnavailable


class DiscoverCandidate(BaseModel):
    resource: str
    idn: str | None = None


class DiscoverResponse(BaseModel):
    candidates: list[str]
    details: list[DiscoverCandidate] | None = None


class ConnectRequest(BaseModel):
    address: str = Field(..., description="Serial (power-sensor) or VISA resource (others)")
    channel: int | None = Field(default=None, ge=1, le=4)


class ConnectResponse(BaseModel):
    connected: bool
    idn: str | None


def list_visa_resources_idn() -> list[DiscoverCandidate]:
    """Enumerate VISA resources and probe `*IDN?` on each for a user-friendly label.

    Open/query timeouts kept short (500ms) so a single dead resource doesn't
    stall discovery. Resources that fail to open (e.g. already held by our
    own connected session) return idn=None.
    """
    try:
        import pyvisa  # type: ignore
    except ImportError as e:
        # Runs in a worker thread — raise a plain driver error, not HTTPException.
        # The route wraps this in `handle_driver_errors`, which maps it to 501.
        raise DriverUnavailable(f"pyvisa not installed: {e}") from e
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
            idn: str | None = None
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
