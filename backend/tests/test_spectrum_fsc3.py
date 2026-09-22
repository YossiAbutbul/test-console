"""R&S FSC3 control panel: the measured quirks the driver works around.

The analyzer is not on the bench during a test run, so a fake link stands in.
It reproduces the behaviour the driver was written against -- markers that
refuse to switch on out of order, reads that switch a marker on, the invalid
sentinel -- so the tests pin what reaches the instrument, not the socket.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.api.instruments import spectrum as routes
from backend.api.instruments._state import state
from backend.spectrum import Analyzer
from backend.spectrum.config import MARKER_VERIFY_EVERY


class FakeFsc3:
    def __init__(self, host: str = "", port: int = 0) -> None:
        self.sent: list[str] = []
        self.queries: list[str] = []
        self.errors: list[str] = []
        self.markers = [False] * 7          # index 1..6
        self.offset = 0.0
        self.rlev = -20.0
        self.values = "-80.1,-60.25,-40.5"

    # --- link ---
    def write(self, cmd: str) -> None:
        self.sent.append(cmd)
        for part in cmd.split(";"):
            self._apply(part)

    def _apply(self, cmd: str) -> None:
        if cmd == "CALC:MARK:AOFF":
            self.markers = [False] * 7
        elif cmd.startswith("CALC:MARK") and cmd.endswith(":STAT ON"):
            n = int(cmd[len("CALC:MARK"):].split(":")[0])
            if n > 1 and not self.markers[n - 1]:
                self.errors.append('-200,"Execution error"')   # out of order
            else:
                self.markers[n] = True
        elif cmd.startswith("DISP:TRAC:Y:RLEV:OFFS "):
            new = float(cmd.split()[1])
            self.rlev += new - self.offset                      # level follows 1:1
            self.offset = new
        elif cmd.startswith("DISP:TRAC:Y:RLEV "):
            self.rlev = float(cmd.split()[1])

    def query(self, cmd: str, timeout: float = 6.0) -> str:
        self.queries.append(cmd)
        if cmd == "SYST:ERR?":
            return self.errors.pop(0) if self.errors else '0,"No error"'
        if cmd == "*IDN?":
            return "Rohde&Schwarz,FSC3,1314.3006K03/101234,V2.22"
        if cmd.startswith("CALC:MARK") and cmd.endswith(":STAT?"):
            n = int(cmd[len("CALC:MARK"):].split(":")[0])
            return "1" if self.markers[n] else "0"
        if cmd.startswith("CALC:MARK") and cmd.endswith((":X?", ":Y?")):
            n = int(cmd[len("CALC:MARK"):].split(":")[0])
            self.markers[n] = True          # measured: reading switches it on
            return "99.1e+36" if cmd.endswith(":Y?") and n == 2 else "915000000"
        if cmd.startswith("TRAC:DATA?"):
            return self.values
        return {
            "FREQ:CENT?": "915000000", "FREQ:SPAN?": "10000000",
            "FREQ:STAR?": "910000000", "FREQ:STOP?": "920000000",
            "DISP:TRAC:Y:RLEV?": str(self.rlev),
            "DISP:TRAC:Y:RLEV:OFFS?": str(self.offset),
            "DISP:TRAC:Y:SCAL?": "100", "BAND:RES?": "100000", "BAND:VID?": "100000",
            "INP:ATT?": "10", "SWE:TIME?": "0.1", "DISP:TRAC:MODE?": "WRIT",
            "DET?": "APE", "INP:ATT:AUTO?": "1", "INIT:CONT?": "1", "*ESR?": "1",
        }[cmd]

    def error(self) -> str | None:
        e = self.query("SYST:ERR?")
        return None if e.startswith("0,") else e

    def close(self) -> None:
        pass


@pytest.fixture
def an(monkeypatch):
    monkeypatch.setattr("backend.spectrum.fsc3.time.sleep", lambda s: None)
    a = Analyzer("172.16.10.1", 5555, link=FakeFsc3)
    a.connect()
    return a


def test_connect_captures_the_state_for_restore(an):
    assert an.idn.startswith("Rohde&Schwarz,FSC3")
    assert an.saved["center_hz"] == 915e6 and an.saved["markers"] == 0


def test_markers_are_enabled_from_one_upwards(an):
    assert an.set_marker_count(3) == []
    assert an.s.markers[1:4] == [True, True, True]
    assert an.s.sent[-3:] == ["CALC:MARK1:STAT ON", "CALC:MARK2:STAT ON", "CALC:MARK3:STAT ON"]


def test_marker_count_never_reads_a_position(an):
    an.s.markers[1] = True
    assert an.marker_count() == 1
    # Asking X?/Y? of an OFF marker switches it on; counting must only use STAT?.
    assert not any(q.endswith((":X?", ":Y?")) for q in an.s.queries)
    assert an.s.markers[2] is False


def test_invalid_sentinel_reads_as_no_reading(an):
    an.set_marker_count(2)
    ms = an.read_markers()
    assert ms[0]["y"] is not None and ms[1]["y"] is None


def test_restore_writes_the_offset_before_the_level(an):
    an.set_ref_offset(10)                     # drags the level to -10
    an.set_ref_level(0)
    an.restore()
    assert an.s.rlev == pytest.approx(-20.0) and an.s.offset == 0.0
    sent = an.s.sent
    assert sent.index("DISP:TRAC:Y:RLEV:OFFS 0") < sent.index("DISP:TRAC:Y:RLEV -20")


def test_live_read_does_not_arm_a_sweep(an):
    r = an.read_trace()
    assert not any(c.startswith(("INIT", "ABOR")) for c in an.s.sent[-5:])
    assert r["values"] == [-80.1, -60.25, -40.5] and r["zero_span"] is False


def test_single_sweep_arms_and_waits_for_completion(an):
    r = an.read_trace(single=True)
    assert "INIT:IMM;*OPC" in an.s.sent and r["swept"] is True


def test_live_reads_confirm_markers_cheaply_between_recounts(an):
    an.set_marker_count(3)
    an.read_state()
    an.read_trace()                           # cycle 0: full re-count
    an.s.queries.clear()
    an.read_trace()                           # cycle 1: confirm the highest only
    stat = [q for q in an.s.queries if q.endswith(":STAT?")]
    assert stat == ["CALC:MARK3:STAT?"]
    assert MARKER_VERIFY_EVERY > 1


def test_rejected_commands_are_reported_verbatim(an):
    an.s.errors.append('-221,"Settings conflict"')
    problems = an.set_detector("RMS")
    assert problems == ['DET RMS  ->  -221,"Settings conflict"']


def test_unsupported_detector_is_refused_before_sending(an):
    before = len(an.s.sent)
    assert an.set_detector("QPE") == ["detector QPE is not available on this analyzer"]
    assert len(an.s.sent) == before


def test_close_leaves_the_analyzer_sweeping(an):
    link = an.s
    an.close()
    assert link.sent[-1] == "INIT:CONT ON" and an.s is None


@pytest.mark.parametrize("text, expected", [
    ("", ("172.16.10.1", 5555)),
    ("172.16.10.1", ("172.16.10.1", 5555)),
    ("10.0.0.5:5025", ("10.0.0.5", 5025)),
    ("tcp://172.16.10.1:5555", ("172.16.10.1", 5555)),
])
def test_address_parsing(text, expected):
    assert routes.parse_address(text) == expected


def test_command_route_returns_state_and_problems(an, monkeypatch):
    class Direct:
        async def call(self, fn, *args, timeout=25.0):
            return fn(*args)

    monkeypatch.setattr(routes, "bus", lambda name: Direct())
    prev = state.spectrum
    state.spectrum = an
    try:
        an.s.errors.append('-221,"Settings conflict"')
        out = asyncio.run(routes.command(routes.Command(op="detector", detector="RMS")))
    finally:
        state.spectrum = prev
    assert out.connected and out.state["center_hz"] == 915e6
    assert out.problems and "-221" in out.problems[0]


def test_marker_off_keeps_the_others_in_place(an):
    an.set_marker_count(3)
    positions = {1: 905e6, 2: 910e6, 3: 915e6}
    an.s.query_orig = an.s.query

    def query(cmd, timeout=6.0):
        if cmd.startswith("CALC:MARK") and cmd.endswith(":X?"):
            n = int(cmd[len("CALC:MARK"):].split(":")[0])
            an.s.markers[n] = True
            return str(positions[n])
        return an.s.query_orig(cmd, timeout)

    an.s.query = query
    an.s.sent.clear()
    assert an.marker_off(2) == []
    assert an.s.markers[1:4] == [True, True, False]
    # M3 moves down to M2 at its old frequency; M1 is put back where it was.
    assert "CALC:MARK1:X 905000000" in an.s.sent
    assert "CALC:MARK2:X 915000000" in an.s.sent


def test_marker_off_refuses_a_marker_that_is_not_on(an):
    an.set_marker_count(1)
    assert an.marker_off(3) == ["marker 3 is not on"]
