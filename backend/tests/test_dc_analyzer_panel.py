"""DC analyzer control panel: command order, scaling and error reporting.

The analyzer is not on the bench during a test run, so a fake stands in for
the wrapper. What is worth pinning is what reaches a supply feeding a DUT: the
order the commands go out in when a change would otherwise leave the output
live at settings nobody asked for, the setpoint scaling, and which entries of
the error queue are reported.
"""
from __future__ import annotations

import pytest

from backend.api.instruments import dc_analyzer as dc
from backend.api.instruments._state import DC_VOLTAGE_SCALE, state


class FakeAnalyzer:
    """Mimics DCPowerAnalyzer: records writes, answers queries from a table."""

    def __init__(self) -> None:
        self.log: list[str] = []
        self.errors: list[str] = []
        self.out = False
        self.volt = 1.8
        self.lim = 0.5
        self.auto = {"VOLT": 0, "CURR": 0}

    # --- raw SCPI, as the wrapper's private helpers ---
    def _write(self, cmd: str) -> None:
        self.log.append(cmd)
        for m in ("VOLT", "CURR"):
            if cmd.startswith(f"SENS:{m}:RANG:AUTO ON"):
                self.auto[m] = 1
            elif cmd.startswith(f"SENS:{m}:RANG:AUTO OFF"):
                self.auto[m] = 0

    def _query(self, cmd: str) -> str:
        if cmd == "SYST:ERR?":
            return self.errors.pop(0) if self.errors else '+0,"No error"'
        if cmd.startswith("SYST:CHAN:MOD?"):
            return "N6781A"
        for m in ("VOLT", "CURR"):
            if cmd.startswith(f"SENS:{m}:RANG:AUTO?"):
                return str(self.auto[m])
        raise AssertionError(f"unexpected query {cmd}")

    # --- the wrapper's public API ---
    def enable_output(self, channel: int) -> None:
        self.log.append(f"on {channel}")
        self.out = True

    def disable_output(self, channel: int) -> None:
        self.log.append(f"off {channel}")
        self.out = False

    def is_output_enabled(self, channel: int) -> bool:
        return self.out

    def set_voltage(self, volts: float, channel: int) -> None:
        self.log.append(f"volt {volts:g}")
        self.volt = volts

    def get_voltage_setpoint(self, channel: int) -> float:
        return self.volt

    def set_current_limit(self, amps: float, channel: int) -> None:
        self.log.append(f"lim {amps:g}")
        self.lim = amps

    def get_current_limit(self, channel: int) -> float:
        return self.lim

    def measure_voltage(self, channel: int) -> float:
        return 3.59

    def measure_current(self, channel: int) -> float:
        return 0.0123

    def measure_power(self, channel: int) -> float:
        return -0.0442  # the N6781A reports sourced power as negative


@pytest.fixture
def fake():
    a = FakeAnalyzer()
    prev = (state.dc_analyzer, state.dc_analyzer_idn, state.dc_analyzer_channel)
    state.dc_analyzer, state.dc_analyzer_idn, state.dc_analyzer_channel = a, "Agilent,N6705B", 3
    yield a
    state.dc_analyzer, state.dc_analyzer_idn, state.dc_analyzer_channel = prev


def only_commands(log: list[str]) -> list[str]:
    return [c for c in log if not c.startswith("SENS")]


def test_switching_on_sends_settings_first_and_output_last(fake):
    dc._apply(dc.DcSettings(voltage_v=3.6, current_limit_a=0.2, output_on=True), 3)
    assert only_commands(fake.log) == ["lim 0.2", f"volt {3.6 / DC_VOLTAGE_SCALE:g}", "on 3"]


def test_switching_off_goes_before_any_new_value(fake):
    fake.out = True
    dc._apply(dc.DcSettings(voltage_v=5.0, output_on=False), 3)
    assert fake.log[0] == "off 3"


def test_leaving_output_out_of_the_request_leaves_it_alone(fake):
    fake.out = True
    dc._apply(dc.DcSettings(voltage_v=3.3), 3)
    assert not any(c.startswith(("on", "off")) for c in fake.log)
    assert fake.out


