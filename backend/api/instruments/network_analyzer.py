"""Agilent/Keysight E5061B Network Analyzer routes.

Wrapper: `network_analyzer.NetworkAnalyzer` (rf-instrument-wrappers).

Provides connect/disconnect, start/stop frequency control, host-side markers
(N up to 9), and a single-shot measurement that triggers a sweep and returns
per-marker S11 complex + impedance (R, jX).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..errors import handle_driver_errors
from ._common import (
    ConnectRequest,
    ConnectResponse,
    DiscoverResponse,
    bound_resource,
    discover_visa,
)
from ._state import state

router = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Connect / Disconnect ----------

def _force_free_run(a) -> None:
    """Put E5061B in continuous internal trigger so display keeps sweeping."""
    dev = getattr(a, "_dev", None)
    if dev is None:
        return
    try:
        dev.write("TRIG:SOUR INT")
        dev.write("INIT:CONT ON")
    except Exception:
        pass


def _connect(resource: str) -> str:
    from network_analyzer import NetworkAnalyzer  # type: ignore
    a = NetworkAnalyzer(resource=resource) if resource else NetworkAnalyzer()
    a.connect()
    _force_free_run(a)
    state.network_analyzer = a
    # See dc_analyzer._connect — record what VISA resolved, not what was typed.
    state.network_analyzer_resource = bound_resource(a, resource)
    try:
        idn = str(a.idn)
    except Exception:
        idn = "Network Analyzer"
    state.network_analyzer_idn = idn
    if state.network_analyzer_markers is None:
        state.network_analyzer_markers = []
    return idn


def _disconnect() -> None:
    a = state.network_analyzer
    state.network_analyzer = None
    state.network_analyzer_idn = None
    state.network_analyzer_resource = None
    if a is not None:
        try:
            a.disconnect()
        except Exception:
            pass


@router.get("/discover/network-analyzer", response_model=DiscoverResponse)
async def discover() -> DiscoverResponse:
    with handle_driver_errors("vna discover"):
        details = await discover_visa()
    return DiscoverResponse(
        candidates=[d.resource for d in details],
        details=details,
    )


@router.post("/network-analyzer/connect", response_model=ConnectResponse)
async def connect(req: ConnectRequest) -> ConnectResponse:
    with handle_driver_errors("vna connect"):
        idn = await asyncio.to_thread(_connect, req.address)
    return ConnectResponse(connected=True, idn=idn)


@router.post("/network-analyzer/disconnect", response_model=ConnectResponse)
async def disconnect() -> ConnectResponse:
    with handle_driver_errors("vna disconnect"):
        await asyncio.to_thread(_disconnect)
    return ConnectResponse(connected=False, idn=None)


# ---------- Config (start/stop/points + markers) ----------

class ConfigResponse(BaseModel):
    connected: bool
    idn: str | None = None
    start_hz: float | None = None
    stop_hz: float | None = None
    points: int | None = None
    if_bandwidth_hz: float | None = None
    source_power_dbm: float | None = None
    markers: list[float] = []


class FreqRequest(BaseModel):
    start_hz: float = Field(..., gt=0)
    stop_hz: float = Field(..., gt=0)
    points: int | None = Field(default=None, ge=2, le=20001)


class MarkersRequest(BaseModel):
    markers: list[float] = Field(default_factory=list)


def _read_config() -> ConfigResponse:
    a = state.network_analyzer
    if a is None:
        return ConfigResponse(connected=False, markers=state.network_analyzer_markers or [])
    try:
        start = float(a.start_freq_hz)  # type: ignore[attr-defined]
    except Exception:
        start = None
    try:
        stop = float(a.stop_freq_hz)  # type: ignore[attr-defined]
    except Exception:
        stop = None
    try:
        pts = int(a.points)  # type: ignore[attr-defined]
    except Exception:
        pts = None
    try:
        ifbw = float(a.if_bandwidth_hz)  # type: ignore[attr-defined]
    except Exception:
        ifbw = None
    try:
        pwr = float(a.source_power_dbm)  # type: ignore[attr-defined]
    except Exception:
        pwr = None
    return ConfigResponse(
        connected=True,
        idn=state.network_analyzer_idn,
        start_hz=start,
        stop_hz=stop,
        points=pts,
        if_bandwidth_hz=ifbw,
        source_power_dbm=pwr,
        markers=list(state.network_analyzer_markers or []),
    )


@router.get("/network-analyzer/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    with handle_driver_errors("vna read config"):
        return await asyncio.to_thread(_read_config)


def _apply_freq(start_hz: float, stop_hz: float, points: int | None) -> None:
    a = state.network_analyzer
    if a is None:
        raise RuntimeError("network_analyzer not connected")
    if stop_hz <= start_hz:
        raise ValueError("stop_hz must be greater than start_hz")
    a.start_freq_hz = start_hz  # type: ignore[attr-defined]
    a.stop_freq_hz = stop_hz    # type: ignore[attr-defined]
    if points is not None:
        a.points = points  # type: ignore[attr-defined]


@router.post("/network-analyzer/freq", response_model=ConfigResponse)
async def set_freq(req: FreqRequest) -> ConfigResponse:
    with handle_driver_errors("vna set freq"):
        await asyncio.to_thread(_apply_freq, req.start_hz, req.stop_hz, req.points)
        return await asyncio.to_thread(_read_config)


def _apply_markers(markers: list[float]) -> None:
    if state.network_analyzer is None:
        raise RuntimeError("network_analyzer not connected")
    if len(markers) > 9:
        raise ValueError("at most 9 markers supported")
    state.network_analyzer_markers = [float(m) for m in markers]
    # Best-effort push to instrument display markers via raw SCPI.
    a = state.network_analyzer
    dev = getattr(a, "_dev", None)
    if dev is None:
        return
    try:
        # Turn all 9 off, then enable + set X for the active set.
        for i in range(1, 10):
            try:
                dev.write(f"CALC1:MARK{i} OFF")
            except Exception:
                pass
        for i, mf in enumerate(markers, start=1):
            try:
                dev.write(f"CALC1:MARK{i} ON")
                dev.write(f"CALC1:MARK{i}:X {mf:.0f}")
            except Exception:
                pass
    except Exception:
        pass


@router.post("/network-analyzer/markers", response_model=ConfigResponse)
async def set_markers(req: MarkersRequest) -> ConfigResponse:
    with handle_driver_errors("vna set markers"):
        await asyncio.to_thread(_apply_markers, req.markers)
        return await asyncio.to_thread(_read_config)


# ---------- Single-shot S11 measurement ----------

class MarkerResult(BaseModel):
    index: int
    requested_hz: float
    freq_hz: float
    s11_real: float
    s11_imag: float
    s11_mag_db: float
    r_ohm: float
    x_ohm: float


class MeasureResponse(BaseModel):
    connected: bool
    start_hz: float | None = None
    stop_hz: float | None = None
    points: int | None = None
    markers: list[MarkerResult] = []


def _measure_s11() -> MeasureResponse:
    import math
    import numpy as np  # rf-instruments deps brings numpy; fine to assume present
    a = state.network_analyzer
    if a is None:
        raise RuntimeError("network_analyzer not connected")
    # Keep instrument in free-run; just read whatever the latest sweep produced.
    _force_free_run(a)
    freqs, gamma = a.get_s_parameter_complex("S11")  # type: ignore[attr-defined]
    start = float(freqs[0]) if len(freqs) else None
    stop = float(freqs[-1]) if len(freqs) else None
    pts = int(len(freqs))
    markers = state.network_analyzer_markers or []
    results: list[MarkerResult] = []
    for i, mf in enumerate(markers):
        if pts == 0:
            continue
        idx = int(np.argmin(np.abs(freqs - mf)))
        g = complex(gamma[idx])
        z = 50.0 * (1 + g) / (1 - g) if abs(1 - g) > 1e-12 else complex(float("inf"), 0.0)
        mag = abs(g)
        mag_db = 20.0 * math.log10(mag) if mag > 0 else -200.0
        results.append(MarkerResult(
            index=i + 1,
            requested_hz=float(mf),
            freq_hz=float(freqs[idx]),
            s11_real=float(g.real),
            s11_imag=float(g.imag),
            s11_mag_db=float(mag_db),
            r_ohm=float(z.real) if math.isfinite(z.real) else 0.0,
            x_ohm=float(z.imag) if math.isfinite(z.imag) else 0.0,
        ))
    return MeasureResponse(
        connected=True,
        start_hz=start,
        stop_hz=stop,
        points=pts,
        markers=results,
    )


class MeasureRequest(BaseModel):
    markers: list[float] | None = None


@router.post("/network-analyzer/measure", response_model=MeasureResponse)
async def measure(req: MeasureRequest | None = None) -> MeasureResponse:
    with handle_driver_errors("vna measure"):
        if req is not None and req.markers is not None:
            await asyncio.to_thread(_apply_markers, req.markers)
        return await asyncio.to_thread(_measure_s11)
