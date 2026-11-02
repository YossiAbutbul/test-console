"""The Load Pull run engine, against a fake rig.

What matters is that the backend loop measures the same points, in the same
order, with the same bench moves as the browser loop it replaced -- and that
it stops, prompts and keys down where that one did.
"""
from __future__ import annotations

import asyncio
import functools
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from backend.loadpull.models import LoadPullRunConfig, PathLossPoint, PlanPoint
from backend.loadpull.runner import LoadPullRunner
from backend.sweep.models import RunState


def sync(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Run an async test body without depending on pytest-asyncio."""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class FastRunner(LoadPullRunner):
    """Settles take no time; a cancel still cuts them short."""
    async def _sleep(self, ctx, seconds):  # type: ignore[override]
        await asyncio.sleep(0)


@dataclass
class Tx:
    ok: bool = True
    status: int = 0


@dataclass
class FakeRig:
    calls: list[tuple] = field(default_factory=list)
    tx_ok: bool = True
    tx_raises: bool = False
    power: float = -20.0
    #: Called on every tx_on, for tests that need to act mid-run.
    on_tx: Optional[Callable[[PlanPoint], None]] = None

    async def move(self, pos): self.calls.append(("move", pos))
    async def travel_limits(self, lo, hi): self.calls.append(("limits", lo, hi))
    async def wait_motor_idle(self, cancel): self.calls.append(("idle",))
    async def motor_stop(self): self.calls.append(("motor_stop",))
    async def switch(self, target): self.calls.append(("switch", target))
    async def vna_span(self, a, b): self.calls.append(("span", a, b))

    async def vna_read(self, hz):
        self.calls.append(("vna", hz))
        return {"r_ohm": 50.0, "x_ohm": hz / 1e9, "s11_mag_db": -20.0}

    async def tx_on(self, config, point):
        self.calls.append(("tx_on", point.freq_mhz, point.power_dbm))
        if self.on_tx:
            self.on_tx(point)
        if self.tx_raises:
            raise RuntimeError("Not connected")
        return Tx(ok=self.tx_ok, status=0 if self.tx_ok else 3)

    async def tx_off(self, config, point): self.calls.append(("tx_off",))

    async def measure(self, hz):
        self.calls.append(("measure", hz))
        return self.power, 0.25, None

    async def modem_cycle(self): self.calls.append(("modem_cycle",))
    async def end_run(self, config): self.calls.append(("end_run",))


def plan(positions, freqs, powers=(14,), atts=(None,), earfcn=None) -> list[PlanPoint]:
    """Attenuation outermost, then position, frequency, power -- the page's order."""
    return [
        PlanPoint(pos=pos, freq_mhz=f, power_dbm=pw, att_db=att, earfcn=earfcn)
        for att in atts for pos in positions for f in freqs for pw in powers
    ]


def config(points, **kw) -> LoadPullRunConfig:
    return LoadPullRunConfig(radio=kw.pop("radio", "LoRa"), points=points, **kw)


async def finish(r: LoadPullRunner, timeout: float = 5.0) -> None:
    for _ in range(int(timeout / 0.01)):
        if r.status().state != RunState.RUNNING:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("run did not finish")


class TestOrder:
    @sync
    async def test_vna_and_move_happen_once_per_position(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [902.3, 915.0])), rig)
        await finish(r)
        assert [c for c in rig.calls if c[0] == "move"] == [("move", 0), ("move", 400)]
        # Each frequency read on its own span, at each position.
        assert [c[1] for c in rig.calls if c[0] == "vna"] == [902_300_000, 915_000_000] * 2
        assert r.status().state == RunState.DONE
        assert r.status().completed == 4

    @sync
    async def test_span_is_half_a_percent_either_side(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0], [1000.0])), rig)
        await finish(r)
        assert ("span", 995_000_000, 1_005_000_000) in rig.calls

    @sync
    async def test_rows_carry_markers_corrected_power_and_raw(self) -> None:
        r, rig = FastRunner(), FakeRig(power=-20.0)
        cfg = config(plan([800], [915.0]), path_loss=[PathLossPoint(freq_mhz=915.0, db=30.5)])
        await r.start(cfg, rig)
        await finish(r)
        row = r.rows()[0]
        assert (row.pos_pulses, row.pos_mm, row.freq_mhz) == (800, 2.0, 915.0)
        assert (row.power_dbm_raw, row.power_dbm, row.current_a) == (-20.0, 10.5, 0.25)
        assert (row.r_ohm, row.s11_db) == (50.0, -20.0)
        assert row.error is None

    @sync
    async def test_every_point_is_keyed_down(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [915.0], powers=(10, 14))), rig)
        await finish(r)
        names = [c[0] for c in rig.calls]
        assert names.count("tx_on") == names.count("tx_off") == 4
        assert names[-1] == "end_run"


