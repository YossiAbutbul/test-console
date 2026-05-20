"""HTTP API for instrument discovery + connect/disconnect.

Backed by:
  - `power_sensor` (Mini-Circuits) for USB power sensors (serial-based).
  - `dc_power_analyzer` (Keysight) for VISA-based DC analyzers.
  - `pyvisa` for generic VISA discovery (spectrum analyzers, etc.).
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Active connections (one per kind) ----------

class _Holder:
    power_sensor: object | None = None
    dc_analyzer: object | None = None
    spectrum: object | None = None
    power_sensor_idn: str | None = None
    dc_analyzer_idn: str | None = None
    spectrum_idn: str | None = None


_state = _Holder()


# ---------- Schemas ----------

class DiscoverResponse(BaseModel):
    candidates: list[str]


class ConnectRequest(BaseModel):
    address: str = Field(..., description="Serial (power-sensor) or VISA resource (others)")
    channel: Optional[int] = Field(default=None, ge=1, le=4)


class ConnectResponse(BaseModel):
    connected: bool
    idn: Optional[str]


# ---------- Helpers ----------

def _to_thread(fn, *args, **kwargs):
    return asyncio.to_thread(fn, *args, **kwargs)


def _list_visa_resources() -> list[str]:
    try:
        import pyvisa  # type: ignore
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"pyvisa not installed: {e}")
    rm = pyvisa.ResourceManager()
    try:
        return list(rm.list_resources())
    finally:
        try:
            rm.close()
        except Exception:
            pass


def _list_power_sensor_serials() -> list[str]:
    """Enumerate Mini-Circuits power sensors."""
    try:
        from power_sensor import PowerSensor  # type: ignore
    except ImportError as e:
        raise HTTPException(status_code=501, detail=f"power_sensor not installed: {e}")
    # Library API: prefer a `list_devices()` if present; fallback to single connect-probe.
    if hasattr(PowerSensor, "list_devices"):
        try:
            return [str(s) for s in PowerSensor.list_devices()]  # type: ignore[attr-defined]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"discover failed: {e}")
    # Probe with a no-arg connect, then disconnect, and report whatever serial it bound to.
    ps = PowerSensor()
    try:
        ps.connect()
        serial = getattr(ps, "serial", None) or getattr(ps, "serial_number", None)
        return [str(serial)] if serial else []
    except Exception:
        return []
    finally:
        try:
            ps.disconnect()
        except Exception:
            pass


# ---------- Discover endpoints ----------

@router.get("/discover/power-sensor", response_model=DiscoverResponse)
async def discover_power_sensor() -> DiscoverResponse:
    serials = await _to_thread(_list_power_sensor_serials)
    return DiscoverResponse(candidates=serials)


@router.get("/discover/dc-analyzer", response_model=DiscoverResponse)
async def discover_dc_analyzer() -> DiscoverResponse:
    res = await _to_thread(_list_visa_resources)
    return DiscoverResponse(candidates=res)


@router.get("/discover/spectrum", response_model=DiscoverResponse)
async def discover_spectrum() -> DiscoverResponse:
    res = await _to_thread(_list_visa_resources)
    return DiscoverResponse(candidates=res)


# ---------- Connect / Disconnect ----------

def _connect_power_sensor(serial: str) -> str:
    from power_sensor import PowerSensor  # type: ignore
    s = PowerSensor()
    s.connect(serial)
    _state.power_sensor = s
    idn = getattr(s, "idn", None) or getattr(s, "model_name", None) or "Mini-Circuits PowerSensor"
    _state.power_sensor_idn = str(idn)
    return _state.power_sensor_idn


def _disconnect_power_sensor() -> None:
    s = _state.power_sensor
    _state.power_sensor = None
    _state.power_sensor_idn = None
    if s is not None:
        try:
            s.disconnect()
        except Exception:
            pass


def _connect_dc_analyzer(resource: str, channel: int) -> str:
    from dc_power_analyzer import DCPowerAnalyzer  # type: ignore
    a = DCPowerAnalyzer(resource=resource) if resource else DCPowerAnalyzer()
    a.connect()
    _state.dc_analyzer = a
    idn = getattr(a, "idn", None) or "Keysight DC Power Analyzer"
    _state.dc_analyzer_idn = str(idn)
    return _state.dc_analyzer_idn


def _disconnect_dc_analyzer() -> None:
    a = _state.dc_analyzer
    _state.dc_analyzer = None
    _state.dc_analyzer_idn = None
    if a is not None:
        try:
            a.disconnect()
        except Exception:
            pass


def _connect_spectrum(resource: str) -> str:
    import pyvisa  # type: ignore
    rm = pyvisa.ResourceManager()
    inst = rm.open_resource(resource)
    try:
        idn = inst.query("*IDN?").strip()
    except Exception:
        idn = "Spectrum Analyzer"
    _state.spectrum = inst
    _state.spectrum_idn = idn
    return idn


def _disconnect_spectrum() -> None:
    inst = _state.spectrum
    _state.spectrum = None
    _state.spectrum_idn = None
    if inst is not None:
        try:
            inst.close()
        except Exception:
            pass


@router.post("/power-sensor/connect", response_model=ConnectResponse)
async def connect_power_sensor(req: ConnectRequest) -> ConnectResponse:
    try:
        idn = await _to_thread(_connect_power_sensor, req.address)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return ConnectResponse(connected=True, idn=idn)


@router.post("/power-sensor/disconnect", response_model=ConnectResponse)
async def disconnect_power_sensor() -> ConnectResponse:
    await _to_thread(_disconnect_power_sensor)
    return ConnectResponse(connected=False, idn=None)


@router.post("/dc-analyzer/connect", response_model=ConnectResponse)
async def connect_dc_analyzer(req: ConnectRequest) -> ConnectResponse:
    try:
        idn = await _to_thread(_connect_dc_analyzer, req.address, req.channel or 1)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return ConnectResponse(connected=True, idn=idn)


@router.post("/dc-analyzer/disconnect", response_model=ConnectResponse)
async def disconnect_dc_analyzer() -> ConnectResponse:
    await _to_thread(_disconnect_dc_analyzer)
    return ConnectResponse(connected=False, idn=None)


@router.post("/spectrum/connect", response_model=ConnectResponse)
async def connect_spectrum(req: ConnectRequest) -> ConnectResponse:
    try:
        idn = await _to_thread(_connect_spectrum, req.address)
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"connect failed: {e}")
    return ConnectResponse(connected=True, idn=idn)


@router.post("/spectrum/disconnect", response_model=ConnectResponse)
async def disconnect_spectrum() -> ConnectResponse:
    await _to_thread(_disconnect_spectrum)
    return ConnectResponse(connected=False, idn=None)
