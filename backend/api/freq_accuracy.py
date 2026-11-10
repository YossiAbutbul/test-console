"""Frequency accuracy (LoRa): key a CW tone and zoom in on it with the analyzer.

Start takes a list of points (one from the Manual tab, a multi-band plan from
the Automation tab). For each it keys the DUT, waits for it to settle, runs the
zoom stages of `backend/freqacc/zoom.py` on the spectrum bus and stops the DUT;
the page polls status as each stage lands. The DUT is stopped after every point
however it ended, so a failed peak search never leaves the PA keyed, and one
point failing does not end the run.

The analyzer must already be connected (the page's preflight does that): the
zoom borrows the session `/instruments` holds rather than opening a second one
on the same SCPI stream.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import asdict
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..ble import manager
from ..device import PaMode
from ..sweep.models import DEFAULT_SETTLE_MS, MIN_SETTLE_MS
from ..freqacc.zoom import (
    Stage, ZoomError, edge_warning, measure_stage, prepare, ref_level_for, setup_stage,
    sweep_timeout_s,
)
from .instruments._bus import bus
from .instruments._state import state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test/frequency-accuracy", tags=["test"])



async def _settle(ms: int) -> None:
    """After the CW command, before the first sweep: the PA and PLL settle."""
    await asyncio.sleep(ms / 1000)


class StageIn(BaseModel):
    span_hz: float = Field(..., gt=0, le=3_000_000_000)
    rbw_hz: float = Field(..., gt=0)
    vbw_hz: float = Field(..., gt=0)


class PointIn(BaseModel):
    freq_hz: int = Field(..., ge=1, le=0xFFFFFFFF)
    power_dbm: int = Field(..., ge=0, le=255)
    pa_mode: int = Field(default=0, ge=0, le=2)


class StartRequest(BaseModel):
    #: One point from the Manual tab; the Automation tab's whole plan, which
    #: may cross bands. Measured in order, each keyed, zoomed and stopped.
    points: list[PointIn] = Field(..., min_length=1, max_length=500)
    #: Widest first. Each re-centres on the previous stage's peak.
    stages: list[StageIn] = Field(..., min_length=1, max_length=6)
    #: How long each point's carrier is left keyed before the first sweep. The
    #: rig's 400 ms floor (backend/sweep/models.py) holds here too.
    settle_ms: int = Field(default=DEFAULT_SETTLE_MS, ge=MIN_SETTLE_MS, le=10_000)
    #: None: each point's TX power plus headroom. The level does not move the
    #: frequency reading, but a tone off the top of the screen overloads the mixer.
    ref_level_dbm: Optional[float] = Field(default=None, ge=-80, le=30)


class StageOut(BaseModel):
    n: int
    center_hz: float
    span_hz: float
    rbw_hz: float
    vbw_hz: float
    marker_hz: float
    level_dbm: Optional[float]
    shift_hz: float
    at_edge: bool


class ResultOut(BaseModel):
    nominal_hz: float
    measured_hz: float
    error_hz: float
    error_ppm: float
    ref_level_dbm: float


class PointOut(BaseModel):
    freq_hz: int
    power_dbm: int
    pa_mode: int
    state: Literal["pending", "running", "done", "error"] = "pending"
    stages: list[StageOut] = []
    result: Optional[ResultOut] = None
    warnings: list[str] = []
    error: Optional[str] = None


class StatusOut(BaseModel):
    state: Literal["idle", "running", "done", "cancelled", "error"]
    phase: str = ""
    stage_count: int = 0
    #: Index of the point being measured, -1 when none is.
    current: int = -1
    points: list[PointOut] = []
    #: Run-wide trouble, e.g. the DUT not stopping; a point's own go on it.
    warnings: list[str] = []
    error: Optional[str] = None


class _Run:
    def __init__(self) -> None:
        self.status = StatusOut(state="idle")
        self.cancel = threading.Event()
        self.task: asyncio.Task | None = None


_run = _Run()


class _Cancelled(Exception):
    pass


def _running() -> bool:
    return _run.task is not None and not _run.task.done()


def _phase(what: str) -> str:
    st = _run.status
    n = len(st.points)
    return f"Point {st.current + 1} of {n}, {what}" if n > 1 else what[:1].upper() + what[1:]


async def _measure_point(req: StartRequest, pt: PointOut) -> None:
    """Key the carrier, zoom in on it, record the result. Stopping the DUT is
    the caller's, so it happens whatever this raises."""
    st = _run.status
    an = state.spectrum
    dev = manager.device
    ref = req.ref_level_dbm if req.ref_level_dbm is not None else ref_level_for(pt.power_dbm)
    # The CW page's command (LoRa power): a plain carrier. Not the Debug
    # page's lora_cw, whose PA duty cycle / HP max trims are a debug tool.
    r = await dev.lora_power(
        freq_hz=pt.freq_hz, power_dbm=pt.power_dbm, pa_mode=PaMode(pt.pa_mode), timeout=5.0,
    )
    if not r.ok:
        raise ZoomError(f"the DUT refused the CW command (status {r.status})")
    await bus("spectrum").call(prepare, an, ref, timeout=30.0)

    # Keyed once for the whole zoom: each stage narrows the span around the
    # peak the previous one centred, and the carrier is never dropped between.
    center = float(pt.freq_hz)
    last = None
    for i, s in enumerate(req.stages, start=1):
        if _run.cancel.is_set():
            raise _Cancelled()
        stage = Stage(s.span_hz, s.rbw_hz, s.vbw_hz)
        await bus("spectrum").call(
            setup_stage, an, i, stage, center if i == 1 else None, timeout=30.0,
        )
        # Settle after every re-centre and span change, before the sweep that
        # measures: on stage 1 it is also the carrier's own settling time.
        st.phase = _phase(f"stage {i} of {len(req.stages)}, settling {req.settle_ms} ms")
        await _settle(req.settle_ms)
        st.phase = _phase(f"stage {i} of {len(req.stages)}, measuring")
        last = await bus("spectrum").call(
            measure_stage, an, i, center, stage,
            timeout=sweep_timeout_s(stage.span_hz, stage.rbw_hz) + 15.0,
        )
        pt.stages.append(StageOut(**asdict(last)))
        if (w := edge_warning(last)):
            pt.warnings.append(w)
        center = last.marker_hz   # where marker-to-centre put the analyzer
    err = last.marker_hz - pt.freq_hz
    pt.result = ResultOut(
        nominal_hz=pt.freq_hz, measured_hz=last.marker_hz, error_hz=err,
        error_ppm=err / pt.freq_hz * 1e6, ref_level_dbm=ref,
    )


