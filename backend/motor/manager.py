"""Arcus DMX-J-SA trombone motor adapter.

Wrapper: https://github.com/YossiAbutbul/DMX-J-SA-Motor-python-interface

Encapsulates the motor handle, default config, and soft-limit gating.
The HTTP layer (`backend/api/motor.py`) is a thin router over these calls.

Units: pulses (3200 / revolution).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Software travel limits — the firmware has no programmable limits, so we gate
# every move at the API layer. Values measured manually for the current rig.
# Between Min to Max there is 51,800 pulses
SOFT_MIN_POS = -48000  # retracted mech end
SOFT_MAX_POS = 3800   # extended mech end


@dataclass
class MotorState:
    motor: object | None = None
    device_index: int = 0


state = MotorState()


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
        return int(m.position)
    except Exception:
        return None


def _is_moving() -> bool:
    m = state.motor
    if m is None:
        return False
    try:
        return bool(m.is_moving())
    except Exception:
        return False


def read_status() -> dict:
    return {
        "connected": state.motor is not None,
        "moving": _is_moving(),
        "position": read_position(),
        "device_index": state.device_index if state.motor is not None else None,
        "soft_min": SOFT_MIN_POS,
        "soft_max": SOFT_MAX_POS,
    }


def move(position: int, absolute: bool = True) -> None:
    """Move motor. Caller should target absolute or step (incremental).

    Raises ValueError if resulting target is outside [SOFT_MIN_POS, SOFT_MAX_POS].
    """
    m = _require()
    cur = read_position() or 0
    target = position if absolute else cur + position
    if not (SOFT_MIN_POS <= target <= SOFT_MAX_POS):
        raise ValueError(
            f"target {target} outside soft limits [{SOFT_MIN_POS}, {SOFT_MAX_POS}]"
        )
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
    (m.home_positive if positive else m.home_negative)()


def stop() -> None:
    m = _require()
    if hasattr(m, "abort"):
        m.abort()
    elif hasattr(m, "stop"):
        m.stop()
