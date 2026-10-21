"""Mode Sweep reading power off the spectrum analyzer.

The adapter has to set the analyzer up exactly as asked -- centred on the sweep
frequency, offset zeroed so the path loss is not counted twice -- and refuse to
run on settings the analyzer rejected rather than measure at different ones.
"""
from __future__ import annotations

import pytest

from backend.hw.adapters import SpectrumPowerMeter
from backend.hw.base import MeasurementError
from backend.sweep.models import SpectrumSettings


class FakeAnalyzer:
    def __init__(self, refuse: str | None = None, level: str = "-12.5") -> None:
        self.calls: list[tuple] = []
        self.refuse = refuse
        self.level = level

    def _ok(self, name: str, *args) -> list[str]:
        self.calls.append((name, *args))
        return [f"{name} -> -222"] if name == self.refuse else []

    def set_ref_offset(self, db): return self._ok("offset", db)
    def set_frequency(self, center_hz=None, span_hz=None): return self._ok("freq", center_hz, span_hz)
    def set_rbw(self, hz): return self._ok("rbw", hz)
    def set_vbw(self, hz): return self._ok("vbw", hz)
    def set_detector(self, d): return self._ok("det", d)
    def set_trace_mode(self, m): return self._ok("trace", m)
    def set_marker_count(self, n): return self._ok("markers", n)
    def marker_action(self, n, a): return self._ok("peak", n, a)
    def set_continuous(self, on): return self._ok("cont", on)
    def read_state(self): self.calls.append(("state",)); return {}

    def sweep_once(self, timeout_s=10.0):
        self.calls.append(("sweep",))
        return True

    def q(self, cmd, timeout=6.0):
        self.calls.append(("q", cmd))
        return self.level


SETTINGS = SpectrumSettings(span_hz=500_000, rbw_hz=30_000, vbw_hz=100_000, detector="RMS")


def test_configures_on_the_sweep_frequency_with_the_offset_zeroed():
    an = FakeAnalyzer()
    pm = SpectrumPowerMeter(SETTINGS, analyzer=an)
    pm.set_frequency_hz(902_300_000)
    assert ("offset", 0) in an.calls
    assert ("freq", 902_300_000, 500_000) in an.calls
    assert ("rbw", 30_000) in an.calls and ("vbw", 100_000) in an.calls
    assert ("det", "RMS") in an.calls


def test_a_refused_setting_fails_before_the_first_step():
    pm = SpectrumPowerMeter(SETTINGS, analyzer=FakeAnalyzer(refuse="rbw"))
    with pytest.raises(MeasurementError, match="refused"):
        pm.set_frequency_hz(902_300_000)


def test_each_read_sweeps_once_then_takes_the_peak():
    an = FakeAnalyzer(level="-12.5")
    pm = SpectrumPowerMeter(SETTINGS, analyzer=an)
    assert pm.read_dbm() == -12.5
    names = [c[0] for c in an.calls]
    assert names.index("sweep") < names.index("peak") < names.index("q")


def test_the_no_reading_sentinel_is_an_error_not_a_level():
    pm = SpectrumPowerMeter(SETTINGS, analyzer=FakeAnalyzer(level="9.91E37"))
    with pytest.raises(MeasurementError):
        pm.read_dbm()


def test_a_borrowed_analyzer_is_left_free_running_not_closed():
    an = FakeAnalyzer()
    pm = SpectrumPowerMeter(SETTINGS, analyzer=an)
    pm.disconnect()
    assert ("cont", True) in an.calls


def test_every_call_goes_through_the_given_runner():
    seen: list = []

    def call(fn, *a):
        seen.append(fn)
        return fn(*a)

    pm = SpectrumPowerMeter(SETTINGS, analyzer=FakeAnalyzer(), call=call)
    pm.set_frequency_hz(1)
    pm.read_dbm()
    assert len(seen) == 2
