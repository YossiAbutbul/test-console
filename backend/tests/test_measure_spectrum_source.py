"""`/instruments/measure` reading power off the spectrum analyzer.

Every test page that measured with the power sensor can pick the analyzer
instead. The read has to centre on the step's frequency with the page's own
settings each time (the Spectrum page shares the analyzer and may have moved
it), zero the offset so path loss is not counted twice, hand the analyzer back
free-running, and leave the sensor alone.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.api import instruments as inst
from backend.api.instruments._state import state
from backend.tests.test_spectrum_power_meter import FakeAnalyzer


class Sensor:
    def __init__(self) -> None:
        self.reads = 0

    def read_power(self, unit: str) -> float:
        self.reads += 1
        return 5.0


@pytest.fixture
def rig():
    prev = (state.power_sensor, state.dc_analyzer, state.spectrum)
    sensor, an = Sensor(), FakeAnalyzer(level="-3.25")
    state.power_sensor, state.dc_analyzer, state.spectrum = sensor, None, an
    state.spectrum_applied = None
    yield sensor, an
    state.power_sensor, state.dc_analyzer, state.spectrum = prev
    state.spectrum_applied = None


def test_spectrum_source_reads_the_analyzer_not_the_sensor(rig):
    sensor, an = rig
    r = asyncio.run(inst.measure(
        freq_hz=915_000_000, source="spectrum",
        span_hz=500_000, rbw_hz=30_000, vbw_hz=100_000, detector="RMS",
    ))
    assert r.error is None
    assert r.power_dbm == pytest.approx(-3.25)
    assert r.power_source == "spectrum"
    assert sensor.reads == 0
    calls = an.calls
    assert ("offset", 0) in calls
    assert ("freq", 915_000_000, 500_000) in calls
    assert ("rbw", 30_000) in calls and ("vbw", 100_000) in calls and ("det", "RMS") in calls
    # Swept once, peaked, then handed back free-running.
    assert calls.index(("sweep",)) < calls.index(("peak", 1, "peak"))
    assert calls[-1] == ("cont", True)


def test_spectrum_settings_default_as_in_mode_sweep(rig):
    _, an = rig
    r = asyncio.run(inst.measure(freq_hz=868_000_000, source="spectrum"))
    assert r.error is None
    assert ("freq", 868_000_000, 1_000_000) in an.calls
    assert ("det", "POS") in an.calls


def test_the_analyzer_is_set_up_at_every_read(rig):
    _, an = rig
    asyncio.run(inst.measure(freq_hz=902_000_000, source="spectrum"))
    asyncio.run(inst.measure(freq_hz=928_000_000, source="spectrum"))
    centres = [c[1] for c in an.calls if c[0] == "freq"]
    assert centres == [902_000_000, 928_000_000]


def test_a_refused_setting_is_an_error_not_a_reading(rig):
    _, an = rig
    an.refuse = "rbw"
    r = asyncio.run(inst.measure(freq_hz=915_000_000, source="spectrum"))
    assert r.power_dbm is None
    assert r.error and "refused" in r.error
    assert ("sweep",) not in an.calls


def test_spectrum_needs_a_frequency(rig):
    r = asyncio.run(inst.measure(source="spectrum"))
    assert r.power_dbm is None and "frequency" in (r.error or "")


def test_bad_settings_are_reported(rig):
    r = asyncio.run(inst.measure(freq_hz=915_000_000, source="spectrum", detector="AVG"))
    assert r.power_dbm is None and "spectrum settings" in (r.error or "")


def test_no_analyzer_means_no_reading(rig):
    state.spectrum = None
    r = asyncio.run(inst.measure(freq_hz=915_000_000, source="spectrum", current=False))
    assert r.power_dbm is None and r.error is None
    assert r.spectrum_connected is False


def test_the_sensor_is_still_the_default(rig):
    sensor, an = rig
    r = asyncio.run(inst.measure(freq_hz=915_000_000))
    assert r.power_dbm == pytest.approx(5.0) and r.power_source == "sensor"
    assert sensor.reads == 1 and an.calls == []


def test_the_expected_power_sets_the_reference_level(rig):
    _, an = rig
    r = asyncio.run(inst.measure(freq_hz=915_000_000, source="spectrum", expected_dbm=4.0))
    assert r.error is None
    assert ("ref", 9.0) in an.calls
    # Ranged before the sweep that reads it.
    assert an.calls.index(("ref", 9.0)) < an.calls.index(("sweep",))


def test_without_an_expected_power_the_reference_is_left_alone(rig):
    _, an = rig
    asyncio.run(inst.measure(freq_hz=915_000_000, source="spectrum"))
    assert not any(c[0] == "ref" for c in an.calls)


SETUP = {"offset", "att", "freq", "rbw", "vbw", "det", "trace", "markers", "ref"}


def _setup_calls(an):
    return [c for c in an.calls if c[0] in SETUP]


def _read(**kw):
    return asyncio.run(inst.measure(source="spectrum", current=False, **kw))


def test_a_second_read_at_the_same_settings_sends_no_setup(rig):
    _, an = rig
    _read(freq_hz=915_000_000, expected_dbm=4.0)
    an.calls.clear()
    r = _read(freq_hz=915_000_000, expected_dbm=4.0)
    assert r.error is None and r.power_dbm == pytest.approx(-3.25)
    assert _setup_calls(an) == []
    assert ("sweep",) in an.calls


def test_a_new_frequency_resends_only_the_centre(rig):
    _, an = rig
    _read(freq_hz=902_000_000, expected_dbm=4.0)
    an.calls.clear()
    _read(freq_hz=928_000_000, expected_dbm=4.0)
    assert _setup_calls(an) == [("freq", 928_000_000, None)]


def test_a_new_power_resends_only_the_reference_level(rig):
    _, an = rig
    _read(freq_hz=915_000_000, expected_dbm=4.0)
    an.calls.clear()
    _read(freq_hz=915_000_000, expected_dbm=10.0)
    assert _setup_calls(an) == [("ref", 15.0)]


def test_changed_settings_resend_just_those(rig):
    _, an = rig
    _read(freq_hz=915_000_000)
    an.calls.clear()
    _read(freq_hz=915_000_000, rbw_hz=30_000, detector="RMS")
    assert _setup_calls(an) == [("rbw", 30_000), ("det", "RMS")]


def test_a_failed_read_sets_everything_next_time(rig):
    _, an = rig
    _read(freq_hz=915_000_000)
    an.level = "9.91e37"  # the analyzer's no-reading sentinel
    assert _read(freq_hz=915_000_000).error
    an.level = "-3.25"
    an.calls.clear()
    _read(freq_hz=915_000_000)
    assert ("offset", 0) in an.calls and ("markers", 1) in an.calls


def test_a_spectrum_page_command_makes_the_next_read_set_everything(rig, monkeypatch):
    from backend.api.instruments import spectrum as sa

    _, an = rig
    _read(freq_hz=915_000_000)

    async def noop(fn, *a, **kw):
        return None

    monkeypatch.setattr(sa, "_command", noop)
    asyncio.run(sa.command(sa.Command(op="rbw", hz=10_000)))
    an.calls.clear()
    _read(freq_hz=915_000_000)
    assert ("offset", 0) in an.calls and ("rbw", 100_000) in an.calls


def test_a_new_analyzer_session_is_set_up_in_full(rig):
    _, an = rig
    _read(freq_hz=915_000_000)
    other = FakeAnalyzer(level="-1.0")
    state.spectrum = other
    _read(freq_hz=915_000_000)
    assert ("offset", 0) in other.calls
