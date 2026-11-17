"""`/instruments/measure` reads only what the caller asked for.

With "Measure power" unchecked on a CW page, a sensor still connected over USB
but off the RF path was read anyway, and its "no signal" failure appeared under
a send that never asked for power. Connected is not the same as wanted.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.api import instruments as inst
from backend.api.instruments._state import state


class DeadSensor:
    """A sensor with nothing on its input: reports the under-range sentinel."""

    def __init__(self) -> None:
        self.reads = 0

    def read_power(self, unit: str) -> float:
        self.reads += 1
        return -998.6


class Analyzer:
    def measure_current(self, channel: int) -> float:
        return 0.0123

    def measure_voltage(self, channel: int) -> float:
        return 3.59


@pytest.fixture
def rig():
    prev = (state.power_sensor, state.dc_analyzer)
    sensor = DeadSensor()
    state.power_sensor, state.dc_analyzer = sensor, Analyzer()
    yield sensor
    state.power_sensor, state.dc_analyzer = prev


def test_unwanted_power_sensor_is_not_read(rig):
    r = asyncio.run(inst.measure(power=False))
    assert rig.reads == 0
    assert r.error is None
    assert r.power_dbm is None
    assert r.current_a == pytest.approx(0.0123)
    # Still reported as connected: excluded is not the same as absent.
    assert r.power_sensor_connected is True


def test_nothing_wanted_reads_nothing(rig):
    r = asyncio.run(inst.measure(power=False, current=False))
    assert rig.reads == 0
    assert r.error is None and r.current_a is None


def test_wanted_dead_sensor_still_reports_no_signal(rig, monkeypatch):
    monkeypatch.setattr(inst, "_READ_RETRY_DELAY_S", 0)
    r = asyncio.run(inst.measure(current=False))
    assert r.error is not None and "no signal" in r.error


def test_power_and_current_are_read_together(monkeypatch):
    # Read in turn, the current came a whole power read after the power; on a
    # tone that ends on its own the two could straddle its end.
    import time as _time

    def slow_power(freq_hz, allow_no_signal=False):
        _time.sleep(0.3)
        return 4.5

    def slow_dc():
        _time.sleep(0.3)
        return 0.0177, 3.6, None

    monkeypatch.setattr(inst, "_read_power_dbm", slow_power)
    monkeypatch.setattr(inst, "_read_dc", slow_dc)
    prev = (state.power_sensor, state.dc_analyzer)
    state.power_sensor, state.dc_analyzer = object(), object()
    try:
        t0 = _time.perf_counter()
        r = asyncio.run(inst.measure())
        took = _time.perf_counter() - t0
    finally:
        state.power_sensor, state.dc_analyzer = prev
    assert (r.power_dbm, r.current_a, r.error) == (4.5, 0.0177, None)
    assert took < 0.5, f"reads ran one after the other ({took:.2f} s)"


def test_one_failed_read_keeps_the_other(monkeypatch):
    def broken_power(freq_hz, allow_no_signal=False):
        raise OSError("sensor unplugged")

    monkeypatch.setattr(inst, "_read_power_dbm", broken_power)
    monkeypatch.setattr(inst, "_read_dc", lambda: (0.0177, 3.6, None))
    prev = (state.power_sensor, state.dc_analyzer)
    state.power_sensor, state.dc_analyzer = object(), object()
    try:
        r = asyncio.run(inst.measure())
    finally:
        state.power_sensor, state.dc_analyzer = prev
    assert r.power_dbm is None and r.current_a == 0.0177
    assert "sensor unplugged" in (r.error or "")
