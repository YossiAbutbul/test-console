"""Spectrum analyzer routes -- the Components > Spectrum Analyzer panel.

Two analyzers, one driver (`backend/spectrum/`): the R&S FSC3 over LAN (SCPI on
TCP 5555, address "host[:port]", blank for its direct-link address) and the
R&S FSV3004 over GPIB through a USB adapter (a VISA address such as
"GPIB0::20::INSTR"). The address decides the link; see `spectrum/link.py`.

Every instrument call goes through the spectrum bus, taken for a WHOLE
operation: a trace read is TRAC:DATA? plus the span plus the markers, and a
command landing between them returns a trace that belongs to neither setting.
Commands wait their turn behind a read instead of failing (see `_command`).
"""
from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...spectrum import (
    DEFAULT_HOST, DEFAULT_PORT, DETECTORS, MARKERS, TRACE_MODES, no_answer_hint, parse_address,
)
from ..errors import handle_driver_errors
from ._bus import InstrumentBusy, bus
from ._common import (
    ConnectRequest, ConnectResponse, DiscoverCandidate, DiscoverResponse, discover_visa,
)
from ._state import state

router = APIRouter(prefix="/instruments", tags=["instruments"])

#: How long a command waits out a trace read before failing. A live read is a
#: trace plus a few marker queries, well under a second; 16 x 0.25 s ~ 4 s.
_BUSY_RETRIES = 16
_BUSY_WAIT_S = 0.25

#: TRAC:DATA? alone is allowed 25 s by the driver, and Sweep once adds a sweep,
#: so a trace read gets longer than the bus default.
_TRACE_TIMEOUT_S = 40.0


async def _command(fn, *args, timeout: float = 25.0):
    """Run `fn` on the spectrum bus, waiting its turn behind other calls."""
    for attempt in range(_BUSY_RETRIES):
        try:
            return await bus("spectrum").call(fn, *args, timeout=timeout)
        except InstrumentBusy:
            if attempt == _BUSY_RETRIES - 1:
                raise
            await asyncio.sleep(_BUSY_WAIT_S)
    raise RuntimeError("unreachable")


#: `parse_address` lives with the link choice in spectrum/link.py; re-exported
#: here for the callers (and tests) that import it from this module.
__all__ = ["router", "parse_address"]


# ---------- Connect / Disconnect ----------

def _connect(address: str) -> str:
    from ...spectrum import make_analyzer

    an, where = make_analyzer(address)
    _disconnect()
    try:
        an.connect()
    except Exception as e:  # noqa: BLE001 -- a socket OSError or a VISA error
        if isinstance(e, ValueError):
            raise
        raise TimeoutError(
            f"no SCPI answer from {where} ({type(e).__name__}: {e}) - {no_answer_hint(where)}"
        ) from None
    state.spectrum = an
    state.spectrum_idn = an.idn
    state.spectrum_resource = where
    state.spectrum_applied = None  # a new session: nothing set on it yet
    return an.idn


def _disconnect() -> None:
    an = state.spectrum
    state.spectrum_applied = None
    state.spectrum = None
    state.spectrum_idn = None
    state.spectrum_resource = None
    if an is not None:
        try:
            an.close()
        except Exception:  # noqa: BLE001 -- the link is going either way
            pass