class TestContinue:
    @sync
    async def test_starts_at_start_index_and_counts_the_rows_before_it(self) -> None:
        r, rig = FastRunner(), FakeRig()
        points = plan([0, 400, 800], [915.0])
        await r.start(config(points, start_index=2), rig)
        await finish(r)
        assert [c for c in rig.calls if c[0] == "move"] == [("move", 800)]
        s = r.status()
        assert (s.start_index, s.rows, s.completed, s.total) == (2, 1, 3, 3)


class TestAttenuator:
    @sync
    async def test_prompts_at_each_step_and_returns_the_trombone(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [915.0], atts=(0.0, 1.0))), rig)
        answered = []
        for _ in range(500):
            s = r.status()
            if s.att_prompt and s.att_prompt.seq not in answered:
                answered.append(s.att_prompt.seq)
                assert s.phase == "attenuator"
                assert s.att_prompt.cycles == 2
                r.answer_prompt(s.att_prompt.seq, True)
            if s.state != RunState.RUNNING:
                break
            await asyncio.sleep(0.01)
        assert answered == [1, 2]
        # The second cycle drives the trombone back to the start.
        assert [c[1] for c in rig.calls if c[0] == "move"] == [0, 400, 0, 400]
        assert r.status().state == RunState.DONE

    @sync
    async def test_declining_the_prompt_stops_the_run(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0], [915.0], atts=(0.0,))), rig)
        for _ in range(200):
            s = r.status()
            if s.att_prompt:
                r.answer_prompt(s.att_prompt.seq, False)
                break
            await asyncio.sleep(0.01)
        await finish(r)
        assert r.status().state == RunState.CANCELLED
        assert r.rows() == []

    @staticmethod
    async def _answer_all(r: LoadPullRunner, answers: list[Optional[float]]) -> list[Any]:
        """Answer each prompt with the next of `answers` (None: as asked);
        return the prompts seen."""
        seen: list[Any] = []
        for _ in range(1000):
            s = r.status()
            if s.att_prompt and (not seen or s.att_prompt.seq != seen[-1].seq):
                seen.append(s.att_prompt)
                r.answer_prompt(s.att_prompt.seq, True, answers[len(seen) - 1])
            if s.state != RunState.RUNNING:
                break
            await asyncio.sleep(0.01)
        return seen

    @sync
    async def test_a_later_setting_jumps_over_the_cycles_between(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [915.0], atts=(0.0, 1.0, 2.0, 3.0))), rig)
        seen = await self._answer_all(r, [None, 3.0])
        assert [p.db for p in seen] == [0.0, 1.0]
        assert seen[1].upcoming == [2.0, 3.0]
        assert [row.att_db for row in r.rows()] == [0.0, 0.0, 3.0, 3.0]
        s = r.status()
        assert s.state == RunState.DONE
        # The 1 and 2 dB cycles: passed over, but counted as done.
        assert (s.skipped, s.completed, s.total) == (4, 8, 8)

    @sync
    async def test_an_off_plan_setting_runs_this_cycle_only(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [915.0], atts=(0.0, 1.0))), rig)
        seen = await self._answer_all(r, [7.0, None])
        assert [p.db for p in seen] == [0.0, 1.0]
        assert [row.att_db for row in r.rows()] == [7.0, 7.0, 1.0, 1.0]
        assert r.status().skipped == 0

    @sync
    async def test_a_stale_answer_is_ignored(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0], [915.0], atts=(0.0,))), rig)
        for _ in range(200):
            if r.status().att_prompt:
                break
            await asyncio.sleep(0.01)
        r.answer_prompt(99, False)
        assert r.status().att_prompt is not None
        await r.cancel()
        await finish(r)


