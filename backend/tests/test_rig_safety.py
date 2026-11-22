"""Guards that keep two callers, or a stranger, off the rig.

- sweep reads of a borrowed sensor/analyzer session run on that instrument's bus;
- a relative motor move is refused when the position cannot be read;
- only one backend-driven run (sweep, Load Pull, frequency accuracy) at a time;
- a page on another site cannot call the API from the operator's browser.
"""
from __future__ import annotations

import asyncio
import threading

import pytest
from fastapi import HTTPException

from backend.api import freq_accuracy, runs
from backend.api.instruments._bus import bus
from backend.hw.adapters import KeysightDCPowerAnalyzer, MiniCircuitsPowerMeter
from backend.loadpull.runner import runner as load_pull_runner
from backend.motor import manager as motor
from backend.origin_guard import OriginGuard, origin_allowed
from backend.sweep import runner as sweep_runner
from backend.sweep.models import RunState


# ---------- sweep reads ride the bus ----------

class _Sensor:
    def __init__(self) -> None:
        self.threads: list[str] = []
        self.frequency_mhz = 0.0

    def read_power(self, _unit: str) -> float:
        self.threads.append(threading.current_thread().name)
        return -10.0


class _Analyzer:
    def __init__(self) -> None:
        self.threads: list[str] = []

    def measure_current(self, _ch: int) -> float:
        self.threads.append(threading.current_thread().name)
        return 0.1

    def measure_voltage(self, _ch: int) -> float:
        self.threads.append(threading.current_thread().name)
        return 3.6


def test_a_borrowed_sensor_is_read_on_its_bus() -> None:
    s = _Sensor()
    pm = MiniCircuitsPowerMeter(session=s, call=bus("power-sensor").call_sync)
    assert pm.read_dbm() == -10.0
    assert s.threads and s.threads[0].startswith("instr-power-sensor")


def test_a_borrowed_dc_analyzer_is_read_on_its_bus() -> None:
    a = _Analyzer()
    cm = KeysightDCPowerAnalyzer(session=a, call=bus("dc-analyzer").call_sync)
    cm.read_current_a()
    cm.read_voltage_v()
    assert len(a.threads) == 2
    assert all(t.startswith("instr-dc-analyzer") for t in a.threads)


def test_the_sweep_builds_its_meters_with_the_bus(monkeypatch) -> None:
    from backend.api import test as test_api
    from backend.api.instruments._state import state

    s, a = _Sensor(), _Analyzer()
    monkeypatch.setattr(state, "power_sensor", s)
    monkeypatch.setattr(state, "dc_analyzer", a)

    class Req:
        class config:
            power_source = "sensor"
            spectrum = None
        spectrum_address = None
        power_sensor_serial = None
        dc_analyzer_resource = None
        dc_analyzer_channel = 1

    pm = test_api._build_power_meter(Req)  # type: ignore[arg-type]
    cm = test_api._build_current_meter(Req)  # type: ignore[arg-type]
    pm.read_dbm()
    cm.read_current_a()
    assert s.threads[0].startswith("instr-power-sensor")
    assert a.threads[0].startswith("instr-dc-analyzer")


# ---------- motor ----------

class _Motor:
    def __init__(self, position_ok: bool = True) -> None:
        self._ok = position_ok
        self.moves: list[int] = []

    @property
    def position(self) -> int:
        if not self._ok:
            raise OSError("read timed out")
        return 100

    def move(self, p: int) -> None:
        self.moves.append(p)


@pytest.fixture
def limited(monkeypatch):
    def make(position_ok: bool) -> _Motor:
        m = _Motor(position_ok)
        monkeypatch.setattr(motor.state, "motor", m)
        monkeypatch.setattr(motor.state, "soft_min", 0)
        monkeypatch.setattr(motor.state, "soft_max", 1000)
        return m
    return make


def test_relative_move_is_refused_when_position_is_unreadable(limited) -> None:
    m = limited(position_ok=False)
    # From the real position this might be fine or not; from "0" it looked fine.
    with pytest.raises(RuntimeError, match="unreadable"):
        motor.move(500, absolute=False)
    assert m.moves == []


def test_relative_move_is_checked_from_the_real_position(limited) -> None:
    limited(position_ok=True)
    with pytest.raises(ValueError, match="soft limits"):
        motor.move(950, absolute=False)  # 100 + 950 > 1000


