"""R&S SML03 command formatting and read-back.

The instrument is not on the bench during a test run, so a fake port stands in
for it. What is worth pinning is not the serial plumbing but the exact bytes
that reach an RF source: the command spellings taken from the manual, and the
order they are sent in when a change would otherwise leave the output live at a
setting nobody asked for.
"""
from __future__ import annotations

import pytest

from backend.api.instruments import signal_generator as sg
from backend.api.instruments._state import state


class FakePort:
    """Records what was written; answers queries from a scripted queue."""

    def __init__(self, replies: dict[str, str] | None = None) -> None:
        self.written: list[str] = []
        self.replies = replies or {}
        self._pending: list[str] = []
        self.closed = False
        # Modem lines, as pyserial exposes them. Asserted by default: a live
        # instrument on a null-modem cable holds both high.
        self.cts = True
        self.dsr = True

    def write(self, data: bytes) -> int:
        text = data.decode("ascii")
        assert text.endswith("\r\n"), "every command ends <CR><LF> per the manual"
        cmd = text[:-2]
        self.written.append(cmd)
        if cmd.endswith("?"):
            self._pending.append(self.replies.get(cmd, ""))
        return len(data)

    def flush(self) -> None:
        pass

    def reset_input_buffer(self) -> None:
        pass

    def readline(self) -> bytes:
        if not self._pending:
            return b""
        return (self._pending.pop(0) + "\r\n").encode("ascii")

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def port():
    """Bind a fake port as the connected generator, and unbind it after."""
    p = FakePort({
        "*IDN?": "Rohde&Schwarz,SML03,835352/003,1.34",
        ":SOUR:FREQ?": "868000000",
        ":SOUR:POW?": "-10.0",
        ":OUTP:STAT?": "0",
        ":SYST:ERR?": '0,"No error"',
    })
    state.signal_generator = p
    state.signal_generator_idn = "Rohde&Schwarz,SML03,835352/003,1.34"
    state.signal_generator_port = "COM7"
    try:
        yield p
    finally:
        state.signal_generator = None
        state.signal_generator_idn = None
        state.signal_generator_port = None


def commands(p: FakePort) -> list[str]:
    """What was written, minus the queries, so an ordering assertion reads."""
    return [c for c in p.written if not c.endswith("?")]


class TestCommands:
    """Spellings come from the SML operating manual, 1090.3123.12."""

    def test_frequency_is_sent_in_hz(self, port) -> None:
        sg._do_apply(sg.SettingsRequest(freq_hz=868_000_000))
        assert ":SOUR:FREQ 868000000" in commands(port)

    def test_level_is_sent_in_dbm(self, port) -> None:
        sg._do_apply(sg.SettingsRequest(level_dbm=-12.5))
        assert ":SOUR:POW -12.50" in commands(port)

    def test_rf_output_switches(self, port) -> None:
        sg._do_apply(sg.SettingsRequest(rf_on=True))
        assert commands(port) == [":OUTP:STAT ON"]
        port.written.clear()
        sg._do_apply(sg.SettingsRequest(rf_on=False))
        assert commands(port) == [":OUTP:STAT OFF"]

    def test_an_omitted_setting_is_not_sent(self, port) -> None:
        """A page that only changes the level must not restate the frequency:
        restating it would retune a source someone else is using."""
        sg._do_apply(sg.SettingsRequest(level_dbm=0))
        assert commands(port) == [":SOUR:POW 0.00"]


class TestOrdering:
    """The output must never be live at a setting nobody asked for."""

    def test_settings_land_before_the_output_is_keyed(self, port) -> None:
        sg._do_apply(sg.SettingsRequest(freq_hz=915_000_000, level_dbm=3, rf_on=True))
        assert commands(port) == [
            ":SOUR:FREQ 915000000",
            ":SOUR:POW 3.00",
            ":OUTP:STAT ON",
        ]

    def test_switching_off_happens_first(self, port) -> None:
        """Turning off while retuning: the output goes down before the new
        settings arrive, not after."""
        sg._do_apply(sg.SettingsRequest(freq_hz=915_000_000, rf_on=False))
        assert commands(port) == [":OUTP:STAT OFF", ":SOUR:FREQ 915000000"]


