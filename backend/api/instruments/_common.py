"""Shared schemas and helpers for instrument route modules."""
from __future__ import annotations

import asyncio
import time

from pydantic import BaseModel, Field

from ..errors import DriverUnavailable
from ._bus import InstrumentBus


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


def visa_key(resource: str) -> str:
    """Comparison key that survives equivalent spellings of one VISA address.

    `USB0::0x0957::0x0F07::MY50000200::INSTR` and the same address carrying the
    interface index (`::0::INSTR`) name the same instrument, and VISA accepts
    both on open while `list_resources()` only ever reports the latter. Compared
    literally, an address typed in the short form never matches the listed one —
    so the "don't re-open what we already hold" guard silently misses and
    discovery kills the live session.
    """
    parts = [p for p in resource.strip().upper().split("::") if p]
    if len(parts) >= 5 and parts[-1] == "INSTR" and parts[-2].isdigit():
        parts.pop(-2)
    return "::".join(parts)


def bound_resource(obj: object, fallback: str = "") -> str | None:
    """The resource name VISA actually resolved for a live session.

    Recording what the user typed is not good enough: a blank address means
    "use the driver's default resource", and a typed one may be a valid alias
    of the canonical name. Both leave the held-resource guard comparing against
    a string VISA never reports, so ask the open session what it bound.
    """
    dev = obj if hasattr(obj, "resource_name") else getattr(obj, "_dev", None)
    name = getattr(dev, "resource_name", None)
    if name:
        return str(name)
    # No live handle to ask — fall back to the driver's configured string.
    return getattr(obj, "_resource_str", None) or fallback or None


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
    # Keyed, not literal: see `visa_key`. A miss here is not cosmetic — it means
    # re-opening an instrument we are actively using, which invalidates the live
    # handle and makes every later read fail with InvalidSession.
    held = {
        visa_key(r): idn
        for r, idn in (
            (_state.dc_analyzer_resource, _state.dc_analyzer_idn),
            (_state.spectrum_resource, _state.spectrum_idn),
            (_state.network_analyzer_resource, _state.network_analyzer_idn),
        ) if r
    }
    # NOTE: never close this. `pyvisa.ResourceManager()` is a process-wide
    # singleton — the object returned here is the very same one every connected
    # driver is holding. Closing it ends the shared VISA session and invalidates
    # every open instrument handle at once, so a scan would leave the connected
    # DC analyzer answering "InvalidSession: the resource might be closed" to
    # every later read. Only the per-resource sessions opened below are ours to
    # close; the manager outlives us.
    rm = pyvisa.ResourceManager()
    out: list[DiscoverCandidate] = []
    for r in rm.list_resources():
        idn: str | None = None
        # ASRL* = raw serial COM port. Opening it pulses DTR which resets
        # Arduino-class devices (2s boot) and collides with our pyserial
        # servo session. These aren't VISA test-instruments anyway; hide.
        if r.upper().startswith("ASRL"):
            continue
        key = visa_key(r)
        if key in held:
            # Held by us — surface as a candidate with the cached IDN so
            # users still see what's connected, but never open it.
            out.append(DiscoverCandidate(resource=r, idn=held[key]))
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
    return out


# How long a single VISA enumeration may run before the caller gives up. A
# wedged USBTMC open (see `discover_visa`) is uninterruptible, so this only
# bounds *waiting*, not the thread — but that is enough to return a 504 to the
# UI instead of hanging until the proxy resets the socket. Kept below the
# frontend's own discover cap so the server's 504 is what normally surfaces.
DISCOVER_TIMEOUT_S = 12.0

#: Two pickers (dc-analyzer + network-analyzer) scan on the same modal-open, and
#: a re-scan often follows within a second. A short cache lets the second scan
#: reuse the first's result instead of touching the hardware again.
_DISCOVER_TTL_S = 3.0

#: A single isolated worker for *all* VISA enumeration. USBTMC access is
#: exclusive: two threads opening the same instrument concurrently wedge it (the
#: open lock is not bounded by `open_timeout`). Routing every scan through one
#: thread makes concurrent opens impossible, and the bus bounds how long callers
#: wait on a stuck one.
_visa_bus = InstrumentBus("visa-discover")

#: Serialises the *coroutines* so the second concurrent caller waits for the
#: first and then hits the cache, rather than racing it onto the bus (which
#: would reject it as "busy"). Guards `_cache`.
_discover_lock = asyncio.Lock()
_cache: tuple[float, list[DiscoverCandidate]] | None = None


async def discover_visa() -> list[DiscoverCandidate]:
    """Enumerate VISA resources safely for concurrent callers.

    Serialised (never two overlapping hardware scans), time-bounded (a wedged
    open surfaces as `TimeoutError` → 504, not an endless request), and briefly
    cached so the dc-analyzer and network-analyzer pickers share one scan.
    """
    global _cache
    async with _discover_lock:
        cached = _cache
        if cached is not None and time.monotonic() - cached[0] < _DISCOVER_TTL_S:
            return cached[1]
        result = await _visa_bus.call(
            list_visa_resources_idn, timeout=DISCOVER_TIMEOUT_S
        )
        _cache = (time.monotonic(), result)
        return result
