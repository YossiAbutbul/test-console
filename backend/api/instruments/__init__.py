"""HTTP API for instrument discovery, connect/disconnect, status, and measurement.

Per-device routes live in sibling modules:
  - power_sensor.py — Mini-Circuits USB power sensors.
  - dc_analyzer.py  — Keysight DC analyzer (also hosts /dc-analyzer/supply).
  - spectrum.py     — Generic VISA spectrum analyzers.

This module aggregates them under a single `router` and adds cross-device
endpoints (`/instruments/status`, `/instruments/measure`).
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from . import dc_analyzer, network_analyzer, power_sensor, spectrum
from ._common import to_thread
from ._state import state

router = APIRouter()
router.include_router(power_sensor.router)
router.include_router(dc_analyzer.router)
router.include_router(spectrum.router)
router.include_router(network_analyzer.router)

_aggregate = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Status ----------

class InstrumentStatus(BaseModel):
    connected: bool
    idn: Optional[str] = None


class StatusResponse(BaseModel):
    power_sensor: InstrumentStatus
    dc_analyzer: InstrumentStatus
    spectrum: InstrumentStatus
    network_analyzer: InstrumentStatus


@_aggregate.get("/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    return StatusResponse(
        power_sensor=InstrumentStatus(
            connected=state.power_sensor is not None,
            idn=state.power_sensor_idn,
        ),
        dc_analyzer=InstrumentStatus(
            connected=state.dc_analyzer is not None,
            idn=state.dc_analyzer_idn,
        ),
        spectrum=InstrumentStatus(
            connected=state.spectrum is not None,
            idn=state.spectrum_idn,
        ),
        network_analyzer=InstrumentStatus(
            connected=state.network_analyzer is not None,
            idn=state.network_analyzer_idn,
        ),
    )


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
    s = state.power_sensor
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
    a = state.dc_analyzer
    if a is None:
        return None, None
    ch = state.dc_analyzer_channel
    try:
        cur = float(a.measure_current(ch))  # type: ignore[attr-defined]
    except Exception:
        cur = None
    try:
        volt = float(a.measure_voltage(ch))  # type: ignore[attr-defined]
    except Exception:
        volt = None
    return cur, volt


@_aggregate.post("/measure", response_model=MeasureResponse)
async def measure(freq_hz: Optional[int] = None) -> MeasureResponse:
    t0 = time.perf_counter()
    ps_connected = state.power_sensor is not None
    dc_connected = state.dc_analyzer is not None
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
            p_dbm = await to_thread(_read_power_dbm, freq_hz)
        if dc_connected:
            cur, volt = await to_thread(_read_dc)
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


router.include_router(_aggregate)

__all__ = ["router"]
