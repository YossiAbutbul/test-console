"""Arcus DMX-J-SA trombone motor adapter.

Wrapper: https://github.com/YossiAbutbul/DMX-J-SA-Motor-python-interface

Encapsulates the motor handle, default config, and soft-limit gating.
The HTTP layer (`backend/api/motor.py`) is a thin router over these calls.

Units: pulses (3200 / revolution).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional

# Software travel limits — the firmware has no programmable limits, so we gate
# every move at the API layer. There are NO hardcoded values: the user defines
# the travel range at runtime by jogging the motor to each mechanical end and
# capturing the position. Until both are set, moves/jogs are ungated (the user
# is in manual control via press-and-hold), so callers must set them first for
# any automated sweep.

# Speed config (pulses/sec). The normal high speed is applied at connect; the
# continuous jog uses a reduced speed so press-and-hold positioning is safe.
DEFAULT_HIGH_SPEED = 5000
JOG_SPEED = 800

# Serialize all DLL I/O. The continuous-jog safety monitor runs on its own
# thread and would otherwise race the status-poll / move calls on the USB DLL.
_io_lock = threading.RLock()


@dataclass
class MotorState:
    motor: object | None = None
    device_index: int = 0
    # User-defined soft travel limits (pulses). None = unset / ungated.
    soft_min: Optional[int] = None
    soft_max: Optional[int] = None


state = MotorState()


def set_limits(soft_min: Optional[int], soft_max: Optional[int]) -> None:
    """Set (or clear) the user-defined soft travel limits.

    Pass None for either to leave that side unbounded. If both are given and
    reversed, they are swapped so soft_min <= soft_max.
    """
    if soft_min is not None and soft_max is not None and soft_min > soft_max:
        soft_min, soft_max = soft_max, soft_min
    state.soft_min = soft_min
    state.soft_max = soft_max

# Continuous-jog runtime: a watcher thread polls position and issues STOP the
# moment the motor crosses a soft limit, since raw J+/J- ignore them.
_jog_stop_evt = threading.Event()
_jog_thread: Optional[threading.Thread] = None


# ---------- Lib loading ----------

def _load_classes():
    from dmx_j_sa import DmxJsa  # type: ignore
    from dmx_j_sa.performax import PerformaxDLL  # type: ignore
    return DmxJsa, PerformaxDLL


# ---------- Public sync API (call from a worker thread) ----------

def discover() -> list[str]:
    DmxJsa, _ = _load_classes()
    return [str(d) for d in DmxJsa.list_devices()]


def connect(device_index: int) -> int:
    """Open device + apply default motion config. Idempotent."""
    if state.motor is not None:
        return state.device_index
    DmxJsa, PerformaxDLL = _load_classes()
    # Performax requires GetNumDevices to be called before Open or Open fails
    # with GetLastError=0. open_first() does this; emulate for explicit index.
    dll = PerformaxDLL()
    n = dll.num_devices()
    if n == 0:
        raise RuntimeError("no Performax USB devices found")
    if device_index >= n:
        raise RuntimeError(f"device_index={device_index} out of range (found {n})")
    m = DmxJsa(
        device_index=device_index, dll=dll,
        read_timeout_ms=2000, write_timeout_ms=2000,
    )
    # Motor Configs
    try:
        m.enable(True)
        m.high_speed = 5000
        m.low_speed = 500
        m.acceleration = 300
        m.run_current = 2000
        m.idle_current = 300
    except Exception:
        pass
    state.motor = m
    state.device_index = device_index
    return device_index


def disconnect() -> None:
    m = state.motor
    state.motor = None
    if m is None:
        return
    try:
        m.enable(False)
    except Exception:
        pass
    for fn in ("close", "disconnect"):
        if hasattr(m, fn):
            try:
                getattr(m, fn)()
            except Exception:
                pass
            return


def _require():
    if state.motor is None:
        raise RuntimeError("Motor not connected")
    return state.motor


def read_position() -> Optional[int]:
    m = state.motor
    if m is None:
        return None
    try:
        with _io_lock:
            return int(m.position)
    except Exception:
        return None


def _is_moving() -> bool:
    m = state.motor
    if m is None:
        return False
    try:
        with _io_lock:
            return bool(m.is_moving())
    except Exception:
        return False


def read_status() -> dict:
    return {
        "connected": state.motor is not None,
        "moving": _is_moving(),
        "position": read_position(),
        "device_index": state.device_index if state.motor is not None else None,
        "soft_min": state.soft_min,
        "soft_max": state.soft_max,
    }


def move(position: int, absolute: bool = True) -> None:
    """Move motor. Caller should target absolute or step (incremental).

    Raises ValueError if a user-defined soft limit is set and the resulting
    target is outside it. With no limits set, the move is ungated.
    """
    m = _require()
    cur = read_position() or 0
    target = position if absolute else cur + position
    lo, hi = state.soft_min, state.soft_max
    if (lo is not None and target < lo) or (hi is not None and target > hi):
        raise ValueError(
            f"target {target} outside soft limits [{lo}, {hi}]"
        )
    with _io_lock:
        if absolute and hasattr(m, "set_absolute_mode"):
            m.set_absolute_mode()
        elif not absolute and hasattr(m, "set_incremental_mode"):
            m.set_incremental_mode()
        if absolute and hasattr(m, "move_absolute"):
            m.move_absolute(position)
        else:
            m.move(position)


def home(positive: bool) -> None:
    m = _require()
    with _io_lock:
        (m.home_positive if positive else m.home_negative)()


def stop() -> None:
    m = _require()
    _jog_stop_evt.set()  # also halts any running jog watcher
    with _io_lock:
        if hasattr(m, "abort"):
            m.abort()
        elif hasattr(m, "stop"):
            m.stop()


def _set_high_speed(m, hz: int) -> None:
    try:
        with _io_lock:
            m.high_speed = int(hz)
    except Exception:
        pass


def jog_start(positive: bool, speed: Optional[int] = None) -> None:
    """Begin continuous motion (J+/J-) at a reduced speed until `jog_stop`.

    A daemon watcher thread polls position and stops the motor at the soft
    limit, because the raw jog command has no limit awareness.
    """
    global _jog_thread
    m = _require()

    lo, hi = state.soft_min, state.soft_max
    # Refuse to start if a limit is set and we're already at/past it.
    pos = read_position() or 0
    if positive and hi is not None and pos >= hi:
        raise ValueError(f"already at max soft limit ({hi})")
    if not positive and lo is not None and pos <= lo:
        raise ValueError(f"already at min soft limit ({lo})")

    # Stop any prior jog cleanly and wait until the motor is fully idle. The
    # controller rejects a fresh J+/J- with '?Moving' while it is still
    # decelerating, so we must not issue the new jog until motion has settled.
    jog_stop()
    t0 = time.time()
    while _is_moving() and time.time() - t0 < 2.0:
        time.sleep(0.02)

    _set_high_speed(m, speed or JOG_SPEED)
    with _io_lock:
        try:
            if positive:
                m.jog_positive()
            else:
                m.jog_negative()
        except Exception as e:
            # '?Moving' means the motor is already in motion — benign for a
            # continuous jog, so don't surface it as an error.
            if "moving" not in str(e).lower():
                raise

    _jog_stop_evt.clear()

    def _watch() -> None:
        while not _jog_stop_evt.wait(0.03):
            # No limit set in this direction → nothing to enforce; the user
            # stops the jog manually by releasing the arrow.
            limit = hi if positive else lo
            if limit is None:
                continue
            p = read_position()
            if p is None:
                continue
            if (positive and p >= limit) or (not positive and p <= limit):
                with _io_lock:
                    try:
                        m.stop()
                    except Exception:
                        pass
                break

    _jog_thread = threading.Thread(target=_watch, daemon=True)
    _jog_thread.start()


def jog_stop() -> None:
    """Stop continuous motion and restore the normal high speed."""
    m = state.motor
    _jog_stop_evt.set()
    t = _jog_thread
    if t is not None and t.is_alive():
        t.join(timeout=0.5)
    if m is None:
        return
    with _io_lock:
        try:
            m.stop()
        except Exception:
            pass
    _set_high_speed(m, DEFAULT_HIGH_SPEED)
