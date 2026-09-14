"""Rohde & Schwarz SML03 signal generator, over RS-232.

Commands taken from the SML operating manual (1090.3123.12), chapters 4 and 5:

    *IDN?                       identification
    :SOUR:FREQ <hz>             CW frequency        (manual: ":SOUR:FREQ 100E6")
    :SOUR:POW <dbm>             output level        (manual: ":SOUR:POW -10")
    :OUTP:STAT ON|OFF           RF output           (manual: "OUTP:STAT ON")
    :SYST:ERR?                  error queue

The instrument speaks SCPI 1994.0 on both its IEC/IEEE-bus and RS-232 ports, so
the command set is the same either way and only the transport differs. The
manual's own RS-232 example configures the host as `mode com1: 9600,n,8,1` and
terminates with <CR><LF>, which is what this module sends.

Driven through pyserial rather than VISA. VISA would reach the port as an ASRL
resource, but instrument discovery deliberately skips those: opening a COM port
pulses DTR, which resets the Arduino-class devices sharing this bench (see the
note in `_common.list_visa_resources_idn`). Speaking to the port directly keeps
generator traffic away from every other serial device on the machine.

Nothing here keys the RF by itself. Connecting reads the instrument's state and
changes none of it -- no *RST, no output command -- because this generator feeds
a live bench, and the operator decides when it transmits, not a page load.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..errors import DriverUnavailable, handle_driver_errors
from ._bus import bus
from ._common import DiscoverCandidate, DiscoverResponse
from ._state import state

router = APIRouter(prefix="/instruments", tags=["instruments"])

#: <CR><LF>, per the manual's table of RS-232 control characters.
TERMINATOR = b"\r\n"

#: What the manual's own RS-232 example uses. The rate is set on the instrument
#: in Utilities - System - RS232 and both ends must agree, so it is offered as a
#: connect parameter rather than assumed.
DEFAULT_BAUD = 9600

#: A short command answers in milliseconds; this only bounds a port that has
#: gone quiet, so it can stay well under the bus timeout.
READ_TIMEOUT_S = 2.0
WRITE_TIMEOUT_S = 2.0

#: SML03 envelope, from the data sheet: 9 kHz to 3.3 GHz, -145 to +13 dBm.
#: These bounds are a typo guard, not a specification -- a value inside them can
#: still be refused by the instrument, which is why every write reads the error
#: queue back afterwards. The level ceiling is left above the data-sheet figure
#: because these units overrange, and refusing a setting the hardware would have
#: accepted is the more annoying of the two failures.
FREQ_MIN_HZ = 9_000.0
FREQ_MAX_HZ = 3_300_000_000.0
LEVEL_MIN_DBM = -145.0
LEVEL_MAX_DBM = 20.0

#: What the instrument answers when its error queue is empty.
NO_ERROR = "0"


class SignalGeneratorState(BaseModel):
    """What the generator says it is doing, read back rather than remembered.

    Every reading is optional: the panel stays useful against an instrument
    that answers identification but not, say, a level query, and a missing
    reading is then shown as missing instead of as a plausible zero.
    """
    connected: bool
    idn: Optional[str] = None
    port: Optional[str] = None
    freq_hz: Optional[float] = None
    level_dbm: Optional[float] = None
    rf_on: Optional[bool] = None
    #: Text of the instrument's own error queue, when it held something.
    error: Optional[str] = None


class ConnectRequest(BaseModel):
    address: str = Field(..., description="Serial port, e.g. COM5")
    baud: int = Field(default=DEFAULT_BAUD, ge=110, le=115200)
    #: Accepted and ignored -- the shared Instruments panel posts it for every
    #: instrument, and rejecting it would make this the one row it cannot open.
    channel: Optional[int] = None


class SettingsRequest(BaseModel):
    """Any subset of the three settings. Omitted ones are left alone."""
    freq_hz: Optional[float] = Field(default=None, ge=FREQ_MIN_HZ, le=FREQ_MAX_HZ)
    level_dbm: Optional[float] = Field(default=None, ge=LEVEL_MIN_DBM, le=LEVEL_MAX_DBM)
    rf_on: Optional[bool] = None


# ---------- Transport ----------

def _open(port: str, baud: int) -> Any:
    try:
        import serial  # type: ignore
    except ImportError as e:
        raise DriverUnavailable(f"pyserial not installed: {e}") from e

    s = serial.Serial()
    s.port = port
    s.baudrate = baud
    # 8 data bits, no parity, 1 stop bit: the manual asks for exactly this
    # ("in line with the provisional IEEE P1174"), whatever the baud rate.
    s.bytesize = serial.EIGHTBITS
    s.parity = serial.PARITY_NONE
    s.stopbits = serial.STOPBITS_ONE
    s.timeout = READ_TIMEOUT_S
    s.write_timeout = WRITE_TIMEOUT_S
    # DTR and RTS left asserted, unlike the servo's port. With the instrument
    # set to a hardware handshake it reads these lines as "the controller is
    # ready" and will not transmit while they are low, and there is no
    # auto-reset here that dropping them would be suppressing.
    s.open()
    return s


def _port() -> Any:
    h = state.signal_generator
    if h is None:
        raise RuntimeError("signal generator is not connected")
    return h


def _write(cmd: str) -> None:
    h = _port()
    h.write(cmd.encode("ascii") + TERMINATOR)
    h.flush()


def _ask(cmd: str) -> str:
    h = _port()
    # Anything still in the buffer belongs to a previous exchange -- an aborted
    # read, or the tail of a reply nobody collected. Left there, it would come
    # back as the answer to this question.
    try:
        h.reset_input_buffer()
    except Exception:
        pass
    _write(cmd)
    return h.readline().decode("ascii", "replace").strip()


def _handshake_lines(h: Any) -> Optional[bool]:
    """True if CTS or DSR is asserted, False if neither, None if unreadable.

    Read straight off the port rather than inferred: it is the one thing that
    distinguishes a wiring fault from a settings mismatch.
    """
    try:
        return bool(h.cts) or bool(h.dsr)
    except Exception:
        return None


def _float_or_none(text: str) -> Optional[float]:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _read_error() -> Optional[str]:
    """The instrument's error queue, or None when it was empty.

    SCPI answers `0,"No error"` for an empty queue. Only the code is compared:
    the message after it is free text, worth showing verbatim rather than
    matching on.
    """
    try:
        reply = _ask(":SYST:ERR?")
    except Exception:
        return None
    if not reply:
        return None
    code = reply.split(",", 1)[0].strip()
    return None if code == NO_ERROR else reply


def _read_state() -> SignalGeneratorState:
    """Ask the instrument for all three settings.

    Each query stands on its own so one unsupported or mistimed answer costs
    that field alone rather than the whole panel.
    """
    def one(cmd: str) -> Optional[str]:
        try:
            return _ask(cmd)
        except Exception:
            return None

    freq = _float_or_none(one(":SOUR:FREQ?") or "")
    level = _float_or_none(one(":SOUR:POW?") or "")
    out = one(":OUTP:STAT?")
    rf_on: Optional[bool] = None
    if out:
        # SCPI may answer with either the number or the mnemonic.
        rf_on = out.strip().upper() in ("1", "ON")
    return SignalGeneratorState(
        connected=True,
        idn=state.signal_generator_idn,
        port=state.signal_generator_port,
        freq_hz=freq,
        level_dbm=level,
        rf_on=rf_on,
        error=_read_error(),
    )


# ---------- Operations (run on the instrument's own thread) ----------

def _do_connect(port: str, baud: int) -> str:
    _do_disconnect()
    h = _open(port, baud)
    state.signal_generator = h
    state.signal_generator_port = port
    try:
        idn = _ask("*IDN?")
    except Exception as e:
        _do_disconnect()
        raise RuntimeError(f"opened {port} but it did not answer *IDN?: {e}") from e
    if not idn:
        # An open port that answers nothing is the usual sign of a baud
        # mismatch or of a straight-through cable where the manual asks for a
        # null modem. Say which, rather than reporting a nameless connection
        # that will fail on the first real command.
        #
        # CTS and DSR separate the two. They carry the instrument's RTS and
        # DTR, and the manual has RTS active for as long as its serial
        # interface is: a powered instrument on a null-modem cable holds both
        # high. Both low means the handshake lines are not arriving at all --
        # a straight-through cable joins each output to the far end's output
        # and leaves every input floating -- so the rate is not the thing to
        # go and check.
        lines = _handshake_lines(h)
        _do_disconnect()
        if lines is False:
            raise RuntimeError(
                f"no reply from {port}, and its CTS and DSR are both low - the "
                "instrument's handshake lines are not arriving, which is a "
                "straight-through cable where a null modem is needed, or "
                "nothing powered on the far end"
            )
        raise RuntimeError(
            f"no reply from {port} at {baud} baud - check the rate under "
            "Utilities-System-RS232 and that the cable is a null modem"
        )
    state.signal_generator_idn = idn
    return idn


def _do_disconnect() -> None:
    h = state.signal_generator
    state.signal_generator = None
    state.signal_generator_idn = None
    state.signal_generator_port = None
    if h is not None:
        try:
            h.close()
        except Exception:
            pass


def _do_apply(req: SettingsRequest) -> SignalGeneratorState:
    """Apply the requested settings, then report what the instrument holds.

    Ordered so the output is never live at a setting nobody asked for. Turning
    off happens before anything else; turning on happens last, after the
    frequency and level it was asked for are already in place. A change with no
    RF request at all lands in whatever state the operator left the output.
    """
    if req.rf_on is False:
        _write(":OUTP:STAT OFF")
    if req.freq_hz is not None:
        _write(f":SOUR:FREQ {req.freq_hz:.0f}")
    if req.level_dbm is not None:
        _write(f":SOUR:POW {req.level_dbm:.2f}")
    if req.rf_on is True:
        _write(":OUTP:STAT ON")
    return _read_state()


# ---------- Routes ----------

def _list_ports() -> list[DiscoverCandidate]:
    """Serial ports, without opening any of them.

    Deliberately no *IDN? probe: the bench has an Arduino on one of these
    ports, and opening it mid-scan resets it and can wedge the USB-serial
    driver. The OS description tells the ports apart instead, and USB adapters
    are listed first because that is what the generator is on.
    """
    try:
        from serial.tools import list_ports  # type: ignore
    except ImportError as e:
        raise DriverUnavailable(f"pyserial not installed: {e}") from e

    found: list[tuple[bool, str, Optional[str]]] = []
    for p in list_ports.comports():
        label = p.description or ""
        if p.manufacturer and p.manufacturer.lower() not in label.lower():
            label = f"{label} - {p.manufacturer}" if label else p.manufacturer
        found.append((p.vid is not None, p.device, label or None))
    found.sort(key=lambda t: (not t[0], t[1]))
    return [
        DiscoverCandidate(
            resource=device,
            # The one port we can name is the one we already hold.
            idn=state.signal_generator_idn if device == state.signal_generator_port else None,
            detail=label,
        )
        for _usb, device, label in found
    ]


@router.get("/discover/signal-generator", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    with handle_driver_errors("signal-generator discover"):
        details = await bus("signal-generator").call(_list_ports)
    return DiscoverResponse(candidates=[d.resource for d in details], details=details)


@router.post("/signal-generator/connect")
async def connect(req: ConnectRequest) -> dict:
    with handle_driver_errors("signal-generator connect"):
        idn = await bus("signal-generator").call(_do_connect, req.address.strip(), req.baud)
    return {"connected": True, "idn": idn}


@router.post("/signal-generator/disconnect")
async def disconnect() -> dict:
    with handle_driver_errors("signal-generator disconnect"):
        await bus("signal-generator").call(_do_disconnect)
    return {"connected": False, "idn": None}


@router.get("/signal-generator/state", response_model=SignalGeneratorState)
async def read_state() -> SignalGeneratorState:
    if state.signal_generator is None:
        return SignalGeneratorState(connected=False)
    with handle_driver_errors("signal-generator state"):
        return await bus("signal-generator").call(_read_state)


@router.post("/signal-generator/settings", response_model=SignalGeneratorState)
async def apply_settings(req: SettingsRequest) -> SignalGeneratorState:
    with handle_driver_errors("signal-generator settings"):
        return await bus("signal-generator").call(_do_apply, req)