@router.get("/discover/spectrum", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    """Offer any R&S analyzer VISA can see (the FSV3004 on GPIB), then the
    FSC3's direct-link address.

    The LAN side is not probed: a LAN instrument does not enumerate, and
    scanning the subnet for port 5555 on every page visit would be noise on the
    network. VISA is scanned through the shared, cached discovery the other
    VISA panels use, so this adds no second walk of the bus. An analyzer that
    answers comes first: on the FSV's system the FSC3 address is a dead end.
    """
    default = f"{DEFAULT_HOST}:{DEFAULT_PORT}"
    held = state.spectrum_resource
    visa: list[DiscoverCandidate] = []
    try:
        for c in await discover_visa():
            idn = (c.idn or "").upper()
            # An R&S signal/spectrum analyzer: FSV, FSW, FSL, FSC ... The
            # model is the second IDN field ("Rohde&Schwarz,FSV3004,...").
            if "ROHDE" in idn and ",FS" in idn:
                visa.append(DiscoverCandidate(resource=c.resource, idn=c.idn, detail="GPIB / VISA"))
    except Exception:  # noqa: BLE001 -- no VISA, or a wedged scan: LAN still offered
        visa = []
    lan = ([held] if held and "::" not in held and held != default else []) + [default]
    details = visa + [DiscoverCandidate(
        resource=a, idn=state.spectrum_idn if a == held else None,
        detail=None if a == held else "R&S handheld, direct LAN link",
    ) for a in lan]
    return DiscoverResponse(candidates=[d.resource for d in details], details=details)


@router.post("/spectrum/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    with handle_driver_errors("spectrum connect"):
        idn = await _command(_connect, req.address)
    return ConnectResponse(connected=True, idn=idn)


@router.post("/spectrum/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    with handle_driver_errors("spectrum disconnect"):
        await _command(_disconnect)
    return ConnectResponse(connected=False, idn=None)


# ---------- Panel ----------

class SpectrumState(BaseModel):
    connected: bool
    idn: str | None = None
    address: str | None = None
    #: What the analyzer reports; see Analyzer.read_state for the keys.
    state: dict = Field(default_factory=dict)
    #: A state was captured at connect, so Restore has something to write.
    restorable: bool = False
    #: Commands the analyzer rejected on the last request, verbatim.
    problems: list[str] = Field(default_factory=list)
    markers_max: int = MARKERS
    trace_modes: list[str] = Field(default_factory=lambda: list(TRACE_MODES))
    detectors: list[str] = Field(default_factory=lambda: list(DETECTORS))


class Marker(BaseModel):
    n: int
    #: Hz in a frequency sweep, seconds in zero span; None when unreadable.
    x: float | None = None
    y: float | None = None


class TraceResponse(BaseModel):
    swept: bool
    start_hz: float | None = None
    stop_hz: float | None = None
    zero_span: bool
    values: list[float]
    markers: list[Marker]


Op = Literal[
    "frequency", "full_span", "ref_level", "ref_offset", "attenuation",
    "trace_mode", "trace_restart", "detector", "rbw", "vbw", "sweep_time",
    "continuous", "markers", "marker_off", "marker_x", "marker_action", "restore", "refresh",
]


class Command(BaseModel):
    """One panel operation. Only the fields its `op` uses are read."""
    op: Op
    center_hz: float | None = Field(default=None, ge=0)
    span_hz: float | None = Field(default=None, ge=0)
    start_hz: float | None = Field(default=None, ge=0)
    stop_hz: float | None = Field(default=None, ge=0)
    dbm: float | None = None
    db: float | None = None
    hz: float | None = Field(default=None, gt=0)
    seconds: float | None = Field(default=None, gt=0)
    auto: bool = False
    on: bool | None = None
    mode: str | None = None
    detector: str | None = None
    count: int | None = Field(default=None, ge=0, le=MARKERS)
    n: int = Field(default=1, ge=1, le=MARKERS)
    x: float | None = None
    action: Literal["peak", "next", "min", "center"] | None = None


def _need(value, what: str):
    if value is None:
        raise ValueError(f"{what} is required")
    return value


def _run(cmd: Command) -> list[str]:
    """Dispatch one operation. Returns the commands the analyzer rejected."""
    an = state.spectrum
    if an is None:
        raise RuntimeError("spectrum analyzer not connected")
    op = cmd.op
    if op == "frequency":
        return an.set_frequency(cmd.center_hz, cmd.span_hz, cmd.start_hz, cmd.stop_hz)
    if op == "full_span":
        return an.full_span()
    if op == "ref_level":
        return an.set_ref_level(_need(cmd.dbm, "reference level"))
    if op == "ref_offset":
        return an.set_ref_offset(_need(cmd.db, "reference offset"))
    if op == "attenuation":
        return an.set_attenuation(None if cmd.auto else _need(cmd.db, "attenuation"), cmd.auto)
    if op == "trace_mode":
        return an.set_trace_mode(_need(cmd.mode, "trace mode"))
    if op == "trace_restart":
        return an.restart_trace()
    if op == "detector":
        return an.set_detector(_need(cmd.detector, "detector"))
    if op == "rbw":
        return an.set_rbw(None if cmd.auto else _need(cmd.hz, "RBW"), cmd.auto)
    if op == "vbw":
        return an.set_vbw(None if cmd.auto else _need(cmd.hz, "VBW"), cmd.auto)
    if op == "sweep_time":
        return an.set_sweep_time(None if cmd.auto else _need(cmd.seconds, "sweep time"), cmd.auto)
    if op == "continuous":
        return an.set_continuous(bool(_need(cmd.on, "on")))
    if op == "markers":
        return an.set_marker_count(_need(cmd.count, "marker count"))
    if op == "marker_off":
        return an.marker_off(cmd.n)
    if op == "marker_x":
        return an.set_marker_x(cmd.n, _need(cmd.x, "marker position"),
                               bool(an.state.get("zero_span")))
    if op == "marker_action":
        return an.marker_action(cmd.n, _need(cmd.action, "action"))
    if op == "restore":
        return an.restore()
    return []  # refresh: nothing to send, just read back


def _run_and_read(cmd: Command) -> SpectrumState:
    problems = _run(cmd)
    an = state.spectrum
    return SpectrumState(
        connected=True, idn=an.idn, address=state.spectrum_resource,
        state=an.read_state(), restorable=bool(an.saved), problems=problems,
    )


def _snapshot() -> SpectrumState:
    an = state.spectrum
    if an is None:
        return SpectrumState(connected=False)
    return SpectrumState(connected=True, idn=an.idn, address=state.spectrum_resource,
                         state=dict(an.state), restorable=bool(an.saved))


@router.get("/spectrum/state", response_model=SpectrumState)
async def get_state() -> SpectrumState:
    """The last state read, without touching the analyzer.

    Every query costs the FSC3 sweep time, so the page reads the full state
    only after a change (every command returns it) or on Refresh, and the live
    view carries its own markers.
    """
    return _snapshot()


@router.post("/spectrum/command", response_model=SpectrumState)
async def command(cmd: Command) -> SpectrumState:
    if state.spectrum is None:
        raise HTTPException(status_code=409, detail="spectrum analyzer not connected")
    # The page changed the analyzer: a test's next power read sets it all
    # again rather than trust what it last left (see _read_spectrum_dbm).
    state.spectrum_applied = None
    with handle_driver_errors(f"spectrum {cmd.op}"):
        return await _command(_run_and_read, cmd)


@router.post("/spectrum/trace", response_model=TraceResponse)
async def trace(single: bool = False) -> TraceResponse:
    """Read the trace and markers. `single` arms one sweep first (Sweep once)."""
    if state.spectrum is None:
        raise HTTPException(status_code=409, detail="spectrum analyzer not connected")
    with handle_driver_errors("spectrum trace"):
        return await _command(state.spectrum.read_trace, single, timeout=_TRACE_TIMEOUT_S)
