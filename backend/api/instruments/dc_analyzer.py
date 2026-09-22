"""Keysight DC Power Analyzer routes.

Connect/disconnect, the one-switch supply control the Settings menu uses, and
the fuller control panel on the Components > DC Analyzer page: output on/off,
voltage, current limit, and the meter ranges.

Every call that talks to the instrument goes through its bus. `/measure` reads
current from the same VISA session during a run, and two callers on one session
desync it -- so nothing here may reach the analyzer from a plain thread.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..errors import handle_driver_errors
from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverResponse,
    bound_resource,
    discover_visa,
)
from ._bus import InstrumentBusy, bus
from ._state import DC_VOLTAGE_SCALE, state

router = APIRouter(prefix="/instruments", tags=["instruments"])

#: How long a command waits out another call on the analyzer before failing.
#: 16 x 0.25 s ~ 4 s: the control panel's poll holds it for ~0.6 s, and a
#: test's current read for less. Without this, an Apply that landed during a
#: poll came back 409 "not responding to a previous command" -- the bus only
#: says "busy", it cannot tell a queue from a hang -- and nothing changed.
_BUSY_RETRIES = 16
_BUSY_WAIT_S = 0.25


async def _command(fn, *args):
    """Run `fn` on the analyzer's bus, waiting its turn behind other calls."""
    for attempt in range(_BUSY_RETRIES):
        try:
            return await bus("dc-analyzer").call(fn, *args)
        except InstrumentBusy:
            if attempt == _BUSY_RETRIES - 1:
                raise
            await asyncio.sleep(_BUSY_WAIT_S)
    raise RuntimeError("unreachable")


# ---------- Connect / Disconnect ----------

def _connect(resource: str, channel: int) -> str:
    from dc_power_analyzer import DCPowerAnalyzer  # type: ignore
    a = DCPowerAnalyzer(resource=resource) if resource else DCPowerAnalyzer()
    a.connect()
    state.dc_analyzer = a
    state.dc_analyzer_channel = channel
    # Ask the live session what it bound rather than trusting the typed string:
    # a blank address means "driver default", and a typed one may be an alias.
    # Getting this wrong lets discovery re-open the instrument mid-session.
    state.dc_analyzer_resource = bound_resource(a, resource)
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
    with handle_driver_errors("dc analyzer discover"):
        details = await discover_visa()
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/dc-analyzer/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    with handle_driver_errors("dc analyzer connect"):
        idn = await _command(_connect, req.address, req.channel or 1)
    return ConnectResponse(connected=True, idn=idn)


