"""Frequency accuracy: the zoom re-centres on each peak and narrows onto the tone,
and the DUT is stopped however the run ends."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from backend.api import freq_accuracy as fa
from backend.api.instruments._state import state
from backend.freqacc.zoom import (
    Stage, edge_warning, measure_stage, prepare, setup_stage, sweep_timeout_s,
)

NOMINAL = 902_300_000
TONE = NOMINAL + 4_321.7          # a DUT 4.8 ppm high


class FakeAnalyzer:
    """A trace of `points` bins across the span; the peak marker lands on the
    bin nearest the tone, as a real one does."""

    def __init__(self, tone: float = TONE, points: int = 1001) -> None:
        self.tone, self.points = tone, points
        self.center = self.span = 0.0
        self.log: list[str] = []
        self.marker = 0.0
        self.refuse: str | None = None
        self.continuous = False

    def _ok(self, what: str) -> list[str]:
        self.log.append(what)
        return [f"{what} -> -222"] if self.refuse and what.startswith(self.refuse) else []

    def set_ref_offset(self, db): return self._ok(f"offs {db}")
    def set_attenuation(self, db=None, auto=False): return self._ok("att auto")
    def set_ref_level(self, dbm): return self._ok(f"rlev {dbm}")
    def set_detector(self, d): return self._ok(f"det {d}")
    def set_trace_mode(self, m): return self._ok(f"mode {m}")
    def set_marker_count(self, n): return self._ok(f"markers {n}")
    def set_rbw(self, hz=None, auto=False): return self._ok(f"rbw {hz}")
    def set_vbw(self, hz=None, auto=False): return self._ok(f"vbw {hz}")
    def set_sweep_time(self, seconds=None, auto=False): return self._ok("swt auto")
    def set_continuous(self, on): self.continuous = on; return []
    def read_state(self): return {}

    def set_frequency(self, center_hz=None, span_hz=None, **_):
        # No centre: the span narrows about wherever the analyzer is centred.
        if center_hz is not None:
            self.center = center_hz
        self.span = span_hz
        return self._ok(f"span {span_hz:g}" if center_hz is None else f"freq {center_hz:.1f} {span_hz:g}")

    def sweep_once(self, timeout_s=10.0):
        self.log.append("sweep")
        return True

    def marker_action(self, n, action):
        if action == "center":
            self.center = self.marker      # CALC:MARK1:FUNC:CENT
            return self._ok("marker to centre")
        start = self.center - self.span / 2
        step = self.span / (self.points - 1)
        k = min(self.points - 1, max(0, round((self.tone - start) / step)))
        self.marker = start + k * step
        return self._ok(f"peak {action}")

    def q(self, cmd, timeout=6.0):
        return {"CALC:MARK1:X?": repr(self.marker), "CALC:MARK1:Y?": "-12.5"}[cmd]


def run_stage(an, n, center, stage):
    setup_stage(an, n, stage, center if n == 1 else None)
    return measure_stage(an, n, center, stage)


STAGES = [Stage(1_000_000, 10_000, 10_000), Stage(20_000, 300, 300), Stage(1_000, 10, 10)]


def test_each_stage_centres_on_the_last_peak_and_ends_within_a_hertz():
    an = FakeAnalyzer()
    prepare(an, 19.0)
    center = float(NOMINAL)
    results = []
    for i, s in enumerate(STAGES, start=1):
        r = run_stage(an, i, center, s)
        results.append(r)
        center = r.marker_hz
    assert results[0].center_hz == NOMINAL
    assert results[1].center_hz == results[0].marker_hz
    assert results[2].center_hz == results[1].marker_hz
    # 1 kHz over 1000 bins: a hertz each, so the reading is within half of one.
    assert abs(results[-1].marker_hz - TONE) <= 0.5
    assert not any(r.at_edge for r in results)
    assert "det POS" in an.log and "mode WRIT" in an.log and "offs 0" in an.log


def test_a_tone_outside_the_span_is_flagged_at_the_edge():
    an = FakeAnalyzer(tone=NOMINAL + 2_000_000)
    r = run_stage(an, 1, NOMINAL, STAGES[0])
    assert r.at_edge
    assert "Widen the first span" in edge_warning(r)


def test_a_refused_setting_fails_the_stage():
    an = FakeAnalyzer()
    an.refuse = "rbw"
    with pytest.raises(Exception, match="refused stage 1"):
        run_stage(an, 1, NOMINAL, STAGES[0])


def test_narrow_rbw_gets_a_longer_sweep_timeout():
    assert sweep_timeout_s(1_000_000, 10_000) == 15.0
    assert sweep_timeout_s(1_000, 10) > sweep_timeout_s(20_000, 300)
    assert sweep_timeout_s(1_000, 1) == 120.0


class FakeDevice:
    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.calls: list[str] = []

    async def lora_power(self, **kw):
        self.calls.append(f"cw {kw['freq_hz']}")
        return SimpleNamespace(ok=self.ok, status=0 if self.ok else 3)

    async def stop_test(self, timeout=5.0):
        self.calls.append("stop")


def _run(monkeypatch, an, dev, stages=STAGES, freqs=(NOMINAL,)):
    settled: list[int] = []

    async def settle(ms):
        settled.append(ms)
        an.log.append(f"settle {ms}")

    monkeypatch.setattr(fa, "_settle", settle)
    monkeypatch.setattr(fa, "manager", SimpleNamespace(device=dev))
    monkeypatch.setattr(state, "spectrum", an)
    req = fa.StartRequest(
        points=[fa.PointIn(freq_hz=f, power_dbm=14) for f in freqs],
        stages=[fa.StageIn(span_hz=s.span_hz, rbw_hz=s.rbw_hz, vbw_hz=s.vbw_hz) for s in stages],
    )

    async def go():
        await fa.start(req)
        await fa._run.task
        return await fa.status()

    return asyncio.run(go())


def test_a_run_measures_the_tone_and_stops_the_dut(monkeypatch):
    an, dev = FakeAnalyzer(), FakeDevice()
    out = _run(monkeypatch, an, dev)
    assert out.state == "done", out.error
    pt = out.points[0]
    assert [s.n for s in pt.stages] == [1, 2, 3]
    assert abs(pt.result.error_hz - 4_321.7) <= 0.5
    assert pt.result.error_ppm == pytest.approx(4.79, abs=0.01)
    assert pt.result.ref_level_dbm == 19.0           # 14 dBm + 5 dB headroom
    assert dev.calls == [f"cw {NOMINAL}", "stop"]
    assert an.continuous                              # handed back free-running


def test_a_failed_stage_still_stops_the_dut(monkeypatch):
    an, dev = FakeAnalyzer(), FakeDevice()
    an.refuse = "vbw"
    out = _run(monkeypatch, an, dev)
    assert out.state == "error" and "refused" in out.error
    assert out.points[0].state == "error"
    assert dev.calls[-1] == "stop"


def test_a_refused_cw_command_stops_and_reports(monkeypatch):
    an, dev = FakeAnalyzer(), FakeDevice(ok=False)
    out = _run(monkeypatch, an, dev)
    assert out.state == "error" and "refused the CW" in out.error
    assert "sweep" not in an.log
    assert dev.calls[-1] == "stop"


class BandHopper(FakeAnalyzer):
    """The tone sits 5 ppm high wherever the DUT is tuned."""

    def __init__(self, dev: FakeDevice) -> None:
        super().__init__()
        self.dev = dev

    def marker_action(self, n, action):
        f = int(self.dev.calls[-1].split()[1])
        self.tone = f * (1 + 5e-6)
        return super().marker_action(n, action)


BANDS = (868_100_000, 902_300_000, 927_500_000)


def test_points_across_bands_are_each_keyed_measured_and_stopped(monkeypatch):
    dev = FakeDevice()
    out = _run(monkeypatch, BandHopper(dev), dev, freqs=BANDS)
    assert out.state == "done"
    assert dev.calls == [c for f in BANDS for c in (f"cw {f}", "stop")]
    for f, pt in zip(BANDS, out.points):
        assert pt.state == "done"
        assert pt.result.nominal_hz == f
        assert pt.result.error_ppm == pytest.approx(5.0, abs=0.01)


def test_one_failed_point_does_not_end_the_run(monkeypatch):
    dev = FakeDevice()
    an = BandHopper(dev)
    real = an.set_vbw
    an.set_vbw = lambda hz=None, auto=False: (
        ["vbw -> -222"] if dev.calls[-1] == "cw 902300000" else real(hz))
    out = _run(monkeypatch, an, dev, freqs=BANDS)
    assert out.state == "done"
    assert [p.state for p in out.points] == ["done", "error", "done"]
    assert dev.calls.count("stop") == 3


def test_settle_below_the_rig_floor_is_refused():
    with pytest.raises(Exception):
        fa.StartRequest(points=[fa.PointIn(freq_hz=NOMINAL, power_dbm=14)],
                        stages=[fa.StageIn(span_hz=1e6, rbw_hz=1e4, vbw_hz=1e4)], settle_ms=300)


def test_each_stage_settles_then_peaks_and_centres_with_the_cw_kept_on(monkeypatch):
    """CW on once; per stage: span/RBW/VBW -> settle -> sweep -> peak -> marker
    to centre; the DUT is stopped only after the last stage."""
    an, dev = FakeAnalyzer(), FakeDevice()
    out = _run(monkeypatch, an, dev)
    assert out.state == "done"
    assert dev.calls == [f"cw {NOMINAL}", "stop"]
    steps = [e for e in an.log if e.split()[0] in
             ("freq", "span", "settle", "sweep", "peak", "marker")]
    assert steps == [
        f"freq {NOMINAL:.1f} 1e+06", "settle 400", "sweep", "peak peak", "marker to centre",
        "span 20000", "settle 400", "sweep", "peak peak", "marker to centre",
        "span 1000", "settle 400", "sweep", "peak peak", "marker to centre",
    ]
