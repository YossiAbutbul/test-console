"""HTTP API for instrument discovery, connect/disconnect, status, and measurement.

Per-device routes live in sibling modules:
  - power_sensor.py     — Mini-Circuits USB power sensors.
  - dc_analyzer.py      — Keysight DC analyzer (also hosts /dc-analyzer/supply).
  - spectrum.py         — R&S FSC3 spectrum analyzer over LAN (backend/spectrum/).
  - network_analyzer.py — Agilent/Keysight E5061B network analyzer.
  - signal_generator.py — Rohde & Schwarz SML03 over RS-232.

This module aggregates them under a single `router` and adds cross-device
endpoints (`/instruments/status`, `/instruments/measure`).
"""
from __future__ import annotations

import asyncio
import logging
import time

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ValidationError

from . import dc_analyzer, network_analyzer, power_sensor, signal_generator, spectrum
from ._bus import bus
from ._state import state
from ...hw.adapters import SpectrumPowerMeter
from ...hw.base import MeasurementError
from ...sweep.models import SpectrumSettings

log = logging.getLogger(__name__)

router = APIRouter()
router.include_router(power_sensor.router)
router.include_router(dc_analyzer.router)
router.include_router(spectrum.router)
router.include_router(network_analyzer.router)
router.include_router(signal_generator.router)

_aggregate = APIRouter(prefix="/instruments", tags=["instruments"])


# ---------- Status ----------

class InstrumentStatus(BaseModel):
    connected: bool
    idn: str | None = None
    #: What the open session is bound to -- VISA resource or COM port -- so a
    #: page opened after connecting elsewhere can show it. None when unknown.
    address: str | None = None
    #: DC analyzer only: the channel the session measures on.
    channel: int | None = None


class StatusResponse(BaseModel):
    power_sensor: InstrumentStatus
    dc_analyzer: InstrumentStatus
    spectrum: InstrumentStatus
    network_analyzer: InstrumentStatus
    signal_generator: InstrumentStatus


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
            address=state.dc_analyzer_resource,
            channel=state.dc_analyzer_channel if state.dc_analyzer is not None else None,
        ),
        spectrum=InstrumentStatus(
            connected=state.spectrum is not None,
            idn=state.spectrum_idn,
            address=state.spectrum_resource,
        ),
        network_analyzer=InstrumentStatus(
            connected=state.network_analyzer is not None,
            idn=state.network_analyzer_idn,
            address=state.network_analyzer_resource,
        ),
        signal_generator=InstrumentStatus(
            connected=state.signal_generator is not None,
            idn=state.signal_generator_idn,
            address=state.signal_generator_port,
        ),
    )


# ---------- Single-shot measurement ----------

class MeasureResponse(BaseModel):
    power_dbm: float | None = None
    current_a: float | None = None
    voltage_v: float | None = None
    power_sensor_connected: bool = False
    dc_analyzer_connected: bool = False
    spectrum_connected: bool = False
    #: Which instrument `power_dbm` came from: "sensor" or "spectrum".
    power_source: str = "sensor"
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


def _read_power_dbm(freq_hz: int | None, allow_no_signal: bool = False) -> float | None:
    """Read the sensor, in dBm.

    `allow_no_signal` returns whatever the sensor says, including its
    under-range sentinel (around -997 dBm), and does so on the first read.

    Off by default, and it must stay that way for the tests: a sweep that
    recorded -997 as a measurement would poison its results table and every
    export built from it, which is what the retry-and-raise below exists to
    prevent. The exception is a bare power meter, where "the sensor sees
    nothing" is a reading the operator asked for -- and where the 1.5 s of
    retries would make a 400 ms continuous read impossible.
    """
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
        if allow_no_signal:
            return float(reader("dBm"))
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


def _apply_changed(an, have: dict, want: dict) -> None:
    """Send only the settings that differ from what the last read left."""
    problems: list[str] = []
    if want["center_hz"] != have.get("center_hz"):
        problems += an.set_frequency(center_hz=want["center_hz"])
    if want["span_hz"] != have.get("span_hz"):
        problems += an.set_frequency(span_hz=want["span_hz"])
    if want["rbw_hz"] != have.get("rbw_hz"):
        problems += an.set_rbw(want["rbw_hz"])
    if want["vbw_hz"] != have.get("vbw_hz"):
        problems += an.set_vbw(want["vbw_hz"])
    if want["detector"] != have.get("detector"):
        problems += an.set_detector(want["detector"])
    if problems:
        raise MeasurementError("spectrum analyzer refused: " + "; ".join(problems))


