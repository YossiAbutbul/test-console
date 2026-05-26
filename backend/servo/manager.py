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
    """
    try:
        import serial  # type: ignore
    except ImportError:
        return None
    try:
        h = serial.Serial(
            port=port,
            baudrate=BAUD,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.5,
            write_timeout=1.0,
        )
    except Exception:
        return None
    try:
        time.sleep(2.0)  # arduino reset settle
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
        try:
            s = serial.Serial(
                port=port,
                baudrate=BAUD,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=READ_TIMEOUT_S,
                write_timeout=WRITE_TIMEOUT_S,
            )
        except Exception as e:
            raise RuntimeError(f"open {port} failed: {e}")
        # Arduino resets on DTR — wait for sketch boot before first write.
        time.sleep(2.0)
        try:
            s.reset_input_buffer()
        except Exception:
            pass
        state.serial = s
        state.port = port
        state.last_command = None
        state.last_response = None
        state.idn = None
        # Probe sketch identity. Arduino is expected to respond to "*IDN?" with
        # a SCPI-style comma-separated string. Missing handler -> idn stays None.
        try:
            s.write(b"*IDN?\n")
            try:
                s.flush()
            except Exception:
                pass
            # Give the sketch a moment to reply.
            time.sleep(0.1)
            raw = s.readline()
            if raw:
                txt = raw.decode("ascii", errors="replace").strip()
                if txt:
                    state.idn = txt
        except Exception:
            pass
        return port


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
    try:
        s.close()  # type: ignore[attr-defined]
    except Exception:
        pass


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
