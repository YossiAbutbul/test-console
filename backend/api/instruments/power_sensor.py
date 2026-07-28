"""Mini-Circuits USB power sensor routes."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from ..errors import DriverUnavailable, handle_driver_errors
from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverCandidate,
    DiscoverResponse,
)
from ._state import state

router = APIRouter(prefix="/instruments", tags=["instruments"])


def _enumerate_serials() -> list[str]:
    """Return serials via whichever class method the lib exposes."""
    try:
        from power_sensor import PowerSensor  # type: ignore
    except ImportError as e:
        # Runs in a worker thread — raise a plain driver error, not HTTPException.
        # The route wraps this in `handle_driver_errors`, which maps it to 501.
        raise DriverUnavailable(f"power_sensor not installed: {e}") from e
    for attr in ("list_available", "list_devices"):
        fn = getattr(PowerSensor, attr, None)
        if fn is not None:
            try:
                return [str(s) for s in fn()]
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"discover failed: {e}")
    # Last-resort: connect-probe to grab whatever's bound.
    ps = PowerSensor()
    try:
        ps.connect()
        serial = getattr(ps, "serial_number", None) or getattr(ps, "serial", None)
        return [str(serial)] if serial else []
    except Exception:
        return []
    finally:
        try:
            ps.disconnect()
        except Exception:
            pass


def _format_idn(ps) -> str:
    model = getattr(ps, "model_name", None) or ""
    serial = getattr(ps, "serial_number", None) or getattr(ps, "serial", None) or ""
    fw = getattr(ps, "firmware_version", None) or ""
    parts = [str(model), str(serial), str(fw)]
    return ",".join(p for p in parts if p)


def _probe_idn(serial: str, count_hint: int) -> str | None:
    """Open a sensor by serial, read identity, disconnect."""
    try:
        from power_sensor import PowerSensor  # type: ignore
    except ImportError:
        return None
    ps = PowerSensor()
    bound = False
    try:
        try:
            ps.connect(serial)
            bound = True
        except AttributeError:
            # Lib build without Connect_By_SN. If only one sensor exists the
            # no-arg connect is unambiguous; otherwise we can't probe by SN.
            if count_hint == 1:
                ps.connect()
                bound = True
        except Exception:
            return None
        if not bound:
            return None
        try:
            return _format_idn(ps) or None
        except Exception:
            return None
    finally:
        try:
            ps.disconnect()
        except Exception:
            pass


def _list_with_idn() -> list[DiscoverCandidate]:
    serials = _enumerate_serials()
    held_sn = None
    if state.power_sensor is not None:
        held_sn = (
            getattr(state.power_sensor, "serial_number", None)
            or getattr(state.power_sensor, "serial", None)
        )
    out: list[DiscoverCandidate] = []
    for sn in serials:
        if held_sn and str(sn) == str(held_sn):
            out.append(DiscoverCandidate(resource=str(sn), idn=state.power_sensor_idn))
            continue
        out.append(DiscoverCandidate(resource=str(sn), idn=_probe_idn(sn, len(serials))))
    return out


def _connect(serial: str) -> str:
    from power_sensor import PowerSensor  # type: ignore
    s = PowerSensor()
    sn = (serial or "").strip()
    # lib's connect(serial) dispatches to usb_pm.Connect_By_SN which is missing
    # on some driver builds — fall back to no-arg connect (binds first device).
    if sn:
        try:
            s.connect(sn)
        except AttributeError:
            s.connect()
    else:
        s.connect()
    state.power_sensor = s
    state.power_sensor_idn = _format_idn(s) or "PowerSensor"
    return state.power_sensor_idn


def _disconnect() -> None:
    s = state.power_sensor
    state.power_sensor = None
    state.power_sensor_idn = None
    if s is not None:
        try:
            s.disconnect()
        except Exception:
            pass


@router.get("/discover/power-sensor", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    with handle_driver_errors("power sensor discover"):
        details = await asyncio.to_thread(_list_with_idn)
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/power-sensor/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    with handle_driver_errors("power sensor connect"):
        idn = await asyncio.to_thread(_connect, req.address)
    return ConnectResponse(connected=True, idn=idn)


@router.post("/power-sensor/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    with handle_driver_errors("power sensor disconnect"):
        await asyncio.to_thread(_disconnect)
    return ConnectResponse(connected=False, idn=None)
