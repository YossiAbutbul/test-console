"""Verdicts, path loss and the BLE tone helpers, ported from the page.

Each mirrors a frontend function exactly, so a step judged here comes out as
it did when the browser judged it:

    verdict_of            <- frontend/src/lib/verdict.ts  verdictOf
    verdict_within_margin <- frontend/src/lib/verdict.ts  verdictWithinMargin
    find_loss             <- frontend/src/lib/pathLoss.ts findLoss
    auto_tone_seconds     <- frontend/src/tests/bleCw/plan.ts autoToneSeconds
    off_air_reason        <- frontend/src/tests/ble/radio.ts offAirReason
"""

from __future__ import annotations

import math
from typing import Literal, Optional

from .models import PathLoss

Verdict = Literal["pass", "fail"]


def _finite(x: Optional[float]) -> bool:
    return x is not None and math.isfinite(x)


def verdict_of(measured: Optional[float], lo: Optional[float], hi: Optional[float]) -> Optional[Verdict]:
    """Pass or fail against absolute limits; None with no reading or no limit."""
    if not _finite(measured):
        return None
    if lo is None and hi is None:
        return None
    if lo is not None and measured < lo:
        return "fail"
    if hi is not None and measured > hi:
        return "fail"
    return "pass"


def verdict_within_margin(measured: Optional[float], target: float, margin: Optional[float]) -> Optional[Verdict]:
    """Within ± `margin` dB of `target`. None when the margin is off or
    unusable: a negative one is the operator's typo, not a zero limit."""
    if margin is None or not math.isfinite(margin) or margin < 0:
        return None
    if not math.isfinite(target):
        return None
    return verdict_of(measured, target - margin, target + margin)


#: A table row applies within this of the frequency asked for.
_MATCH_MHZ = 0.001


def find_loss(pl: PathLoss, freq_mhz: Optional[float]) -> tuple[float, bool]:
    """(dB to add to a reading, whether it came from a calibrated row).

    No interpolation: the loss of a real cable run is not linear, and an
    invented value would hide the calibration gap the default exposes.
    """
    if not _finite(freq_mhz):
        return pl.default_db, False
    for p in pl.points:
        if math.isfinite(p.freq_mhz) and abs(p.freq_mhz - freq_mhz) <= _MATCH_MHZ:
            return p.db, True
    return pl.default_db, False


AUTO_TONE_FIRST_S = 5
AUTO_TONE_MAX_S = 15
_AUTO_TONE_MIN_S = 2
_AUTO_TONE_HEADROOM = 1.2
_AUTO_TONE_PAD_MS = 300


def auto_tone_seconds(slowest_window_ms: Optional[float]) -> int:
    """A tone long enough for the slowest reading yet, with headroom; a
    generous fixed one until a point has been timed."""
    if slowest_window_ms is None:
        return AUTO_TONE_FIRST_S
    need = slowest_window_ms * _AUTO_TONE_HEADROOM + _AUTO_TONE_PAD_MS
    return min(AUTO_TONE_MAX_S, max(_AUTO_TONE_MIN_S, math.ceil(need / 1000)))


def off_air_reason(read_end_ms: float, tone_end_ms: Optional[float], read_ms: float) -> Optional[str]:
    """Why a BLE reading is not the tone's power: it finished after the tone
    ended, so part of it was the DUT back to advertising."""
    if tone_end_ms is None or read_end_ms <= tone_end_ms:
        return None
    late = (read_end_ms - tone_end_ms) / 1000
    return (
        f"reading finished {late:.1f} s after the tone ended (read took "
        f"{read_ms / 1000:.1f} s) — not recorded as the tone's power; "
        "lengthen the tone, or stop other readers of the instruments"
    )


def ppm_verdict(error_ppm: Optional[float], limit_ppm: Optional[float]) -> Optional[str]:
    """Pass inside +- limit; None with nothing to judge by. Port of ppmVerdict
    (frontend/src/tests/freqAccuracy/stages.ts)."""
    if error_ppm is None or limit_ppm is None:
        return None
    return "pass" if abs(error_ppm) <= limit_ppm else "fail"


def point_verdict(
    final_ppm: Optional[float], limit_ppm: Optional[float],
    stage_ppms: list[float], stage_limits: list[Optional[float]],
) -> Optional[str]:
    """A frequency accuracy point: its final error against its tolerance, and
    each stage's peak against that stage's. Any fail fails; a pass needs one
    judged check. Port of pointVerdict (stages.ts)."""
    if final_ppm is None:
        return None
    vs = [ppm_verdict(final_ppm, limit_ppm)] + [
        ppm_verdict(p, stage_limits[i] if i < len(stage_limits) else None) for i, p in enumerate(stage_ppms)
    ]
    if "fail" in vs:
        return "fail"
    return "pass" if "pass" in vs else None
