"""HTTP API for instrument discovery + connect/disconnect.

Backed by:
  - `power_sensor` (Mini-Circuits) for USB power sensors (serial-based).
  - `dc_power_analyzer` (Keysight) for VISA-based DC analyzers.
  - `pyvisa` for generic VISA discovery (spectrum analyzers, etc.).
"""

from __future__ import annotations

import asyncio
import time
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
    dc_analyzer_channel: int = 1


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


# ---------- Status ----------

class InstrumentStatus(BaseModel):
    connected: bool
    idn: Optional[str] = None


class StatusResponse(BaseModel):
    power_sensor: InstrumentStatus
    dc_analyzer: InstrumentStatus
    spectrum: InstrumentStatus


@router.get("/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    return StatusResponse(
        power_sensor=InstrumentStatus(
            connected=_state.power_sensor is not None,
            idn=_state.power_sensor_idn,
        ),
        dc_analyzer=InstrumentStatus(
            connected=_state.dc_analyzer is not None,
            idn=_state.dc_analyzer_idn,
        ),
        spectrum=InstrumentStatus(
            connected=_state.spectrum is not None,
            idn=_state.spectrum_idn,
        ),
    )


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
    _state.power_sensor = s
    idn = (
        getattr(s, "idn", None)
        or getattr(s, "model_name", None)
        or getattr(s, "serial", None)
        or getattr(s, "serial_number", None)
        or "Mini-Circuits PowerSensor"
    )
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
    _state.dc_analyzer_channel = channel
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


# ---------- Single-shot measurement ----------

class MeasureResponse(BaseModel):
    power_dbm: Optional[float] = None
    current_a: Optional[float] = None
    voltage_v: Optional[float] = None
    power_sensor_connected: bool = False
    dc_analyzer_connected: bool = False
    t_ms: int = 0
    error: Optional[str] = None


def _read_power_dbm(freq_hz: Optional[int]) -> Optional[float]:
    s = _state.power_sensor
    if s is None:
        return None
    try:
        if freq_hz is not None and hasattr(s, "frequency_mhz"):
            try:
                s.frequency_mhz = freq_hz / 1e6  # type: ignore[attr-defined]
            except Exception:
                pass
        reader = getattr(s, "read_power", None)
        if reader is None:
            return None
        # retry briefly on sentinel reading
        last = -999.0
        for _ in range(5):
            v = float(reader("dBm"))
            last = v
            if v > -100.0:
                return v
            time.sleep(0.05)
        return last
    except Exception as e:
        raise RuntimeError(f"power read failed: {e}")


def _read_dc() -> tuple[Optional[float], Optional[float]]:
    a = _state.dc_analyzer
    if a is None:
        return None, None
    ch = _state.dc_analyzer_channel
    try:
        cur = float(a.measure_current(ch))  # type: ignore[attr-defined]
    except Exception:
        cur = None
    try:
        volt = float(a.measure_voltage(ch))  # type: ignore[attr-defined]
    except Exception:
        volt = None
    return cur, volt


@router.post("/measure", response_model=MeasureResponse)
async def measure(freq_hz: Optional[int] = None) -> MeasureResponse:
    t0 = time.perf_counter()
    ps_connected = _state.power_sensor is not None
    dc_connected = _state.dc_analyzer is not None
    if not ps_connected and not dc_connected:
        return MeasureResponse(
            power_sensor_connected=False,
            dc_analyzer_connected=False,
            t_ms=0,
        )
    err: Optional[str] = None
    p_dbm: Optional[float] = None
    cur: Optional[float] = None
    volt: Optional[float] = None
    try:
        if ps_connected:
            p_dbm = await _to_thread(_read_power_dbm, freq_hz)
        if dc_connected:
            cur, volt = await _to_thread(_read_dc)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    return MeasureResponse(
        power_dbm=p_dbm,
        current_a=cur,
        voltage_v=volt,
        power_sensor_connected=ps_connected,
        dc_analyzer_connected=dc_connected,
        t_ms=int((time.perf_counter() - t0) * 1000),
        error=err,
    )
