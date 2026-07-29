"""HTTP API for instrument discovery, connect/disconnect, status, and measurement.

Per-device routes live in sibling modules:
  - power_sensor.py     — Mini-Circuits USB power sensors.
  - dc_analyzer.py      — Keysight DC analyzer (also hosts /dc-analyzer/supply).
  - spectrum.py         — Generic VISA spectrum analyzers.
  - network_analyzer.py — Agilent/Keysight E5061B network analyzer.

This module aggregates them under a single `router` and adds cross-device
endpoints (`/instruments/status`, `/instruments/measure`).
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter
from pydantic import BaseModel

from . import dc_analyzer, network_analyzer, power_sensor, spectrum
from ._bus import bus
from ._state import state

log = logging.getLogger(__name__)

router = APIRouter()
router.include_router(power_sensor.router)
router.include_router(dc_analyzer.router)
router.include_router(spectrum.router)
router.include_router(network_analyzer.router)

_aggregate = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Status ----------

class InstrumentStatus(BaseModel):
    connected: bool
    idn: str | None = None


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
    power_dbm: float | None = None
    current_a: float | None = None
    voltage_v: float | None = None
    power_sensor_connected: bool = False
    dc_analyzer_connected: bool = False
    t_ms: int = 0
    error: str | None = None


#: Readings at or below this are the sensor reporting "nothing here", not a
#: measurement. Recording one as a real value poisons the results table and any
#: export built from it, so it is surfaced as an error instead.
NO_SIGNAL_DBM = -100.0

#: The sensor keeps reporting the sentinel for a short while after the PA keys,
#: and how long varies per point. 250 ms of retries was not enough — points
#: intermittently recorded "no signal" for a DUT that was transmitting fine —
#: so the window is ~1.5 s. A path that is genuinely dead still fails, just a
#: second later.
_READ_RETRIES = 12
_READ_RETRY_DELAY_S = 0.125


def _read_power_dbm(freq_hz: int | None) -> float | None:
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
        last = -999.0
        for _ in range(_READ_RETRIES):
            last = float(reader("dBm"))
            if last > NO_SIGNAL_DBM:
                return last
            time.sleep(_READ_RETRY_DELAY_S)
    except Exception as e:
        raise RuntimeError(f"power read failed: {e}")

    # Still nothing after the retries: the DUT is not transmitting yet, or the
    # RF path is broken. Either way it is not a −997 dBm measurement.
    raise RuntimeError(
        f"no signal at power sensor ({last:.1f} dBm) — check the RF path, "
        "or increase the settle time so the PA is keyed before the read"
    )


def _read_dc() -> tuple[float | None, float | None, str | None]:
    """Read current and voltage, reporting why either is missing.

    These used to be swallowed per field, so a DC analyzer that was connected
    but refusing reads showed an empty CC column with no explanation anywhere.
    Each field is still independent — a working current reading is not thrown
    away because the voltage failed — but the reason now travels with them.
    """
    a = state.dc_analyzer
    if a is None:
        return None, None, None

    ch = state.dc_analyzer_channel
    problems: list[str] = []

    try:
        cur = float(a.measure_current(ch))  # type: ignore[attr-defined]
    except Exception as e:
        cur = None
        problems.append(f"current: {type(e).__name__}: {e}")
    try:
        volt = float(a.measure_voltage(ch))  # type: ignore[attr-defined]
    except Exception as e:
        volt = None
        problems.append(f"voltage: {type(e).__name__}: {e}")

    if problems:
        log.warning("DC read failed on channel %s — %s", ch, "; ".join(problems))
    return cur, volt, "; ".join(problems) or None


@_aggregate.post("/measure", response_model=MeasureResponse)
async def measure(freq_hz: int | None = None) -> MeasureResponse:
    t0 = time.perf_counter()
    ps_connected = state.power_sensor is not None
    dc_connected = state.dc_analyzer is not None
    if not ps_connected and not dc_connected:
        return MeasureResponse(
            power_sensor_connected=False,
            dc_analyzer_connected=False,
            t_ms=0,
        )
    err: str | None = None
    p_dbm: float | None = None
    cur: float | None = None
    volt: float | None = None
    # This route reports failures in the `error` field rather than as an HTTP
    # status, so it deliberately keeps its own catch instead of using
    # `handle_driver_errors` — a partial reading is still useful to the client.
    # Reads go through the per-instrument bus so a wedged sensor times out here
    # instead of consuming a shared worker thread and eventually stalling the
    # whole API — see _bus.py.
    try:
        if ps_connected:
            p_dbm = await bus("power-sensor").call(_read_power_dbm, freq_hz)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    try:
        if dc_connected:
            cur, volt, dc_err = await bus("dc-analyzer").call(_read_dc)
            if dc_err:
                err = f"{err}; {dc_err}" if err else dc_err
    except Exception as e:
        # Keep a power reading that already succeeded rather than dropping both.
        err = f"{err}; {type(e).__name__}: {e}" if err else f"{type(e).__name__}: {e}"
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
