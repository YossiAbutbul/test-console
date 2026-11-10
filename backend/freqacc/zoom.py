"""Frequency accuracy: find a CW tone's frequency to the hertz by zooming in.

One sweep cannot both find the tone and resolve it. A span wide enough to be
sure of catching a crystal that is 20 ppm off (+-18 kHz at 900 MHz) has a few
hundred trace points across it, so the marker lands on a bin tens of hertz
wide. So the tone is measured in stages: each stage puts the peak marker on the
tone, re-centres on that marker, and the next stage looks again at a narrower
span with a narrower RBW. Two or three stages take a 1 MHz search down to a
span of a kilohertz or so, where a trace bin is about a hertz.

Spectrum analyzer only. The power sensor cannot see frequency at all.

Everything here is synchronous and takes the analyzer as an argument: the
route (backend/api/freq_accuracy.py) runs it on the spectrum bus and the tests
use a fake. Per point the DUT is keyed once, then each stage is:

    set span / RBW / VBW -> settle -> sweep -> marker peak -> read
    -> marker to centre frequency -> next stage

and the DUT is stopped only after the last stage.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

#: The reference level sits this far above the level expected at the input, as
#: SpectrumPowerMeter.REF_HEADROOM_DB does for a power read (backend/hw/adapters.py).
REF_HEADROOM_DB = 5.0
REF_LEVEL_MIN_DBM = -80.0
REF_LEVEL_MAX_DBM = 30.0

#: A peak further than this fraction of the span from the centre is at the
#: edge of the screen: the tone may well be just outside it, and the marker
#: found a skirt or the noise instead.
EDGE_FRACTION = 0.45

#: Allowed for one sweep, whatever the estimate below says.
SWEEP_TIMEOUT_MIN_S = 15.0
SWEEP_TIMEOUT_MAX_S = 120.0


class ZoomError(RuntimeError):
    """The analyzer refused a setting or did not finish a sweep."""


@dataclass
class Stage:
    span_hz: float
    rbw_hz: float
    vbw_hz: float


@dataclass
class StageResult:
    n: int
    center_hz: float
    span_hz: float
    rbw_hz: float
    vbw_hz: float
    marker_hz: float
    level_dbm: float | None
    #: How far the peak moved from where this stage was centred.
    shift_hz: float
    at_edge: bool


def ref_level_for(expected_dbm: float) -> float:
    ref = math.ceil(expected_dbm + REF_HEADROOM_DB)
    return float(min(REF_LEVEL_MAX_DBM, max(REF_LEVEL_MIN_DBM, ref)))


def sweep_timeout_s(span_hz: float, rbw_hz: float) -> float:
    """A swept analyzer takes roughly k * span / RBW^2 seconds. k is about 2-3
    for a Gaussian filter; 4 leaves room, and an FFT sweep is far quicker."""
    est = 4.0 * span_hz / (rbw_hz * rbw_hz)
    return min(SWEEP_TIMEOUT_MAX_S, max(SWEEP_TIMEOUT_MIN_S, 3.0 * est + 5.0))


def _check(problems: list[str], what: str) -> None:
    if problems:
        raise ZoomError(f"spectrum analyzer refused {what}: " + "; ".join(problems))


def prepare(an: Any, ref_level_dbm: float) -> None:
    """What stays the same through every stage. Called once, before stage 1."""
    problems = an.set_ref_offset(0)          # levels are reported at the analyzer
    problems += an.set_attenuation(auto=True)
    problems += an.set_ref_level(ref_level_dbm)
    problems += an.set_detector("POS")       # the tone's peak, not a bin average
    problems += an.set_trace_mode("WRIT")    # a held trace would keep the last stage's peak
    problems += an.set_marker_count(1)
    _check(problems, "the setup")


def _read_marker(an: Any) -> tuple[float, float | None]:
    raw_x = an.q("CALC:MARK1:X?")
    raw_y = an.q("CALC:MARK1:Y?")
    try:
        x = float(raw_x)
    except (TypeError, ValueError):
        raise ZoomError(f"unreadable marker frequency {raw_x!r}") from None
    if abs(x) >= 1e30:
        raise ZoomError("the marker found nothing to read")
    try:
        y: float | None = float(raw_y)
        if abs(y) >= 1e30:
            y = None
    except (TypeError, ValueError):
        y = None
    return x, y


def setup_stage(an: Any, n: int, stage: Stage, center_hz: float | None = None) -> None:
    """Span, RBW and VBW for stage n. Only stage 1 is given a centre (the
    nominal frequency): every later stage is already centred on the previous
    peak by `measure_stage`'s marker-to-centre, so only the span narrows."""
    problems = an.set_frequency(center_hz=center_hz, span_hz=stage.span_hz)
    problems += an.set_rbw(stage.rbw_hz)
    problems += an.set_vbw(stage.vbw_hz)
    # The sweep time follows span and RBW: a fixed one left from an earlier
    # stage would be far too short for a narrow RBW and smear the peak.
    problems += an.set_sweep_time(auto=True)
    _check(problems, f"stage {n}")


def measure_stage(an: Any, n: int, center_hz: float, stage: Stage) -> StageResult:
    """Sweep once, marker to the peak, read it, then marker to centre frequency
    so the next stage looks there. The CW stays keyed throughout: nothing here
    touches the DUT."""
    if not an.sweep_once(timeout_s=sweep_timeout_s(stage.span_hz, stage.rbw_hz)):
        raise ZoomError(f"stage {n}: the sweep did not finish")
    _check(an.marker_action(1, "peak"), f"the peak search at stage {n}")
    x, y = _read_marker(an)
    _check(an.marker_action(1, "center"), f"marker to centre at stage {n}")
    return StageResult(
        n=n, center_hz=center_hz, span_hz=stage.span_hz, rbw_hz=stage.rbw_hz,
        vbw_hz=stage.vbw_hz, marker_hz=x, level_dbm=y, shift_hz=x - center_hz,
        at_edge=abs(x - center_hz) > EDGE_FRACTION * stage.span_hz,
    )


def edge_warning(r: StageResult) -> str | None:
    if not r.at_edge:
        return None
    return (f"Stage {r.n}: the peak is at the edge of the {r.span_hz:g} Hz span; "
            "the tone may be outside it. Widen the first span.")
