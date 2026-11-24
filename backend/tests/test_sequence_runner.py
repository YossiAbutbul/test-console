"""The Test Sequence engine, against a fake rig and a fake clock.

The first thing that matters is parity: each sweep, run here, sends the DUT
and the instruments what the browser loop it replaced sent. The expected
traces below are the browser's own, copied from the panels' characterisation
snapshots as they stood when that loop was retired, in the same format
(`rigTrace` in frontend/src/testing/fakeBackend.ts). The one thing added is
the end of the run leaving the rig idle. These traces are now the record of
what a sweep sends the rig: the panels' own tests only see the backend.

Then the sequence itself: order, the re-cable pause, Stop, failures.
"""
from __future__ import annotations

import asyncio
import functools
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import pytest

from backend.sequence.models import SequenceIn
from backend.sequence.rig import BlePowerSet, BleWrite, Reading, TxResult
from backend.sequence.runner import SequenceRunner
from backend.sweep.models import RunState


def sync(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Run an async test body without depending on pytest-asyncio."""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class FakeClock:
    """Virtual time: a sleep moves the clock and returns at once."""

    def __init__(self) -> None:
        self.t = 1_000_000.0

    def now_ms(self) -> float:
        return self.t

    def mono_ms(self) -> float:
        return self.t

    async def sleep(self, seconds: float, cancel: Optional[asyncio.Event] = None) -> None:
        if cancel is not None and cancel.is_set():
            return
        self.t += seconds * 1000
        await asyncio.sleep(0)


def _n(x: float) -> Any:
    """A number as the browser's JSON writes it: 20, not 20.0."""
    return int(x) if float(x).is_integer() else x


def _body(**kw: Any) -> str:
    return json.dumps(kw, separators=(",", ":"))


@dataclass
class FakeRig:
    trace: list[str] = field(default_factory=list)
    #: Raw power read at a frequency (Hz); default for any other.
    power_at: dict[int, float] = field(default_factory=dict)
    power: float = 14.0
    tx_ok: bool = True
    modem_on_ok: bool = True
    ble_power: Optional[int] = None
    #: Called on every TX start, to act mid-run.
    on_tx: Optional[Callable[[], Any]] = None

    async def _tx(self, line: str) -> TxResult:
        self.trace.append(line)
        if self.on_tx:
            r = self.on_tx()
            if asyncio.iscoroutine(r):
                await r
        return TxResult(ok=self.tx_ok, status=0 if self.tx_ok else 3)

    async def lora_power(self, freq_hz, power_dbm, pa_mode):
        return await self._tx("/device/lora-power " + _body(timeout=5, freq_hz=freq_hz, power_dbm=power_dbm, pa_mode=pa_mode))

    async def lora_modulated(self, bandwidth, freq_hz, power_dbm, modem, datarate):
        return await self._tx("/device/lora-modulated " + _body(
            timeout=5, bandwidth=bandwidth, freq_hz=freq_hz, power_dbm=power_dbm, modem=modem, datarate=datarate))

    async def stop(self):
        self.trace.append("/device/stop " + _body(timeout=5))

    async def lte_modem_off(self):
        self.trace.append("/device/lte/modem-off " + _body(timeout=5))
        return TxResult(True, 0)

    async def lte_modem_on(self):
        self.trace.append("/device/lte/modem-on " + _body(timeout=10))
        return TxResult(self.modem_on_ok, 0 if self.modem_on_ok else 7)

    async def lte_cw(self, earfcn, power_dbm, start, hold=False):
        line = "/device/lte/cw " + _body(timeout=5, start=start, earfcn=earfcn, time_ms=600000 if hold else 20000,
                                          tx_power_dbm=_n(power_dbm), offset_hz=0)
        if start:
            return await self._tx(line)
        self.trace.append(line)
        return TxResult(True, 0)

    async def lte_modulated(self, earfcn, power_dbm, bandwidth, mcs, rb_count, start):
        line = "/device/lte/modulated " + _body(
            timeout=5, start=start, earfcn=earfcn, time_ms=20000, tx_power_dbm=_n(power_dbm),
            bandwidth=bandwidth, mcs=mcs, rb_count=rb_count, rb_start=0, nb_index=0)
        if start:
            return await self._tx(line)
        self.trace.append(line)
        return TxResult(True, 0)

    # BLE, recorded as the browser's fake link recorded it (BleAutomationPanel.test.tsx)
    async def ble_tone(self, channel, duration_s):
        self.trace.append("tone " + json.dumps({"channel": channel, "duration_s": duration_s, "offset": 0},
                                                separators=(",", ":")))
        return BleWrite(acknowledged=False, ok=False)

    async def ble_power_get(self):
        return self.ble_power

    async def ble_power_set(self, param):
        self.trace.append(f"setPower {param}")
        self.ble_power = param
        return BlePowerSet(set=BleWrite(True, True, 0), reset=BleWrite(True, True, 0), released=True)

    async def ble_relink(self):
        self.trace.append("relink")

    async def measure(self, freq_hz, power, expected_dbm):
        self.trace.append(f"measure freq_hz={freq_hz}")
        return Reading(power_dbm=self.power_at.get(freq_hz, self.power), current_a=0.1, voltage_v=3.6, error=None)

    # The analyzer's zoom: each stage's peak sits `offset_hz` off the nominal.
    offset_hz: float = 0.0
    zoom_edge_at: Optional[int] = None

    async def zoom_begin(self):
        self.trace.append("zoom begin")

    async def zoom_prepare(self, ref_level_dbm):
        self.trace.append(f"zoom prepare ref={_n(ref_level_dbm)}")

    async def zoom_setup(self, n, stage, center_hz):
        self.trace.append(f"zoom setup {n} span={_n(stage.span_hz)}"
                          + ("" if center_hz is None else f" center={_n(center_hz)}"))

    async def zoom_measure(self, n, center_hz, stage):
        self.trace.append(f"zoom measure {n}")
        self._nominal = getattr(self, "_nominal", center_hz) if n > 1 else center_hz
        return {"n": n, "marker_hz": self._nominal + self.offset_hz, "level_dbm": -20.0,
                "warning": "peak near the edge" if n == self.zoom_edge_at else None}

    async def zoom_end(self):
        self.trace.append("zoom end")


def lora_cw(uid: str, points: list[tuple[float, int, int, Optional[float]]], **kw: Any) -> dict:
    return {
        "uid": uid, "test": "power", "setup": "main", "label": "LoRa CW", "settle_ms": 400,
        "points": [{"freq_mhz": f, "power_dbm": p, "pa_mode": pa, "margin_db": m} for f, p, pa, m in points],
        **kw,
    }


def ble_cw(uid: str, points: list[tuple[int, int, Optional[float], Optional[float]]], tone_s=None) -> dict:
    return {
        "uid": uid, "test": "ble-cw", "setup": "ble", "label": "BLE CW", "settle_ms": 400, "tone_s": tone_s,
        "points": [{"channel": c, "freq_mhz": 2402 + 2 * c, "power": p, "min_dbm": lo, "max_dbm": hi}
                   for c, p, lo, hi in points],
    }


async def run(seq: dict, rig: FakeRig, answer: Optional[Callable[[Any], Optional[bool]]] = None,
              runner: Optional[SequenceRunner] = None) -> SequenceRunner:
    """Start a sequence and drive it to its end, answering re-cable prompts
    with `answer(prompt)` (True by default; None leaves it waiting)."""
    r = runner or SequenceRunner()
    await r.start(SequenceIn(**seq), rig, clock=FakeClock())
    for _ in range(20_000):
        s = r.status()
        if s.state != RunState.RUNNING:
            return r
        if s.prompt is not None:
            ok = True if answer is None else answer(s.prompt)
            if ok is not None:
                r.answer_prompt(s.prompt.seq, ok)
        await asyncio.sleep(0)
    raise AssertionError("sequence did not finish")


IDLE_LORA = "/device/stop " + _body(timeout=5)


# ------------------------------------------------------------------ parity


@sync
async def test_lora_cw_sends_what_the_panel_sent():
    """LoRa CW panel test: 902.3 and 915 MHz at 14 dBm, PA on, ±1 dB."""
    rig = FakeRig(power_at={915_000_000: 11.0}, power=13.8)
    r = await run({"steps": [lora_cw("a", [(902.3, 14, 1, 1.0), (915, 14, 1, 1.0)])], "bench": "main"}, rig)
    assert rig.trace == [
        '/device/lora-power {"timeout":5,"freq_hz":902300000,"power_dbm":14,"pa_mode":1}',
        "measure freq_hz=902300000",
        '/device/stop {"timeout":5}',
        '/device/lora-power {"timeout":5,"freq_hz":915000000,"power_dbm":14,"pa_mode":1}',
        "measure freq_hz=915000000",
        '/device/stop {"timeout":5}',
        '/device/stop {"timeout":5}',
        IDLE_LORA,
    ]
    assert [row["verdict"] for row in r.rows("a")] == ["pass", "fail"]
    assert r.status().state == RunState.DONE
    assert r.status().steps[0].verdict == "fail"


@sync
async def test_lora_modulated_sends_what_the_panel_sent():
    rig = FakeRig(power_at={915_000_000: 13.5, 868_000_000: 9.0})
    step = {
        "uid": "m", "test": "modulated", "setup": "main", "label": "LoRa modulated", "settle_ms": 400,
        "points": [
            {"freq_mhz": 915, "power_dbm": 14, "modem": 1, "bandwidth": 1, "datarate": 9, "margin_db": 1.0},
            {"freq_mhz": 868, "power_dbm": 10, "modem": 0, "bandwidth": 0, "datarate": 50000, "margin_db": None},
        ],
    }
    r = await run({"steps": [step], "bench": "main"}, rig)
    assert rig.trace == [
        '/device/lora-modulated {"timeout":5,"bandwidth":1,"freq_hz":915000000,"power_dbm":14,"modem":1,"datarate":9}',
        "measure freq_hz=915000000",
        '/device/stop {"timeout":5}',
        '/device/lora-modulated {"timeout":5,"bandwidth":0,"freq_hz":868000000,"power_dbm":10,"modem":0,"datarate":50000}',
        "measure freq_hz=868000000",
        '/device/stop {"timeout":5}',
        '/device/stop {"timeout":5}',
        IDLE_LORA,
    ]
    assert [(row["measured_dbm"], row["verdict"]) for row in r.rows("m")] == [(13.5, "pass"), (9.0, None)]


@sync
async def test_lte_cw_sends_what_the_panel_sent():
    rig = FakeRig(power_at={1_880_000_000: 19.6, 1_890_000_000: 17.0})
    step = {
        "uid": "l", "test": "lte-cw", "setup": "main", "label": "LTE CW", "settle_ms": 400,
        "points": [
            {"earfcn": 18900, "band": 2, "freq_mhz": 1880.0, "power_dbm": 20, "margin_db": 1.0},
            {"earfcn": 19000, "band": 2, "freq_mhz": 1890.0, "power_dbm": 20, "margin_db": 1.0},
        ],
    }
    r = await run({"steps": [step], "bench": "main"}, rig)
    assert rig.trace == [
        '/device/lte/modem-off {"timeout":5}',
        '/device/lte/modem-on {"timeout":10}',
        '/device/lte/cw {"timeout":5,"start":true,"earfcn":18900,"time_ms":20000,"tx_power_dbm":20,"offset_hz":0}',
        "measure freq_hz=1880000000",
        '/device/lte/cw {"timeout":5,"start":false,"earfcn":18900,"time_ms":20000,"tx_power_dbm":20,"offset_hz":0}',
        '/device/lte/cw {"timeout":5,"start":true,"earfcn":19000,"time_ms":20000,"tx_power_dbm":20,"offset_hz":0}',
        "measure freq_hz=1890000000",
        '/device/lte/cw {"timeout":5,"start":false,"earfcn":19000,"time_ms":20000,"tx_power_dbm":20,"offset_hz":0}',
        # New: the sequence's end powers the modem off (the page left it on).
        '/device/lte/modem-off {"timeout":5}',
    ]
    assert [(row["earfcn"], row["measured_dbm"], row["verdict"]) for row in r.rows("l")] == [
        (18900, 19.6, "pass"), (19000, 17.0, "fail"),
    ]


@sync
async def test_lte_modulated_sends_what_the_panel_sent():
    rig = FakeRig(power=20.0)
    step = {
        "uid": "lm", "test": "lte-modulated", "setup": "main", "label": "LTE modulated", "settle_ms": 400,
        "points": [
            {"earfcn": 18900, "band": 2, "freq_mhz": 1880.0, "power_dbm": p, "bandwidth": 2, "mcs": 5,
             "rb_count": 6, "margin_db": 1.0}
            for p in (20, 23)
        ],
    }
    await run({"steps": [step], "bench": "main"}, rig)
    body = '"time_ms":20000,"tx_power_dbm":{p},"bandwidth":2,"mcs":5,"rb_count":6,"rb_start":0,"nb_index":0'
    assert rig.trace == [
        '/device/lte/modem-off {"timeout":5}',
        '/device/lte/modem-on {"timeout":10}',
        '/device/lte/modulated {"timeout":5,"start":true,"earfcn":18900,' + body.format(p=20) + "}",
        "measure freq_hz=1880000000",
        '/device/lte/modulated {"timeout":5,"start":false,"earfcn":18900,' + body.format(p=20) + "}",
        '/device/lte/modulated {"timeout":5,"start":true,"earfcn":18900,' + body.format(p=23) + "}",
        "measure freq_hz=1880000000",
        '/device/lte/modulated {"timeout":5,"start":false,"earfcn":18900,' + body.format(p=23) + "}",
        '/device/lte/modem-off {"timeout":5}',
    ]


@sync
async def test_ble_cw_drives_the_radio_as_the_panel_did():
    """BLE panel test: ch 0 and 39 at power 31 (limits 0-10), ch 19 at 20.

    The browser's trace (BleAutomationPanel.test.tsx.snap, as it was) at the link's
    level: setPower 31, tone ch0 5 s, finishTone, tone ch39 2 s, finishTone,
    ensurePower 20, tone ch19 2 s, finishTone. Here each link call is seen as
    the rig calls it makes: a set is set+reset then relink, a finish a relink.
    """
    rig = FakeRig(power_at={2_402_000_000: 5.0}, power=12.0)
    seq = {"steps": [ble_cw("b", [(0, 31, 0, 10), (39, 31, 0, 10), (19, 20, None, None)])], "bench": "ble"}
    r = await run(seq, rig)
    assert rig.trace == [
        "setPower 31", "relink",
        'tone {"channel":0,"duration_s":5,"offset":0}', "measure freq_hz=2402000000", "relink",
        'tone {"channel":39,"duration_s":2,"offset":0}', "measure freq_hz=2480000000", "relink",
        "setPower 20", "relink",
        'tone {"channel":19,"duration_s":2,"offset":0}', "measure freq_hz=2440000000", "relink",
    ]
    assert [(row["channel"], row["verdict"]) for row in r.rows("b")] == [(0, "pass"), (39, "fail"), (19, None)]


# ------------------------------------------------------------------ the sequence


@sync
async def test_runs_steps_in_order_and_pauses_once_to_recable():
    rig = FakeRig(power=14.0)
    prompts: list[tuple] = []

    def answer(p):
        prompts.append((p.from_setup, p.to_setup, p.step_uid))
        return True

    seq = {"steps": [lora_cw("a", [(915, 14, 1, 1.0)]), lora_cw("b", [(915, 20, 1, 1.0)]),
                     ble_cw("c", [(19, 31, None, None)])], "bench": "main"}
    r = await run(seq, rig, answer)
    # One prompt: the two LoRa steps share a setup.
    assert prompts == [("main", "ble", "c")]
    s = r.status()
    assert [o.verdict for o in s.steps] == ["pass", "fail", "na"]
    assert s.bench == "ble"
    powers = [t for t in rig.trace if t.startswith("/device/lora-power")]
    assert ['"power_dbm":14' in powers[0], '"power_dbm":20' in powers[1]] == [True, True]
    # Idle at the end: LoRa stopped, BLE back on the link.
    assert rig.trace[-1] == IDLE_LORA


@sync
async def test_asks_before_the_first_step_only_when_the_bench_is_not_on_it():
    rig = FakeRig()
    asked: list = []
    await run({"steps": [lora_cw("a", [(915, 14, 1, None)])], "bench": "main"}, rig, lambda p: asked.append(p) or True)
    assert asked == []
    await run({"steps": [lora_cw("a", [(915, 14, 1, None)])], "bench": None}, rig, lambda p: asked.append(p) or True)
    assert [(p.from_setup, p.to_setup) for p in asked] == [(None, "main")]


@sync
async def test_declining_the_recable_ends_the_run_with_the_rest_not_run():
    rig = FakeRig()
    seq = {"steps": [lora_cw("a", [(915, 14, 1, None)]), ble_cw("c", [(19, 31, None, None)])], "bench": "main"}
    r = await run(seq, rig, lambda p: False)
    s = r.status()
    assert s.state == RunState.CANCELLED and s.ended == "declined"
    assert [o.verdict for o in s.steps] == ["na", "not-run"]
    assert not any(t.startswith("tone") for t in rig.trace)
    # The bench did not move.
    assert s.bench == "main"


@sync
async def test_a_stale_answer_is_ignored():
    rig = FakeRig()
    r = SequenceRunner()
    await r.start(SequenceIn(steps=[ble_cw("c", [(19, 31, None, None)])], bench="main"), rig, clock=FakeClock())
    for _ in range(100):
        if r.status().prompt:
            break
        await asyncio.sleep(0)
    seq_no = r.status().prompt.seq
    r.answer_prompt(seq_no + 1, True)
    await asyncio.sleep(0)
    assert r.status().prompt is not None and r.status().state == RunState.RUNNING
    await r.cancel()
    await asyncio.wait_for(r._ctx.task, 5)


@sync
async def test_stop_at_the_prompt_ends_the_run_without_running_the_step():
    rig = FakeRig()
    r = SequenceRunner()
    seq = SequenceIn(steps=[lora_cw("a", [(915, 14, 1, None)]), ble_cw("c", [(19, 31, None, None)])], bench="main")
    await r.start(seq, rig, clock=FakeClock())
    for _ in range(1000):
        if r.status().prompt:
            break
        await asyncio.sleep(0)
    await r.cancel()
    await asyncio.wait_for(r._ctx.task, 5)
    s = r.status()
    assert s.state == RunState.CANCELLED and s.ended == "stopped"
    assert [o.verdict for o in s.steps] == ["na", "not-run"]
    assert not any(t.startswith("tone") for t in rig.trace)


@sync
async def test_stop_mid_point_keys_down_and_records_nothing_after():
    rig = FakeRig()
    r = SequenceRunner()
    seq = SequenceIn(steps=[lora_cw("a", [(902.3, 14, 1, None), (915, 14, 1, None)]),
                            lora_cw("b", [(915, 20, 1, None)])], bench="main")

    async def stop_on_first_tx():
        rig.on_tx = None
        await r.cancel()

    rig.on_tx = stop_on_first_tx
    await r.start(seq, rig, clock=FakeClock())
    await asyncio.wait_for(r._ctx.task, 5)
    s = r.status()
    assert s.state == RunState.CANCELLED
    assert [o.verdict for o in s.steps] == ["stopped", "not-run"]
    assert r.rows("a") == []
    # One point keyed, and the DUT told to stop.
    assert sum(t.startswith("/device/lora-power") for t in rig.trace) == 1
    assert rig.trace.count(IDLE_LORA) >= 2


@sync
async def test_a_failing_step_carries_on():
    rig = FakeRig(power=10.0)
    seq = {"steps": [lora_cw("a", [(915, 14, 1, 1.0)]), lora_cw("b", [(915, 10, 1, 1.0)])], "bench": "main"}
    r = await run(seq, rig)
    s = r.status()
    assert s.state == RunState.DONE
    assert [o.verdict for o in s.steps] == ["fail", "pass"]


@sync
async def test_a_step_that_cannot_go_on_ends_the_run_and_still_leaves_the_rig_idle():
    rig = FakeRig(modem_on_ok=False)
    lte = {
        "uid": "l", "test": "lte-cw", "setup": "main", "label": "LTE CW", "settle_ms": 400,
        "points": [{"earfcn": 18900, "freq_mhz": 1880.0, "power_dbm": 20, "margin_db": 1.0}],
    }
    seq = {"steps": [lte, lora_cw("a", [(915, 14, 1, None)])], "bench": "main"}
    r = await run(seq, rig)
    s = r.status()
    assert s.state == RunState.ERROR and s.ended == "error"
    assert "modem on rejected" in (s.error or "")
    assert [o.verdict for o in s.steps] == ["error", "not-run"]
    assert not any(t.startswith("/device/lora-power") for t in rig.trace)
    assert rig.trace[-1] == '/device/lte/modem-off {"timeout":5}'


@sync
async def test_a_second_start_is_refused_while_one_runs():
    rig = FakeRig()
    r = SequenceRunner()
    seq = SequenceIn(steps=[ble_cw("c", [(19, 31, None, None)])], bench="main")
    await r.start(seq, rig, clock=FakeClock())
    with pytest.raises(RuntimeError):
        await r.start(seq, rig, clock=FakeClock())
    await r.cancel()
    await asyncio.wait_for(r._ctx.task, 5)


@sync
async def test_shutdown_stops_the_run_and_leaves_the_rig_idle():
    rig = FakeRig()
    r = SequenceRunner()
    seq = SequenceIn(steps=[lora_cw("a", [(915, 14, 1, None)]), ble_cw("c", [(19, 31, None, None)])], bench="main")
    await r.start(seq, rig, clock=FakeClock())
    for _ in range(1000):
        if r.status().prompt:
            break
        await asyncio.sleep(0)
    await r.shutdown()
    s = r.status()
    assert s.state == RunState.CANCELLED
    assert s.error == "backend shut down mid-run"
    assert rig.trace[-1] == IDLE_LORA


# ---------- the API's checks before anything is keyed ----------

def test_a_bad_point_is_a_422_before_the_run_starts() -> None:
    from fastapi import HTTPException

    from backend.api.sequence import _check_points

    good = SequenceIn(steps=[lora_cw("a", [(915, 14, 1, None)])], bench="main")
    _check_points(good)
    bad = good.model_copy(deep=True)
    bad.steps[0].points[0]["power_dbm"] = "loud"
    with pytest.raises(HTTPException) as e:
        _check_points(bad)
    assert e.value.status_code == 422
    assert "step 1" in e.value.detail


def test_a_pages_own_run_is_named_by_its_test() -> None:
    async def go() -> None:
        r = SequenceRunner()
        assert r.name() == "Test Sequence"
        seq = SequenceIn(steps=[lora_cw("run:power", [(915, 14, 1, None)])], bench="main")
        await r.start(seq, FakeRig(), clock=FakeClock())
        assert r.name() == "LoRa CW"
        await r.cancel()
        await r._ctx.task  # torn down, rig idle
        seq = SequenceIn(steps=[lora_cw("a", [(915, 14, 1, None)])], bench="main")
        await r.start(seq, FakeRig(), clock=FakeClock())
        assert r.name() == "Test Sequence"
        await r.cancel()
    asyncio.run(go())



# ---------- frequency accuracy

STAGES = [{"span_hz": 1_000_000, "rbw_hz": 10_000, "vbw_hz": 10_000},
          {"span_hz": 1_000, "rbw_hz": 10, "vbw_hz": 10}]


def freq_step(uid: str, test: str, points: list[dict], stage_limits=None) -> dict:
    return {"uid": uid, "test": test, "setup": "main", "label": "Frequency accuracy", "settle_ms": 400,
            "points": points, "freq": {"stages": STAGES, "stage_limits_ppm": stage_limits or []}}


@sync
async def test_lora_frequency_accuracy_keys_zooms_and_keys_down_each_point():
    """Each point: key the carrier, prepare, each stage set up then measured
    (re-centred from stage 2), keyed down -- as api/freq_accuracy.py runs it."""
    rig = FakeRig(offset_hz=4.0)
    seq = {"steps": [freq_step("f", "freq-accuracy", [
        {"freq_mhz": 902.3, "power_dbm": 14, "pa_mode": 2, "limit_ppm": 30},
    ])], "bench": "main"}
    r = await run(seq, rig)
    assert rig.trace == [
        "zoom begin",
        "/device/lora-power " + _body(timeout=5, freq_hz=902_300_000, power_dbm=14, pa_mode=2),
        "zoom prepare ref=19",
        "zoom setup 1 span=1000000 center=902300000",
        "zoom measure 1",
        "zoom setup 2 span=1000",
        "zoom measure 2",
        IDLE_LORA,
        "zoom end",
        IDLE_LORA,  # the run's end leaves the rig idle
    ]
    row = r.rows("f")[0]
    assert row["measuredHz"] == 902_300_004
    assert row["errorHz"] == 4
    assert abs(row["errorPpm"] - 4 / 902.3) < 1e-9
    assert row["verdict"] == "pass"
    assert r.status().steps[0].verdict == "pass"


@sync
async def test_frequency_accuracy_judges_the_final_error_and_each_stage():
    # 40 Hz off at 902.3 MHz is 0.044 ppm: inside 30 ppm, outside a 0.01 ppm stage limit.
    rig = FakeRig(offset_hz=40.0, zoom_edge_at=2)
    seq = {"steps": [freq_step("f", "freq-accuracy", [
        {"freq_mhz": 902.3, "power_dbm": 14, "limit_ppm": 30},
        {"freq_mhz": 915, "power_dbm": 14, "limit_ppm": None},
    ], stage_limits=[None, 0.01])], "bench": "main"}
    r = await run(seq, rig)
    a, b = r.rows("f")
    assert a["verdict"] == "fail"           # stage 2's peak is outside its 0.01 ppm
    assert b["verdict"] == "fail"           # judged on the stage even with no final limit
    assert a["note"] == "peak near the edge"
    assert r.status().steps[0].verdict == "fail"


@sync
async def test_a_refused_carrier_is_an_error_and_still_keyed_down():
    rig = FakeRig(tx_ok=False)
    seq = {"steps": [freq_step("f", "freq-accuracy", [{"freq_mhz": 915, "power_dbm": 14}])], "bench": "main"}
    r = await run(seq, rig)
    row = r.rows("f")[0]
    assert "refused the CW command" in row["error"]
    assert row["verdict"] is None
    assert not any(t.startswith("zoom prepare") for t in rig.trace)
    assert rig.trace[2] == IDLE_LORA


@sync
async def test_lte_frequency_accuracy_owns_the_modem_and_holds_each_test():
    rig = FakeRig()
    seq = {"steps": [freq_step("l", "lte-freq-accuracy", [
        {"freq_mhz": 1880, "earfcn": 18900, "power_dbm": 23, "limit_ppm": 30},
    ])], "bench": "main"}
    r = await run(seq, rig)
    cw = lambda start: "/device/lte/cw " + _body(  # noqa: E731
        timeout=5, start=start, earfcn=18900, time_ms=600000, tx_power_dbm=23, offset_hz=0)
    assert rig.trace == [
        "zoom begin",
        "/device/lte/modem-off " + _body(timeout=5),
        "/device/lte/modem-on " + _body(timeout=10),
        cw(True),
        "zoom prepare ref=28",
        "zoom setup 1 span=1000000 center=1880000000",
        "zoom measure 1",
        "zoom setup 2 span=1000",
        "zoom measure 2",
        cw(False),
        "zoom end",
        "/device/lte/modem-off " + _body(timeout=5),  # the run's end
    ]
    assert r.rows("l")[0]["verdict"] == "pass"


def test_the_api_refuses_a_frequency_step_it_could_not_run() -> None:
    from fastapi import HTTPException

    from backend.api.sequence import _check_points

    ok = SequenceIn(steps=[freq_step("f", "freq-accuracy", [{"freq_mhz": 915, "power_dbm": 14}])], bench="main")
    _check_points(ok)
    for bad, why in [
        (freq_step("l", "lte-freq-accuracy", [{"freq_mhz": 1880, "power_dbm": 23}]), "EARFCN"),
        (freq_step("l", "lte-freq-accuracy", [{"freq_mhz": 1880, "earfcn": 18900, "power_dbm": 30}]), "tops out"),
        (freq_step("f", "freq-accuracy", [{"freq_mhz": 915, "power_dbm": 14.5}]), "whole dBm"),
        ({**freq_step("f", "freq-accuracy", [{"freq_mhz": 915, "power_dbm": 14}]), "freq": None}, "stages"),
    ]:
        with pytest.raises(HTTPException, match=why):
            _check_points(SequenceIn(steps=[bad], bench="main"))