class TestTravelLimits:
    @sync
    async def test_the_run_sets_the_limits_from_its_whole_plan_first(self) -> None:
        # Another page's ends may be on the motor; a Continue still sets the
        # range of every point, not only those left.
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([13822, 55693, 30000], [915.0]), start_index=1), rig)
        await finish(r)
        assert rig.calls[0] == ("limits", 13822, 55693)


class TestStopping:
    @sync
    async def test_cancel_stops_the_motor_and_drops_the_partial_point(self) -> None:
        r = FastRunner()
        rig = FakeRig()
        rig.on_tx = lambda _p: asyncio.get_running_loop().create_task(r.cancel())
        await r.start(config(plan([0, 400], [915.0])), rig)
        await finish(r)
        s = r.status()
        assert s.state == RunState.CANCELLED
        assert s.rows == 0
        assert ("motor_stop",) in rig.calls
        assert rig.calls[-1] == ("end_run",)

    @sync
    async def test_a_dead_link_ends_the_run_as_an_error(self) -> None:
        r, rig = FastRunner(), FakeRig(tx_raises=True)
        await r.start(config(plan([0], [915.0], powers=(1, 2, 3, 4, 5))), rig)
        await finish(r)
        s = r.status()
        assert s.state == RunState.ERROR
        assert "DUT not answering" in (s.error or "")
        assert s.rows == 3

    @sync
    async def test_a_rejected_command_is_an_error_row_not_a_reading(self) -> None:
        r, rig = FastRunner(), FakeRig(tx_ok=False)
        await r.start(config(plan([0], [915.0])), rig)
        await finish(r)
        row = r.rows()[0]
        assert row.error == "tx status=3"
        assert row.power_dbm is None
        assert ("measure", 915_000_000) not in rig.calls

    @sync
    async def test_a_second_start_is_refused(self) -> None:
        r = FastRunner()
        rig = FakeRig()
        await r.start(config(plan([0], [915.0], atts=(0.0,))), rig)
        try:
            await r.start(config(plan([0], [915.0])), rig)
            raise AssertionError("second start accepted")
        except RuntimeError:
            pass
        await r.cancel()
        await finish(r)


class TestLte:
    @sync
    async def test_the_modem_is_cycled_once_before_the_first_point(self) -> None:
        r, rig = FastRunner(), FakeRig()
        await r.start(config(plan([0, 400], [1880.0], powers=(23,), earfcn=18900), radio="LTE"), rig)
        await finish(r)
        # First of what touches the bench; setting the soft limits before it
        # only writes them.
        assert [c for c in rig.calls if c[0] != "limits"][0] == ("modem_cycle",)
        assert [c[0] for c in rig.calls].count("modem_cycle") == 1


class TestConfig:
    def test_lte_points_need_an_earfcn(self) -> None:
        try:
            config(plan([0], [1880.0]), radio="LTE")
            raise AssertionError("accepted")
        except ValueError as e:
            assert "EARFCN" in str(e)

    def test_lora_power_must_be_whole(self) -> None:
        try:
            config(plan([0], [915.0], powers=(14.5,)))
            raise AssertionError("accepted")
        except ValueError as e:
            assert "whole" in str(e)

    def test_start_index_must_be_inside_the_plan(self) -> None:
        try:
            config(plan([0], [915.0]), start_index=1)
            raise AssertionError("accepted")
        except ValueError as e:
            assert "start_index" in str(e)