@router.post("/dc-analyzer/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    with handle_driver_errors("dc analyzer disconnect"):
        await _command(_disconnect)
    return ConnectResponse(connected=False, idn=None)


# ---------- Supply control ----------

class SupplyRequest(BaseModel):
    enabled: bool
    voltage_v: float = Field(default=3.6, ge=0.0, le=60.0)
    channel: int | None = Field(default=None, ge=1, le=4)


class SupplyResponse(BaseModel):
    enabled: bool
    voltage_v: float | None = None
    channel: int


def _get_supply(channel: int) -> tuple[bool, float | None]:
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
    with handle_driver_errors("dc analyzer get supply"):
        en, v = await _command(_get_supply, ch)
    return SupplyResponse(enabled=en, voltage_v=v, channel=ch)


@router.post("/dc-analyzer/supply", response_model=SupplyResponse)
async def set_supply(req: SupplyRequest) -> SupplyResponse:
    if state.dc_analyzer is None:
        raise HTTPException(status_code=409, detail="dc_analyzer not connected")
    ch = req.channel or state.dc_analyzer_channel
    with handle_driver_errors("dc analyzer set supply"):
        await _command(_apply_supply, req.enabled, req.voltage_v, ch)
    state.dc_analyzer_channel = ch
    return SupplyResponse(enabled=req.enabled, voltage_v=req.voltage_v, channel=ch)


# ---------- Control panel ----------
#
# The wrapper covers output, voltage and current limit but not the meter
# ranges, so those go out as raw SCPI through its own write/query -- the same
# session, never a second one.
#
# SENS:*:RANG:AUTO is the *remote* measurement system's auto-ranging: it
# governs every MEAS? this app makes. It is not the front panel's Meter View >
# Properties > Meter Ranges "Auto" checkbox, which in the default N6705 mode
# belongs to a separate front-panel measurement system that SCPI cannot set.
# Setting it here and watching that checkbox stay clear is expected; with
# Utilities > Preferences on "N6700 Mode" the front panel shows these instead.

#: Typo guards, not the instrument's limits: the module in each slot has its
#: own (an N6781A tops out at 20 V / 3 A), and says so in its error queue,
#: which is read back after every write.
MAX_VOLTAGE_V = 60.0
MAX_CURRENT_LIMIT_A = 10.0

#: Error codes the analyzer queues for commands it nevertheless carried out.
#: 315 "Settings conflict" follows CURR:LIM and range changes on an N6781A in
#: voltage-priority mode -- the value is written all the same (see the
#: wrapper's own notes), so reporting it would cry wolf on every Apply.
_HARMLESS_ERRORS = {315}


class DcState(BaseModel):
    """What the analyzer reports for one channel.

    Every reading is nullable: each is queried on its own, so one refused query
    costs that field alone, and a missing value stays visibly missing instead
    of reading as zero.
    """
    connected: bool
    idn: str | None = None
    channel: int
    module: str | None = None
    output_on: bool | None = None
    #: Setpoint as seen at the DUT, i.e. after DC_VOLTAGE_SCALE.
    voltage_set_v: float | None = None
    current_limit_a: float | None = None
    voltage_v: float | None = None
    current_a: float | None = None
    power_w: float | None = None
    voltage_range_auto: bool | None = None
    current_range_auto: bool | None = None
    #: The instrument's own error queue, when it held something that matters.
    error: str | None = None


class DcSettings(BaseModel):
    """Any subset. What is left out is left alone on the instrument."""
    voltage_v: float | None = Field(default=None, ge=0.0, le=MAX_VOLTAGE_V)
    current_limit_a: float | None = Field(default=None, ge=0.0, le=MAX_CURRENT_LIMIT_A)
    output_on: bool | None = None
    #: Seamless auto-ranging of each meter, on or off. N6781A/82A/85A/86A only.
    voltage_range_auto: bool | None = None
    current_range_auto: bool | None = None
    #: Both meters at once; a per-meter field above wins over this one.
    meter_auto_range: bool | None = None


def _q(a: object, cmd: str) -> str:
    return a._query(cmd)  # type: ignore[attr-defined]


def _w(a: object, cmd: str) -> None:
    a._write(cmd)  # type: ignore[attr-defined]


def _drain_errors(a: object) -> str | None:
    """Empty the error queue; return what is worth showing, or None.

    Drained whole rather than read once, so a stale entry from an earlier
    command cannot be blamed on the next one. Bounded: a queue that never
    reports empty is itself the fault, not a reason to spin.
    """
    found: list[str] = []
    for _ in range(10):
        try:
            reply = _q(a, "SYST:ERR?")
        except Exception as e:  # noqa: BLE001 -- a failed query is the answer
            found.append(f"{type(e).__name__}: {e}")
            break
        code_txt, _, msg = reply.partition(",")
        try:
            code = int(code_txt)
        except ValueError:
            found.append(reply)
            break
        if code == 0:
            break
        if abs(code) not in _HARMLESS_ERRORS:
            found.append(f"{code}: {msg.strip().strip(chr(34))}")
    return "; ".join(found) or None


def _read_state(channel: int) -> DcState:
    a = state.dc_analyzer
    if a is None:
        return DcState(connected=False, channel=channel)

    def get(fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001 -- a refused query leaves its field empty
            return None

    ch = f"(@{channel})"
    set_raw = get(lambda: float(a.get_voltage_setpoint(channel)))  # type: ignore[attr-defined]
    return DcState(
        connected=True,
        idn=state.dc_analyzer_idn,
        channel=channel,
        module=get(lambda: _q(a, f"SYST:CHAN:MOD? {ch}").strip().strip('"')),
        output_on=get(lambda: bool(a.is_output_enabled(channel))),  # type: ignore[attr-defined]
        voltage_set_v=None if set_raw is None else set_raw * DC_VOLTAGE_SCALE,
        current_limit_a=get(lambda: float(a.get_current_limit(channel))),  # type: ignore[attr-defined]
        # Measured at the terminals: the scale only corrects the setpoint DAC.
        voltage_v=get(lambda: float(a.measure_voltage(channel))),  # type: ignore[attr-defined]
        current_a=get(lambda: float(a.measure_current(channel))),  # type: ignore[attr-defined]
        power_w=get(lambda: abs(float(a.measure_power(channel)))),  # type: ignore[attr-defined]
        voltage_range_auto=get(lambda: bool(int(_q(a, f"SENS:VOLT:RANG:AUTO? {ch}")))),
        current_range_auto=get(lambda: bool(int(_q(a, f"SENS:CURR:RANG:AUTO? {ch}")))),
        # Reading drains too, so a query the module does not support (auto-range
        # on a module without it) surfaces here rather than on the next write.
        error=_drain_errors(a),
    )


def _apply(req: DcSettings, channel: int) -> DcState:
    a = state.dc_analyzer
    if a is None:
        raise RuntimeError("dc_analyzer not connected")
    _drain_errors(a)  # start clean, so what follows is this request's own
    ch = f"(@{channel})"
    problems: list[str] = []

    def step(what: str, fn) -> None:
        try:
            fn()
        except Exception as e:  # noqa: BLE001 -- keep going, report all
            problems.append(f"{what}: {type(e).__name__}: {e}")
        err = _drain_errors(a)
        if err:
            problems.append(f"{what}: {err}")

    # Order matters on a live supply. Switching off goes first, so new values
    # never reach a DUT that is being powered down; switching on goes last, so
    # the output can never come on at the previous settings.
    if req.output_on is False:
        step("output off", lambda: a.disable_output(channel))  # type: ignore[attr-defined]
    if req.current_limit_a is not None:
        # Limit before voltage: raising both at once must not briefly put the
        # new voltage behind the old, possibly higher, limit.
        step("current limit", lambda: a.set_current_limit(req.current_limit_a, channel))  # type: ignore[attr-defined]
    if req.voltage_v is not None:
        step("voltage", lambda: a.set_voltage(req.voltage_v / DC_VOLTAGE_SCALE, channel))  # type: ignore[attr-defined]
    v_auto = req.voltage_range_auto if req.voltage_range_auto is not None else req.meter_auto_range
    i_auto = req.current_range_auto if req.current_range_auto is not None else req.meter_auto_range
    if v_auto is not None:
        step("voltage meter range", lambda: _w(a, f"SENS:VOLT:RANG:AUTO {'ON' if v_auto else 'OFF'},{ch}"))
    if i_auto is not None:
        step("current meter range", lambda: _w(a, f"SENS:CURR:RANG:AUTO {'ON' if i_auto else 'OFF'},{ch}"))
    if req.output_on is True:
        step("output on", lambda: a.enable_output(channel))  # type: ignore[attr-defined]

    st = _read_state(channel)
    if problems:
        st.error = "; ".join(problems + ([st.error] if st.error else []))
    return st


#: Last successful state read, served to the poll while the analyzer is busy.
#: Only the poller reads stale values; every write path re-reads.
_last_state: DcState | None = None


@router.get("/dc-analyzer/state", response_model=DcState)
async def get_state() -> DcState:
    """Read the analyzer back, yielding to anything else using it.

    Polled every second by the control panel. A poll is never worth delaying a
    command or a test's current read for, so when the analyzer is busy this
    answers from the last good read instead of queueing or failing.
    """
    global _last_state
    ch = state.dc_analyzer_channel
    if state.dc_analyzer is None:
        _last_state = None
        return DcState(connected=False, channel=ch)
    with handle_driver_errors("dc analyzer state"):
        try:
            _last_state = await bus("dc-analyzer").call(_read_state, ch)
        except InstrumentBusy:
            if _last_state is None or _last_state.channel != ch:
                raise
        return _last_state


@router.post("/dc-analyzer/settings", response_model=DcState)
async def apply_settings(req: DcSettings) -> DcState:
    global _last_state
    if state.dc_analyzer is None:
        raise HTTPException(status_code=409, detail="dc_analyzer not connected")
    with handle_driver_errors("dc analyzer settings"):
        _last_state = await _command(_apply, req, state.dc_analyzer_channel)
        return _last_state