async def _execute(req: StartRequest) -> None:
    st = _run.status
    an = state.spectrum
    dev = manager.device
    # The zoom changes span, RBW, detector and reference: a test's next power
    # read must set the analyzer up again rather than trust it.
    state.spectrum_applied = None
    try:
        for i, pt in enumerate(st.points):
            if _run.cancel.is_set():
                raise _Cancelled()
            st.current = i
            pt.state = "running"
            st.phase = _phase("keying CW")
            try:
                await _measure_point(req, pt)
                pt.state = "done"
            except _Cancelled:
                pt.state = "pending"
                raise
            except Exception as e:  # noqa: BLE001 -- this point's failure; the run goes on
                log.warning("frequency accuracy at %d Hz failed: %s", pt.freq_hz, e)
                pt.state, pt.error = "error", str(e) or type(e).__name__
            finally:
                # Stopped even when the CW command itself failed: a timeout
                # there does not prove the DUT did not key.
                try:
                    await dev.stop_test(timeout=5.0)
                except Exception as e:  # noqa: BLE001
                    st.warnings.append(f"Stopping the DUT failed: {e}")
        failed = [p for p in st.points if p.state == "error"]
        if len(failed) == len(st.points):
            st.state, st.phase, st.error = "error", "Failed", failed[0].error
        else:
            st.state, st.phase = "done", "Done"
    except _Cancelled:
        st.state, st.phase = "cancelled", "Cancelled"
    except Exception as e:  # noqa: BLE001 -- reported on the page
        log.warning("frequency accuracy failed: %s", e)
        st.state, st.phase, st.error = "error", "Failed", str(e) or type(e).__name__
    finally:
        st.current = -1

        def release() -> None:
            an.set_continuous(True)
            an.read_state()   # the Spectrum page shows what the zoom left

        try:
            await bus("spectrum").call(release, timeout=15.0)
        except Exception:  # noqa: BLE001 -- the results stand regardless
            pass


@router.post("/start", response_model=StatusOut)
async def start(req: StartRequest) -> StatusOut:
    if _running():
        raise HTTPException(409, "A frequency accuracy run is already in progress")
    if manager.device is None:
        raise HTTPException(409, "Device not ready (not connected or transport unavailable)")
    if state.spectrum is None:
        raise HTTPException(409, "Spectrum analyzer not connected")
    _run.cancel.clear()
    _run.status = StatusOut(
        state="running", phase="Starting", stage_count=len(req.stages),
        points=[PointOut(freq_hz=p.freq_hz, power_dbm=p.power_dbm, pa_mode=p.pa_mode)
                for p in req.points],
    )
    _run.task = asyncio.create_task(_execute(req))
    return _run.status


@router.get("/status", response_model=StatusOut)
async def status() -> StatusOut:
    return _run.status


@router.post("/cancel", response_model=StatusOut)
async def cancel() -> StatusOut:
    """Ends the run after the stage in flight; the DUT is stopped either way.
    Points already measured keep their results."""
    _run.cancel.set()
    return _run.status