def _read_spectrum_dbm(
    freq_hz: int, settings: SpectrumSettings, expected_dbm: float | None = None,
) -> float | None:
    """Read TX power off the spectrum analyzer: one sweep, peak marker.

    The same steps Mode Sweep's spectrum source takes (SpectrumPowerMeter),
    with two differences for a test that reads point by point from the
    browser. Only what changed since the last read is sent (state.spectrum_
    applied): the whole set was about a second per reading. That record is
    dropped whenever anything else changes the analyzer -- the Spectrum page,
    a reconnect, a Mode Sweep -- so a figure is never taken at settings
    nobody asked for; only a hand on the analyzer's own front panel goes
    unseen. And it is handed back free-running afterwards, so the Spectrum
    page is not left frozen on the last single sweep. The reference offset is zeroed, as
    in Mode Sweep: path loss is added in software.

    Runs on the spectrum bus, so it never interleaves with the Spectrum page.
    """
    an = state.spectrum
    if an is None:
        return None
    pm = SpectrumPowerMeter(settings, analyzer=an)
    want = {
        "an": id(an), "center_hz": freq_hz, "span_hz": settings.span_hz,
        "rbw_hz": settings.rbw_hz, "vbw_hz": settings.vbw_hz, "detector": settings.detector,
    }
    have = state.spectrum_applied
    # Unknown until this read has gone through: a failure part-way leaves the
    # analyzer in a state no record describes, so the next read sets it all.
    state.spectrum_applied = None
    if have is None or have.get("an") != want["an"]:
        pm.set_frequency_hz(freq_hz)  # everything, as Mode Sweep does at its start
        have = {**want, "ref_dbm": None}
    else:
        _apply_changed(an, have, want)
    ref = None if expected_dbm is None else SpectrumPowerMeter.ref_level_for(expected_dbm)
    if ref is not None and ref != have.get("ref_dbm"):
        pm.expect_dbm(expected_dbm)
    try:
        dbm = pm.read_dbm()
        state.spectrum_applied = {**want, "ref_dbm": ref if ref is not None else have.get("ref_dbm")}
        return dbm
    finally:
        try:
            an.set_continuous(True)
        except Exception:
            log.warning("spectrum analyzer: could not resume continuous sweep", exc_info=True)


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
async def measure(
    freq_hz: int | None = None, allow_no_signal: bool = False,
    power: bool = True, current: bool = True,
    source: Literal["sensor", "spectrum"] = "sensor",
    span_hz: float | None = None, rbw_hz: float | None = None,
    vbw_hz: float | None = None, detector: str | None = None,
    expected_dbm: float | None = None,
) -> MeasureResponse:
    """Read every connected instrument the caller asked for.

    `power` / `current` let a caller exclude one. Connected is not the same as
    wanted: with "Measure power" unchecked on a CW page, a sensor left on USB
    but off the RF path was still read, and its "no signal" failure was shown
    under a send that never asked for power.

    `source` picks what reads power: the USB sensor, or the spectrum analyzer
    with `span_hz` / `rbw_hz` / `vbw_hz` / `detector` (each defaulting as in
    Mode Sweep), centred on `freq_hz`. Either way `power_dbm` is raw: path
    loss is the caller's. `expected_dbm` is the level the analyzer should
    see -- the requested power less the path loss -- and sets its reference
    level; without it the reference is left where it was.
    """
    t0 = time.perf_counter()
    ps_connected = state.power_sensor is not None
    dc_connected = state.dc_analyzer is not None
    sa_connected = state.spectrum is not None
    spectrum = source == "spectrum"
    read_ps = (sa_connected if spectrum else ps_connected) and power
    read_dc = dc_connected and current
    if not read_ps and not read_dc:
        return MeasureResponse(
            power_sensor_connected=ps_connected,
            dc_analyzer_connected=dc_connected,
            spectrum_connected=sa_connected,
            power_source=source,
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
        if read_ps and spectrum:
            if freq_hz is None:
                raise ValueError("the spectrum analyzer needs a frequency to centre on")
            given = {"span_hz": span_hz, "rbw_hz": rbw_hz, "vbw_hz": vbw_hz, "detector": detector}
            try:
                settings = SpectrumSettings(**{k: v for k, v in given.items() if v is not None})
            except ValidationError as e:
                raise ValueError(f"spectrum settings: {e.errors()[0]['msg']}") from None
            p_dbm = await bus("spectrum").call(_read_spectrum_dbm, freq_hz, settings, expected_dbm)
        elif read_ps:
            p_dbm = await bus("power-sensor").call(
                _read_power_dbm, freq_hz, allow_no_signal,
            )
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    try:
        if read_dc:
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
        spectrum_connected=sa_connected,
        power_source=source,
        t_ms=int((time.perf_counter() - t0) * 1000),
        error=err,
    )


router.include_router(_aggregate)


# ---------- Shutdown ----------

#: Per-instrument ceiling on closing. A wedged vendor call cannot be cancelled,
#: so this bounds the *wait*, not the thread — enough to stop one stuck
#: instrument from eating the whole graceful-shutdown window.
CLOSE_TIMEOUT_S = 1.0

#: (state attribute, log label) for every session the process can hold.
_SESSIONS = (
    ("power_sensor", "power sensor"),
    ("dc_analyzer", "DC analyzer"),
    ("spectrum", "spectrum analyzer"),
    ("network_analyzer", "network analyzer"),
)


def _close(inst: object) -> None:
    closer = getattr(inst, "close", None)
    if callable(closer):
        closer()


async def close_all() -> None:
    """Hand every open instrument session back, best effort.

    These used to be left for process exit to reclaim. That is fine for handles
    the OS owns, but an instrument that tracks the session at its own end — or a
    vendor layer holding the device past the process — refuses the next connect,
    which is what turns "restart the backend" into "and now nothing reconnects".

    Closes run concurrently and each is bounded, so one wedged instrument
    cannot stop the others being released.
    """

    async def shut(attr: str, label: str) -> None:
        inst = getattr(state, attr, None)
        if inst is None:
            return
        try:
            await asyncio.wait_for(asyncio.to_thread(_close, inst), CLOSE_TIMEOUT_S)
            log.info("closed %s", label)
        except Exception as e:
            # Nothing to recover here: the process is going away either way, and
            # the point of the log line is the next person wondering why the
            # instrument would not reopen.
            log.warning("closing %s failed: %s: %s", label, type(e).__name__, e)
        finally:
            setattr(state, attr, None)
            setattr(state, f"{attr}_idn", None)
            if hasattr(state, f"{attr}_resource"):
                setattr(state, f"{attr}_resource", None)

    await asyncio.gather(*(shut(a, lbl) for a, lbl in _SESSIONS))


__all__ = ["router", "close_all"]