def test_setpoint_is_scaled_both_ways_but_measurement_is_not(fake):
    st = dc._apply(dc.DcSettings(voltage_v=3.6), 3)
    assert fake.volt == pytest.approx(3.6 / DC_VOLTAGE_SCALE)
    assert st.voltage_set_v == pytest.approx(3.6)
    assert st.voltage_v == pytest.approx(3.59)


def test_meter_auto_range_sets_both_meters_on_the_channel(fake):
    st = dc._apply(dc.DcSettings(meter_auto_range=True), 3)
    assert "SENS:VOLT:RANG:AUTO ON,(@3)" in fake.log
    assert "SENS:CURR:RANG:AUTO ON,(@3)" in fake.log
    assert st.voltage_range_auto is True and st.current_range_auto is True


def test_state_reads_module_and_reports_power_as_positive(fake):
    st = dc._read_state(3)
    assert st.module == "N6781A"
    assert st.power_w == pytest.approx(0.0442)
    assert st.error is None


def test_settings_conflict_warning_is_not_reported(fake):
    fake.errors = ['+315,"Settings conflict"']
    st = dc._apply(dc.DcSettings(current_limit_a=0.1), 3)
    assert st.error is None


def test_real_instrument_errors_are_reported_against_their_step(fake):
    def refuse(volts, channel):
        fake.errors.append('-222,"Data out of range"')
    fake.set_voltage = refuse
    st = dc._apply(dc.DcSettings(voltage_v=30.0), 3)
    assert st.error is not None
    assert "voltage" in st.error and "-222" in st.error


def test_limits_reject_typos_before_anything_is_sent():
    with pytest.raises(ValueError):
        dc.DcSettings(voltage_v=600)
    with pytest.raises(ValueError):
        dc.DcSettings(current_limit_a=-1)


def test_disconnected_state_is_reported_not_raised():
    prev = state.dc_analyzer
    state.dc_analyzer = None
    try:
        assert dc._read_state(3).connected is False
    finally:
        state.dc_analyzer = prev


def test_status_reports_what_the_session_is_bound_to(fake):
    import asyncio

    from backend.api.instruments import status

    prev = state.dc_analyzer_resource
    state.dc_analyzer_resource = "USB0::0x0957::0x0F07::MY50000200::0::INSTR"
    try:
        st = asyncio.run(status())
    finally:
        state.dc_analyzer_resource = prev
    assert st.dc_analyzer.address == "USB0::0x0957::0x0F07::MY50000200::0::INSTR"
    assert st.dc_analyzer.channel == 3


def test_each_meter_auto_range_can_be_switched_off_on_its_own(fake):
    fake.auto = {"VOLT": 1, "CURR": 1}
    st = dc._apply(dc.DcSettings(current_range_auto=False), 3)
    assert "SENS:CURR:RANG:AUTO OFF,(@3)" in fake.log
    assert not any(c.startswith("SENS:VOLT") for c in fake.log)
    assert st.current_range_auto is False and st.voltage_range_auto is True


class _Busy:
    """A bus that reports busy a set number of times, then runs the call."""

    def __init__(self, times: int) -> None:
        self.times = times

    async def call(self, fn, *args, timeout: float = 25.0):
        if self.times:
            self.times -= 1
            raise dc.InstrumentBusy("busy")
        return fn(*args)


def test_a_command_waits_out_a_poll_instead_of_failing(fake, monkeypatch):
    import asyncio

    busy = _Busy(3)
    monkeypatch.setattr(dc, "bus", lambda name: busy)
    monkeypatch.setattr(dc, "_BUSY_WAIT_S", 0)
    st = asyncio.run(dc.apply_settings(dc.DcSettings(voltage_range_auto=True)))
    assert st.voltage_range_auto is True


def test_the_poll_gives_way_with_the_last_good_read(fake, monkeypatch):
    import asyncio

    first = asyncio.run(dc.get_state())
    busy = _Busy(1)
    monkeypatch.setattr(dc, "bus", lambda name: busy)
    assert asyncio.run(dc.get_state()) == first
