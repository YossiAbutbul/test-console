"""Arduino-controlled servo (RF switch) adapter.

Protocol (ASCII, newline-terminated, 9600-8N1):
  - "<angle>"    where angle is 0..180 — move servo to angle
  - "VNA"        — go to saved VNA position
  - "PCB"        — go to saved PCB position
  - "VNA SET"    — store current servo position as VNA
  - "PCB SET"    — store current servo position as PCB

Saved positions live on the Arduino. Host tracks the last commanded angle so
the UI can display a best-effort current position.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional

BAUD = 9600
READ_TIMEOUT_S = 0.5
WRITE_TIMEOUT_S = 1.0


@dataclass
class ServoState:
    serial: object | None = None
    port: Optional[str] = None
    idn: Optional[str] = None              # response to "*IDN?" at connect
    last_angle: Optional[int] = None       # last numeric angle commanded
    last_command: Optional[str] = None     # last raw command sent
    last_response: Optional[str] = None    # most recent line read from arduino


state = ServoState()
_lock = threading.Lock()


def _open_serial(port: str, timeout: float, write_timeout: float):
    """Open a serial port WITHOUT pulsing DTR/RTS.

    The classic Arduino auto-reset fires when DTR is asserted on open. Doing
    that on every IDN probe / connect re-enumerates cheap USB-serial chips
    (CH340) and intermittently wedges the Windows driver — the next open then
    fails with PermissionError 13 ("device not functioning"). Setting dtr/rts
    low *before* opening suppresses the reset; the sketch keeps running.
    """
    import serial  # type: ignore
    s = serial.Serial()
    s.port = port
    s.baudrate = BAUD
    s.bytesize = serial.EIGHTBITS
    s.parity = serial.PARITY_NONE
    s.stopbits = serial.STOPBITS_ONE
    s.timeout = timeout
    s.write_timeout = write_timeout
    try:
        s.dtr = False
        s.rts = False
    except Exception:
        pass
    s.open()
    return s


# ---------- Discovery ----------

def discover() -> list[str]:
    """Enumerate available serial ports (e.g. COM3, /dev/ttyUSB0)."""
    try:
        from serial.tools import list_ports  # type: ignore
    except ImportError as e:
        raise RuntimeError(f"pyserial not installed: {e}")
    return [p.device for p in list_ports.comports()]


def _probe_idn(port: str) -> Optional[str]:
    """Open `port` briefly, send *IDN?\\n, return one-line reply.

    Opening pulses DTR so an Arduino resets — we wait 2 s for the sketch to
    boot before sending. Returns None on any failure.

    Held under `_lock` so a probe can never open the port concurrently with a
    `connect()` / `_send()` — concurrent opens on the same COM port wedge the
    USB-serial driver (PermissionError 13, "device not functioning").
    """
    try:
        import serial  # type: ignore
    except ImportError:
        return None
    with _lock:
        try:
            h = _open_serial(port, timeout=0.5, write_timeout=1.0)
        except Exception:
            return None
        try:
            time.sleep(0.3)  # no DTR reset now — just a short settle
            try:
                h.reset_input_buffer()
            except Exception:
                pass
            try:
                h.write(b"*IDN?\n")
                try:
                    h.flush()
                except Exception:
                    pass
            except Exception:
                return None
            time.sleep(0.15)
            try:
                raw = h.readline()
            except Exception:
                return None
            if not raw:
                return None
            txt = raw.decode("ascii", errors="replace").strip()
            return txt or None
        finally:
            try:
                h.close()
            except Exception:
                pass
            # Let the USB-serial driver fully release the handle before the
            # lock is dropped, so a Connect right after a scan reopens cleanly.
            time.sleep(0.3)


def discover_with_idn() -> list[dict]:
    """Same as `discover()` but probes each port for `*IDN?` response.

    Skips probing the port currently held by our own session (reuses cached
    `state.idn`) so we don't collide with the live connection.
    """
    out: list[dict] = []
    with _lock:
        own_port = state.port
        own_idn = state.idn
    for p in discover():
        if own_port == p:
            out.append({"port": p, "idn": own_idn})
            continue
        out.append({"port": p, "idn": _probe_idn(p)})
    return out


# ---------- Connect / Disconnect ----------

def connect(port: str) -> str:
    with _lock:
        if state.serial is not None:
            if state.port == port:
                return port
            _close_locked()
        try:
            import serial  # type: ignore
        except ImportError as e:
            raise RuntimeError(f"pyserial not installed: {e}")
        # Open with a few retries. A just-finished IDN probe (or the USB-serial
        # driver settling after a DTR reset) can briefly leave the port
        # un-openable — Windows raises PermissionError 13 / "device not
        # functioning". A short backoff usually clears it without a replug.
        # Open WITHOUT the DTR reset (see _open_serial). Re-asserting DTR on a
        # reconnect resets the Arduino, which re-enumerates the USB-serial port
        # and makes the very next open fail with PermissionError 13. Opening
        # with DTR/RTS held low keeps the already-running sketch alive and lets
        # disconnect→reconnect work without a replug. Fall back to a plain
        # (reset) open only if the no-reset open is unsupported.
        s = None
        last_err: Optional[Exception] = None
        for attempt in range(5):
            try:
                s = _open_serial(port, timeout=READ_TIMEOUT_S, write_timeout=WRITE_TIMEOUT_S)
                break
            except Exception as e:
                last_err = e
                # Fallback: plain open (asserts DTR / may reset the sketch).
                try:
                    s = serial.Serial(
                        port=port, baudrate=BAUD,
                        bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE,
                        stopbits=serial.STOPBITS_ONE,
                        timeout=READ_TIMEOUT_S, write_timeout=WRITE_TIMEOUT_S,
                    )
                    break
                except Exception as e2:
                    last_err = e2
                    time.sleep(0.5 * (attempt + 1))
        if s is None:
            raise RuntimeError(f"open {port} failed: {last_err}")
        # If the adapter reset the Arduino on open, it emits framing noise
        # (0x00/0xFF) and a boot banner ("Ready:"). Wait for boot, then drain
        # the input until it goes quiet so that noise never reaches a real read.
        _drain_boot(s)
        state.serial = s
        state.port = port
        state.last_command = None
        state.last_response = None
        state.idn = None
        # Probe sketch identity. Arduino is expected to respond to "*IDN?" with
        # a SCPI-style comma-separated string. Missing handler -> idn stays None.
        try:
            s.reset_input_buffer()
            s.write(b"*IDN?\n")
            try:
                s.flush()
            except Exception:
                pass
            time.sleep(0.15)
            raw = s.readline()
            if raw:
                txt = raw.decode("ascii", errors="replace").strip()
                # Keep only printable ASCII so leftover framing noise can't
                # masquerade as an IDN string.
                txt = "".join(c for c in txt if 32 <= ord(c) < 127).strip()
                if txt:
                    state.idn = txt
        except Exception:
            pass
        return port


def _drain_boot(s, settle: float = 1.6, quiet: float = 0.25, budget: float = 3.0) -> None:
    """Discard reset noise + boot banner after open.

    Waits `settle` for the sketch to boot, then keeps clearing the input buffer
    until no new bytes arrive for `quiet` seconds (or `budget` elapses), so the
    0x00/0xFF framing noise and the "Ready:" banner never reach a real read.
    """
    time.sleep(settle)
    t0 = time.time()
    last_data = time.time()
    while time.time() - t0 < budget:
        try:
            n = s.in_waiting
        except Exception:
            n = 0
        if n:
            try:
                s.read(n)
            except Exception:
                pass
            last_data = time.time()
        elif time.time() - last_data >= quiet:
            break
        time.sleep(0.05)
    try:
        s.reset_input_buffer()
    except Exception:
        pass


def _close_locked() -> None:
    s = state.serial
    state.serial = None
    state.port = None
    state.idn = None
    state.last_angle = None
    state.last_command = None
    state.last_response = None
    if s is None:
        return
    # Drop control lines before closing so the adapter isn't left holding the
    # line, then give Windows a moment to actually release the COM handle —
    # reopening too soon after close raises PermissionError 13.
    try:
        s.dtr = False  # type: ignore[attr-defined]
        s.rts = False  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        s.close()  # type: ignore[attr-defined]
    except Exception:
        pass
    time.sleep(0.6)


def disconnect() -> None:
    with _lock:
        _close_locked()


# ---------- Status ----------

def read_status() -> dict:
    return {
        "connected": state.serial is not None,
        "port": state.port,
        "idn": state.idn,
        "last_angle": state.last_angle,
        "last_command": state.last_command,
        "last_response": state.last_response,
        "baud": BAUD,
    }


# ---------- Commands ----------

def _send(cmd: str) -> str:
    with _lock:
        s = state.serial
        if s is None:
            raise RuntimeError("Servo not connected")
        line = (cmd + "\n").encode("ascii")
        try:
            s.write(line)  # type: ignore[attr-defined]
            try:
                s.flush()  # type: ignore[attr-defined]
            except Exception:
                pass
        except Exception as e:
            raise RuntimeError(f"write failed: {e}")
        state.last_command = cmd
        # Best-effort read a single response line (non-blocking; arduino may not reply).
        resp = ""
        try:
            raw = s.readline()  # type: ignore[attr-defined]
            if raw:
                resp = raw.decode("ascii", errors="replace").strip()
        except Exception:
            resp = ""
        state.last_response = resp or None
        return resp


def move_angle(angle: int) -> str:
    if not (0 <= angle <= 180):
        raise ValueError(f"angle {angle} out of range 0..180")
    resp = _send(str(angle))
    state.last_angle = angle
    return resp


def goto(target: str) -> str:
    t = target.strip().upper()
    if t not in ("VNA", "PCB"):
        raise ValueError(f"target {target!r} must be VNA or PCB")
    resp = _send(t)
    # Angle now unknown (arduino-saved position).
    state.last_angle = None
    return resp


def save(target: str) -> str:
    t = target.strip().upper()
    if t not in ("VNA", "PCB"):
        raise ValueError(f"target {target!r} must be VNA or PCB")
    return _send(f"{t} SET")
