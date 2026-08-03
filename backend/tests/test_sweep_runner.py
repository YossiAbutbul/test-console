"""Sweep engine behaviour, against fake hardware.

The runner loop had no coverage, which is how a refactor shipped a
`_measure_step` that referenced an undefined `device`: every point recorded
`NameError` and the DUT was never commanded, while the run still reported
`done`. These tests drive the real loop with stand-ins.
"""

from __future__ import annotations

import asyncio
import functools
from dataclasses import dataclass, field
from typing import Any, Callable

import pytest

from backend.sweep.models import RunState, SweepConfig
# Aliased: pytest would otherwise try to collect `TestRunner` as a test class.
from backend.sweep.runner import TestRunner as SweepRunner


def sync(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Run an async test body without depending on pytest-asyncio.

    Without a plugin pytest *skips* async tests rather than failing them, which
    would have left this file silently green while covering nothing.
    """
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


@dataclass
class FakeResult:
    ok: bool = True
    status: int = 0
    tx: bytes = b"\x28\x50"
    rx: bytes = b"\x28\x50\x00"


@dataclass
class FakeDevice:
    """Records every command the runner issues."""

    calls: list[tuple] = field(default_factory=list)
    fail_on_call: int | None = None

    async def lora_cw(self, *, freq_hz, power_dbm, pa_duty_cycle, hp_max, pa_mode, timeout):
        self.calls.append(("cw", freq_hz, power_dbm, pa_duty_cycle, hp_max))
        if self.fail_on_call is not None and len(self.calls) == self.fail_on_call:
            raise RuntimeError("device boom")
        return FakeResult()

    async def stop_test(self, timeout=5.0):
        self.calls.append(("stop",))
        return FakeResult()


class FakePowerMeter:
    def __init__(self, dbm: float = 12.5) -> None:
        self.dbm = dbm
        self.freqs: list[int] = []
        self.disconnected = False

    def connect(self) -> None: ...
    def disconnect(self) -> None: self.disconnected = True
    def set_frequency_hz(self, freq_hz: int) -> None: self.freqs.append(freq_hz)
    def read_dbm(self) -> float: return self.dbm


class FakeCurrentMeter:
    def __init__(self, amps: float = 0.05, volts: float = 3.6) -> None:
        self.amps, self.volts = amps, volts
        self.disconnected = False

    def connect(self) -> None: ...
    def disconnect(self) -> None: self.disconnected = True
    def read_current_a(self) -> float: return self.amps
    def read_voltage_v(self) -> float: return self.volts


def config(**over) -> SweepConfig:
    base = dict(
        freq_hz=908_700_000,
        power_values=[14, 20],
        duty_values=[1],
        hp_values=[1, 2],
        settle_ms=0,
        cmd_timeout_s=1.0,
        pa_mode=2,
    )
    base.update(over)
    return SweepConfig(**base)


async def run_to_completion(runner: SweepRunner, *args) -> None:
    await runner.start(*args)
    ctx = runner._ctx           # noqa: SLF001 — the task handle is not public
    assert ctx is not None and ctx.task is not None
    await ctx.task


class TestSweepRun:
    @sync
    async def test_commands_the_dut_once_per_point(self) -> None:
        device, pm, cm = FakeDevice(), FakePowerMeter(), FakeCurrentMeter()
        runner = SweepRunner()
        await run_to_completion(runner, config(), device, pm, cm)

        cw = [c for c in device.calls if c[0] == "cw"]
        assert len(cw) == 4, "every point must issue a CW command"
        # hp is the outer loop, power the inner one.
        assert [(c[3], c[4], c[2]) for c in cw] == [
            (1, 1, 14), (1, 1, 20), (1, 2, 14), (1, 2, 20),
        ]

    @sync
    async def test_records_a_measurement_for_every_point(self) -> None:
        runner = SweepRunner()
        await run_to_completion(
            runner, config(), FakeDevice(), FakePowerMeter(12.5), FakeCurrentMeter(0.05, 3.6)
        )

        rows = runner.results()
        assert runner.status().state is RunState.DONE
        assert len(rows) == 4
        for r in rows:
            assert r.error is None, f"unexpected error: {r.error}"
            assert r.tx_power_dbm == 12.5
            assert r.current_a == 0.05
            assert r.voltage_v == 3.6
            assert r.ok is True

    @sync
    async def test_applies_path_loss_and_keeps_the_raw_reading(self) -> None:
        runner = SweepRunner()
        await run_to_completion(
            runner, config(path_loss_db=20.5), FakeDevice(), FakePowerMeter(12.5), FakeCurrentMeter()
        )

        row = runner.results()[0]
        assert row.tx_power_dbm == pytest.approx(33.0)
        assert row.tx_power_dbm_raw == pytest.approx(12.5)

    @sync
    async def test_stops_tx_when_the_sweep_ends(self) -> None:
        device = FakeDevice()
        runner = SweepRunner()
        await run_to_completion(runner, config(), device, FakePowerMeter(), FakeCurrentMeter())

        assert device.calls[-1] == ("stop",), "the DUT must not be left transmitting"

    @sync
    async def test_a_rejected_command_is_reported_as_an_error(self) -> None:
        class RejectingDevice(FakeDevice):
            async def lora_cw(self, **kw):
                self.calls.append(("cw",))
                return FakeResult(ok=False, status=255)

        runner = SweepRunner()
        await run_to_completion(runner, config(), RejectingDevice(), FakePowerMeter(), FakeCurrentMeter())

        row = runner.results()[0]
        assert row.ok is False
        assert row.error is not None and "255" in row.error, (
            "a refused command must not look like a successful measurement"
        )

    @sync
    async def test_a_failed_point_is_recorded_and_the_sweep_continues(self) -> None:
        device = FakeDevice(fail_on_call=2)
        runner = SweepRunner()
        await run_to_completion(runner, config(), device, FakePowerMeter(), FakeCurrentMeter())

        rows = runner.results()
        assert len(rows) == 4
        assert rows[1].error is not None and "boom" in rows[1].error
        assert rows[2].error is None, "a bad point must not poison the rest"

    @sync
    async def test_a_missing_voltage_reading_does_not_fail_the_row(self) -> None:
        cm = FakeCurrentMeter()
        cm.read_voltage_v = lambda: (_ for _ in ()).throw(RuntimeError("no volts"))  # type: ignore[method-assign]
        runner = SweepRunner()
        await run_to_completion(runner, config(), FakeDevice(), FakePowerMeter(), cm)

        row = runner.results()[0]
        assert row.error is None, "voltage is supplementary"
        assert row.current_a == 0.05
        assert row.voltage_v is None

    @sync
    async def test_borrowed_instruments_are_still_disconnected_by_teardown(self) -> None:
        # The runner closes what it was handed; ownership is decided by the
        # adapter (see hw/adapters.py), not here.
        pm, cm = FakePowerMeter(), FakeCurrentMeter()
        runner = SweepRunner()
        await run_to_completion(runner, config(), FakeDevice(), pm, cm)

        assert pm.disconnected and cm.disconnected

    @sync
    async def test_cancel_stops_early_and_reports_cancelled(self) -> None:
        runner = SweepRunner()
        cfg = config(power_values=list(range(1, 23)), settle_ms=20)
        await runner.start(cfg, FakeDevice(), FakePowerMeter(), FakeCurrentMeter())
        await asyncio.sleep(0.05)
        await runner.cancel()
        ctx = runner._ctx           # noqa: SLF001
        assert ctx is not None and ctx.task is not None
        await ctx.task

        status = runner.status()
        assert status.state is RunState.CANCELLED
        assert status.completed < cfg.total_steps

    @sync
    async def test_refuses_a_second_concurrent_run(self) -> None:
        runner = SweepRunner()
        cfg = config(power_values=list(range(1, 23)), settle_ms=20)
        await runner.start(cfg, FakeDevice(), FakePowerMeter(), FakeCurrentMeter())
        with pytest.raises(RuntimeError, match="already running"):
            await runner.start(cfg, FakeDevice(), FakePowerMeter(), FakeCurrentMeter())
        await runner.cancel()
        ctx = runner._ctx           # noqa: SLF001
        if ctx and ctx.task:
            await ctx.task


class TestClearResults:
    """`/test/clear` backs the Clear button on the results panel."""

    @sync
    async def test_clear_drops_the_finished_run(self) -> None:
        runner = SweepRunner()
        await run_to_completion(
            runner, config(), FakeDevice(), FakePowerMeter(12.5), FakeCurrentMeter()
        )
        assert runner.results(), "sanity: the run should have produced rows"

        status = runner.clear()

        assert runner.results() == []
        assert status.state is RunState.IDLE
        assert status.completed == 0
        # The page keys its results query on this; leaving the old run's
        # timestamp would let a cleared table reappear from cache.
        assert status.started_at is None

    @sync
    async def test_clear_is_refused_while_running(self) -> None:
        """The rows are the run's own record — dropping them mid-run would
        leave progress counting toward measurements that no longer exist."""
        runner = SweepRunner()
        cfg = config(power_values=list(range(1, 23)), settle_ms=20)
        await runner.start(cfg, FakeDevice(), FakePowerMeter(), FakeCurrentMeter())
        try:
            with pytest.raises(RuntimeError, match="stop the sweep"):
                runner.clear()
            assert runner.status().state is RunState.RUNNING
        finally:
            await runner.cancel()
            ctx = runner._ctx           # noqa: SLF001
            if ctx and ctx.task:
                await ctx.task

    @sync
    async def test_clear_on_an_idle_runner_is_harmless(self) -> None:
        runner = SweepRunner()
        assert runner.clear().state is RunState.IDLE