def test_jog_is_refused_when_position_is_unreadable(limited) -> None:
    limited(position_ok=False)
    with pytest.raises(RuntimeError, match="unreadable"):
        motor.jog_start(True)


# ---------- one run at a time ----------

class _Status:
    def __init__(self, state: RunState) -> None:
        self.state = state


@pytest.fixture
def idle(monkeypatch):
    monkeypatch.setattr(sweep_runner, "status", lambda: _Status(RunState.IDLE))
    monkeypatch.setattr(load_pull_runner, "status", lambda: _Status(RunState.IDLE))
    monkeypatch.setattr(freq_accuracy, "running", lambda: False)
    return monkeypatch


def test_nothing_running_lets_any_run_start(idle) -> None:
    runs.refuse_if_running("Mode Sweep")
    assert runs.active_run() is None


@pytest.mark.parametrize("busy, starting", [
    ("sweep", "Load Pull"),
    ("sweep", "Frequency Accuracy"),
    ("load pull", "Mode Sweep"),
    ("freq", "Load Pull"),
])
def test_a_run_of_another_kind_is_refused(idle, busy, starting) -> None:
    if busy == "sweep":
        idle.setattr(sweep_runner, "status", lambda: _Status(RunState.RUNNING))
    elif busy == "load pull":
        idle.setattr(load_pull_runner, "status", lambda: _Status(RunState.RUNNING))
    else:
        idle.setattr(freq_accuracy, "running", lambda: True)
    with pytest.raises(HTTPException) as e:
        runs.refuse_if_running(starting)
    assert e.value.status_code == 409
    assert "stop it before" in e.value.detail


def test_the_same_kind_gets_its_usual_answer(idle) -> None:
    idle.setattr(freq_accuracy, "running", lambda: True)
    with pytest.raises(HTTPException, match="already in progress"):
        runs.refuse_if_running("Frequency Accuracy")


# ---------- origin guard ----------

@pytest.mark.parametrize("origin, host, ok", [
    (None, "127.0.0.1:8000", True),                            # curl, tests, same-origin GET
    ("http://127.0.0.1:8000", "127.0.0.1:8000", True),          # bundled SPA / desktop
    ("http://localhost:8000", "127.0.0.1:8000", True),          # same server, other name
    ("http://localhost:5173", "localhost:8000", True),          # Vite dev proxy
    ("http://localhost:5174", "localhost:8000", True),          # ...on a fallback port
    ("http://[::1]:5173", "localhost:8000", True),
    ("https://evil.example", "127.0.0.1:8000", False),
    ("http://127.0.0.1.evil.example", "127.0.0.1:8000", False),
    ("http://localhost.evil.example:8000", "127.0.0.1:8000", False),
    # DNS rebinding: same-origin with the API under the attacker's name.
    ("http://evil.example:8000", "evil.example:8000", False),
    (None, "evil.example:8000", False),
    (None, None, True),                                         # ASGI scope with no Host
    ("null", "127.0.0.1:8000", False),                          # sandboxed iframe, file://
])
def test_origin_allowed(origin, host, ok) -> None:
    assert origin_allowed(origin, host) is ok


def _call(guard: OriginGuard, headers: list[tuple[bytes, bytes]], kind: str = "http"):
    sent: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request"}

    async def send(msg: dict) -> None:
        sent.append(msg)

    asyncio.run(guard({"type": kind, "headers": headers}, receive, send))
    return sent


def test_guard_refuses_a_foreign_post_before_the_route_runs() -> None:
    ran: list[bool] = []

    async def app(scope, receive, send) -> None:
        ran.append(True)

    sent = _call(OriginGuard(app), [(b"host", b"127.0.0.1:8000"), (b"origin", b"https://evil.example")])
    assert ran == []
    assert sent[0]["status"] == 403


def test_guard_passes_same_origin_and_closes_foreign_websockets() -> None:
    ran: list[bool] = []

    async def app(scope, receive, send) -> None:
        ran.append(True)

    _call(OriginGuard(app), [(b"host", b"127.0.0.1:8000"), (b"origin", b"http://127.0.0.1:8000")])
    assert ran == [True]
    sent = _call(OriginGuard(app), [(b"host", b"127.0.0.1:8000"), (b"origin", b"https://evil.example")], "websocket")
    assert sent == [{"type": "websocket.close", "code": 1008}]
    assert ran == [True]
