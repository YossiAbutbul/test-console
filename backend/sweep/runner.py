"""Parameter-sweep engine.

Iterates HpMax × PaDutyCycle × Power at one frequency. For each point it sends
the CW command, waits for the PA to settle, then reads the power sensor and the
DC analyzer. A step that fails is recorded in its row rather than aborting the
run, so a bad point does not cost the whole sweep.

One sweep runs at a time, tracked by the module-level `runner` singleton — the
`/test` routes start it, poll it and cancel it.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from ..device import Device, PaMode
from ..hw.base import CurrentMeter, PowerMeter
from .models import ResultRow, RunState, RunStatus, SweepConfig

log = logging.getLogger(__name__)

# Log the first few steps, then every 50th — enough to see progress and timing
# without flooding the console on a 600-step sweep.
_LOG_HEAD_STEPS = 3
_LOG_EVERY = 50


@dataclass
class _RunCtx:
    """Mutable state for the sweep currently in flight."""

    config: SweepConfig
    state: RunState = RunState.IDLE
    results: list[ResultRow] = field(default_factory=list)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    task: Optional[asyncio.Task] = None


class TestRunner:
    """Owns the single in-flight sweep and its accumulated results."""

    def __init__(self) -> None:
        self._ctx: Optional[_RunCtx] = None
        self._lock = asyncio.Lock()

    def status(self) -> RunStatus:
        ctx = self._ctx
        if ctx is None:
            return RunStatus(state=RunState.IDLE, completed=0, total=0)
        return RunStatus(
            state=ctx.state,
            completed=len(ctx.results),
            total=ctx.config.total_steps,
            started_at=ctx.started_at,
            finished_at=ctx.finished_at,
            error=ctx.error,
            config=ctx.config,
            last_row=ctx.results[-1] if ctx.results else None,
        )

    def results(self) -> list[ResultRow]:
        return list(self._ctx.results) if self._ctx else []

    async def start(
        self,
        config: SweepConfig,
        device: Device,
        power_meter: Optional[PowerMeter],
        current_meter: Optional[CurrentMeter],
    ) -> RunStatus:
        async with self._lock:
            if self._ctx and self._ctx.state == RunState.RUNNING:
                raise RuntimeError("Test already running")
            config.validate_ranges()
            ctx = _RunCtx(config=config)
            # Mark RUNNING here, not inside _run: the task does not begin
            # executing until this coroutine yields, so a second /test/run
            # arriving first would otherwise pass the guard above and drive a
            # second sweep against the same DUT.
            ctx.state = RunState.RUNNING
            ctx.started_at = time.time()
            self._ctx = ctx
            ctx.task = asyncio.create_task(
                self._run(ctx, device, power_meter, current_meter)
            )
            return self.status()

    async def cancel(self) -> RunStatus:
        if self._ctx and self._ctx.state == RunState.RUNNING:
            self._ctx.cancel.set()
        return self.status()

    def clear(self) -> RunStatus:
        """Drop the finished run's results, returning to idle.

        Refused while a sweep is in flight: the rows are that run's own record,
        and discarding them mid-run would leave progress counting toward a
        total whose measurements no longer exist. Stop it first.
        """
        if self._ctx and self._ctx.state == RunState.RUNNING:
            raise RuntimeError("stop the sweep before clearing its results")
        self._ctx = None
        return self.status()

    async def _measure_step(
        self,
        ctx: _RunCtx,
        device: Device,
        pm: Optional[PowerMeter],
        cm: Optional[CurrentMeter],
        idx: int,
        hp: int,
        duty: int,
        power: int,
        t0: float,
    ) -> ResultRow:
        """Run one sweep point. Never raises — failures land in `row.error`."""
        row = ResultRow(
            idx=idx,
            freq_hz=ctx.config.freq_hz,
            power_dbm_setting=power,
            pa_duty_cycle=duty,
            hp_max=hp,
            tx_hex="",
            rx_hex="",
            ok=False,
            status=-1,
            t_ms=int((time.perf_counter() - t0) * 1000),
        )

        try:
            t_step = time.perf_counter()
            result = await device.lora_cw(
                freq_hz=ctx.config.freq_hz,
                power_dbm=power,
                pa_duty_cycle=duty,
                hp_max=hp,
                pa_mode=PaMode(ctx.config.pa_mode),
                timeout=ctx.config.cmd_timeout_s,
            )
            t_cmd = time.perf_counter()
            row.tx_hex = result.tx.hex(" ")
            row.rx_hex = result.rx.hex(" ")
            row.ok = result.ok
            row.status = result.status
            if not result.ok:
                # A rejected command still measured cleanly as "no signal",
                # so without this the row looked like a real reading of an
                # unpowered DUT rather than a refusal.
                row.error = f"DUT rejected the command (status={result.status})"

            await asyncio.sleep(ctx.config.settle_ms / 1000.0)
            t_settle = time.perf_counter()

            if pm is not None:
                raw_dbm = await asyncio.to_thread(pm.read_dbm)
                row.tx_power_dbm_raw = raw_dbm
                row.tx_power_dbm = raw_dbm + ctx.config.path_loss_db
            t_pm = time.perf_counter()

            if cm is not None:
                row.current_a = await asyncio.to_thread(cm.read_current_a)
                # Supply voltage is supplementary: a rig whose analyzer refuses
                # it should still record power and current, not fail the row.
                try:
                    row.voltage_v = await asyncio.to_thread(cm.read_voltage_v)
                except Exception as e:
                    log.debug("voltage read failed: %s", e)
            t_cm = time.perf_counter()

            if idx < _LOG_HEAD_STEPS or idx % _LOG_EVERY == 0:
                log.info(
                    "step %d/%d hp=%d duty=%d pow=%d cmd=%dms settle=%dms pm=%dms cm=%dms",
                    idx, ctx.config.total_steps, hp, duty, power,
                    int((t_cmd - t_step) * 1000),
                    int((t_settle - t_cmd) * 1000),
                    int((t_pm - t_settle) * 1000),
                    int((t_cm - t_pm) * 1000),
                )
        except Exception as e:
            row.error = f"{type(e).__name__}: {e}"
            log.exception("Step failed idx=%d hp=%d duty=%d pow=%d", idx, hp, duty, power)

        row.t_ms = int((time.perf_counter() - t0) * 1000)
        return row

    async def _run(
        self,
        ctx: _RunCtx,
        device: Device,
        pm: Optional[PowerMeter],
        cm: Optional[CurrentMeter],
    ) -> None:
        # state/started_at are set by start() so the guard there is race-free.
        t0 = time.perf_counter()
        log.info("Sweep started: %d steps", ctx.config.total_steps)

        try:
            if pm is not None:
                await asyncio.to_thread(pm.set_frequency_hz, ctx.config.freq_hz)
                # Let the sensor apply its calibration before the first read.
                await asyncio.sleep(0.2)

            idx = 0
            for hp in ctx.config.hp_values:
                for duty in ctx.config.duty_values:
                    for power in ctx.config.power_values:
                        if ctx.cancel.is_set():
                            ctx.state = RunState.CANCELLED
                            return
                        ctx.results.append(
                            await self._measure_step(ctx, device, pm, cm, idx, hp, duty, power, t0)
                        )
                        idx += 1

            ctx.state = RunState.DONE
        except Exception as e:
            ctx.state = RunState.ERROR
            ctx.error = f"{type(e).__name__}: {e}"
            log.exception("Sweep failed")
        finally:
            ctx.finished_at = time.time()
            await self._teardown(ctx, device, pm, cm)
            log.info("Sweep ended: state=%s completed=%d", ctx.state, len(ctx.results))

    async def _teardown(
        self,
        ctx: _RunCtx,
        device: Device,
        pm: Optional[PowerMeter],
        cm: Optional[CurrentMeter],
    ) -> None:
        """Best-effort cleanup. Runs on every exit path, including cancel."""
        # Always stop TX — otherwise the DUT keeps transmitting after the sweep.
        try:
            await device.stop_test(timeout=ctx.config.cmd_timeout_s)
        except Exception as e:
            log.warning("stop_test at end of sweep failed: %s", e)

        # These sessions are owned by the sweep (see api/test.py), so closing
        # them here does not disturb an instrument the user connected manually.
        for inst in (pm, cm):
            if inst is None:
                continue
            try:
                await asyncio.to_thread(inst.disconnect)
            except Exception as e:
                log.warning("Instrument disconnect failed: %s", e)


runner = TestRunner()