class TestReadBack:
    def test_state_reports_what_the_instrument_answered(self, port) -> None:
        st = sg._read_state()
        assert st.connected is True
        assert st.freq_hz == 868_000_000
        assert st.level_dbm == -10.0
        assert st.rf_on is False
        assert st.error is None

    def test_rf_on_accepts_the_mnemonic_as_well_as_the_number(self, port) -> None:
        port.replies[":OUTP:STAT?"] = "ON"
        assert sg._read_state().rf_on is True

    def test_a_field_the_instrument_will_not_answer_is_missing_not_zero(self, port) -> None:
        port.replies[":SOUR:POW?"] = ""
        st = sg._read_state()
        assert st.level_dbm is None
        assert st.freq_hz == 868_000_000, "one silent query must not cost the others"

    def test_an_error_in_the_queue_comes_back_verbatim(self, port) -> None:
        port.replies[":SYST:ERR?"] = '-222,"Data out of range"'
        assert sg._read_state().error == '-222,"Data out of range"'

    def test_an_empty_queue_is_not_an_error(self, port) -> None:
        assert sg._read_error() is None


class TestRanges:
    """Bounds are a typo guard; the instrument's own queue stays the authority."""

    def test_rejects_a_frequency_the_sml03_cannot_reach(self) -> None:
        with pytest.raises(ValueError):
            sg.SettingsRequest(freq_hz=6_000_000_000)

    def test_rejects_a_level_far_above_the_output_range(self) -> None:
        with pytest.raises(ValueError):
            sg.SettingsRequest(level_dbm=40)

    def test_accepts_the_bench_frequencies_this_rig_uses(self) -> None:
        for mhz in (868.0, 902.3, 915.0, 927.5):
            sg.SettingsRequest(freq_hz=mhz * 1e6)


class TestConnect:
    def test_a_silent_port_is_reported_as_a_baud_or_cable_problem(self, monkeypatch) -> None:
        """An open port that answers nothing is the usual sign of a baud
        mismatch, and saying "connected" there would defer the failure to the
        first real command."""
        silent = FakePort({"*IDN?": ""})
        silent.cts = True          # lines are fine, so the rate is the suspect
        silent.dsr = True
        monkeypatch.setattr(sg, "_open", lambda port, baud: silent)
        with pytest.raises(RuntimeError, match="no reply"):
            sg._do_connect("COM9", 9600)
        assert state.signal_generator is None, "a failed connect leaves nothing bound"
        assert silent.closed, "and does not leak the port"

    def test_dead_handshake_lines_are_named_as_the_cable(self, monkeypatch) -> None:
        """CTS and DSR carry the instrument's RTS and DTR, and the manual keeps
        RTS active for as long as its serial interface is. Both low means the
        lines are not arriving, so the baud rate is not what to go and check --
        which is the wrong errand to send someone on."""
        silent = FakePort({"*IDN?": ""})
        silent.cts = False
        silent.dsr = False
        monkeypatch.setattr(sg, "_open", lambda port, baud: silent)
        with pytest.raises(RuntimeError, match="straight-through cable"):
            sg._do_connect("COM6", 9600)

    def test_connecting_does_not_touch_the_output(self, monkeypatch) -> None:
        """No *RST and no output command: the generator feeds a live bench, and
        opening a page is not a decision to change what it is doing."""
        p = FakePort({"*IDN?": "Rohde&Schwarz,SML03,835352/003,1.34"})
        monkeypatch.setattr(sg, "_open", lambda port, baud: p)
        try:
            sg._do_connect("COM7", 9600)
            assert commands(p) == []
            assert p.written == ["*IDN?"]
        finally:
            sg._do_disconnect()
