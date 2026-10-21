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
from typing import Awaitable, Callable, Optional

from ..device import Device, PaMode
from ..hw.base import CurrentMeter, PowerMeter
from .models import ResultRow, RunState, RunStatus, SweepConfig

#: Called once a run has ended and the DUT is keyed down, with the run's final
#: status and rows. Returns where it saved them, or None. See api/test.py.
OnFinish = Callable[[RunStatus, list[ResultRow]], Awaitable[Optional[str]]]

#: Called when a CW command raised, with the device it was sent to. Returns the
#: device to carry on with once the BLE link is back, or None when the link was
#: never down (or did not come back). See BLEManager.wait_for_device.
Relink = Callable[[Device], Awaitable[Optional[Device]]]

log = logging.getLogger(__name__)

# Log the first few steps, then every 50th — enough to see progress and timing
# without flooding the console on a 600-step sweep.
_LOG_HEAD_STEPS = 3
_LOG_EVERY = 50

# Consecutive CW commands that raised before the run is abandoned. One failed
# point is a bad point; several in a row is the DUT link gone. Without a limit
# a dropped link failed every remaining step in milliseconds and the run still
# finished as "done", hundreds of empty rows and no error.
_LINK_FAIL_LIMIT = 3

# Pause before resending a failed step on a link that still looked up, so a
# drop that has not been reported yet has time to show. See _send_cw.
_RETRY_DELAY_S = 1.5

# How long shutdown waits for a running sweep to stop and key the DUT down
# before the BLE link is released under it. One command timeout plus a settle
# covers the step in flight; teardown's stop needs another command timeout.
_SHUTDOWN_GRACE_S = 15.0


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
    #: CW commands that raised in a row -- see _LINK_FAIL_LIMIT.
    cmd_failures: int = 0
    #: Why the run was cancelled, when it was not the operator: reported as
    #: the run's error so a stop nobody pressed does not read as a clean one.
    cancel_reason: Optional[str] = None
    autosave_path: Optional[str] = None
    #: The device commands go to. Replaced when the link drops and the BLE
    #: manager reconnects: its reconnect builds a new Device, and the one the
    #: run started with stays bound to the dead client for good.
    device: Optional[Device] = None
    relink: Optional[Relink] = None


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
            autosave_path=ctx.autosave_path,
        )

    def results(self) -> list[ResultRow]:
        return list(self._ctx.results) if self._ctx else []

    async def start(
        self,
        config: SweepConfig,
        device: Device,
        power_meter: Optional[PowerMeter],
        current_meter: Optional[CurrentMeter],
        on_finish: Optional[OnFinish] = None,
        relink: Optional[Relink] = None,
    ) -> RunStatus:
        async with self._lock:
            if self._ctx and self._ctx.state == RunState.RUNNING:
                raise RuntimeError("Test already running")
            config.validate_ranges()
            ctx = _RunCtx(config=config, device=device, relink=relink)
            # Mark RUNNING here, not inside _run: the task does not begin
            # executing until this coroutine yields, so a second /test/run
            # arriving first would otherwise pass the guard above and drive a
            # second sweep against the same DUT.
            ctx.state = RunState.RUNNING
            ctx.started_at = time.time()
            self._ctx = ctx
            ctx.task = asyncio.create_task(
                self._run(ctx, device, power_meter, current_meter, on_finish)
            )
            return self.status()

    async def cancel(self) -> RunStatus:
        if self._ctx and self._ctx.state == RunState.RUNNING:
            self._ctx.cancel.set()
        return self.status()

    async def shutdown(self) -> None:
        """Stop a running sweep before the process releases its hardware.

        Shutdown used to drop the BLE link with the sweep still going: every
        remaining step then failed at once, the run ended "done", and the
        process exited with the rows only in memory. Stopping here first lets
        teardown key the DUT down while the link is still up.
        """
        ctx = self._ctx
        if ctx is None or ctx.state != RunState.RUNNING or ctx.task is None:
            return
        log.warning("Backend shutting down mid-sweep at step %d", len(ctx.results))
        ctx.cancel_reason = "backend shut down mid-run"
        ctx.cancel.set()
        try:
            await asyncio.wait_for(asyncio.shield(ctx.task), _SHUTDOWN_GRACE_S)
        except Exception as e:
            log.warning("Sweep did not stop within %.0fs: %s", _SHUTDOWN_GRACE_S, e)

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

    async def _send_cw(self, ctx: _RunCtx, hp: int, duty: int, power: int):
        """The step's CW command, retried once on a link that came back.

        A BLE drop mid-sweep used to fail every remaining point with "Not
        connected" -- the manager had already reconnected, but to a new Device
        this run never saw. Now a failed command asks for the current link and,
        if it is a new one, sends the same point again on it.
        """
        async def send(device: Device):
            return await device.lora_cw(
                freq_hz=ctx.config.freq_hz,
                power_dbm=power,
                pa_duty_cycle=duty,
                hp_max=hp,
                pa_mode=PaMode(ctx.config.pa_mode),
                timeout=ctx.config.cmd_timeout_s,
            )

        try:
            return await send(ctx.device)
        except Exception as e:
            if ctx.relink is None:
                raise
            log.warning("CW command failed (%s: %s); checking the BLE link", type(e).__name__, e)
            fresh = await ctx.relink(ctx.device)
            if fresh is None:
                # The link still looked up -- but a command that times out is
                # often the first sign of a drop bleak has not reported yet,
                # and trusting that first look skipped the point (row 70 of a
                # bench run, a TimeoutError a moment before the reconnect).
                # Give the drop time to surface, look again, and resend either
                # way: on the new link if there is one, on the same one if not.
                await asyncio.sleep(_RETRY_DELAY_S)
                fresh = await ctx.relink(ctx.device)
            if fresh is not None:
                log.info("BLE link back; resending step hp=%d duty=%d pow=%d", hp, duty, power)
                ctx.device = fresh
            else:
                log.info("Resending step hp=%d duty=%d pow=%d on the same link", hp, duty, power)
            return await send(ctx.device)

    async def _measure_step(
        self,
        ctx: _RunCtx,
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
            # No stop between points: the DUT accepts a new CW while already
            # keyed, and measured on the bench this made no difference to the
            # readings. Settle time is what governs them. A stop here cost
            # POST_STOP_RECOVERY_S (1.5s) per point — ~16 min over a 616-point
            # sweep — for nothing.
            try:
                result = await self._send_cw(ctx, hp, duty, power)
            except Exception:
                ctx.cmd_failures += 1
                raise
            ctx.cmd_failures = 0
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
        on_finish: Optional[OnFinish] = None,
    ) -> None:
        # `device` is only the one the run started with; steps and teardown use
        # ctx.device, which a reconnect replaces.
        # state/started_at are set by start() so the guard there is race-free.
        t0 = time.perf_counter()
        # Published only once teardown and the autosave are done: the page
        # stops polling the moment the run leaves RUNNING, so a state set
        # earlier would never carry the saved path to it, and a new run could
        # start while this one was still keying the DUT down.
        final = RunState.DONE
        log.info("Sweep started: %d steps", ctx.config.total_steps)

        try:
            if pm is not None:
                await asyncio.to_thread(pm.set_frequency_hz, ctx.config.freq_hz)
                # Let the sensor apply its calibration before the first read.
                await asyncio.sleep(0.2)

            idx = 0
            # Blocks in the order they were given; a single implicit block when
            # none were, which is the legacy cross-product. See
            # `SweepConfig.effective_blocks`.
            for block in ctx.config.effective_blocks:
                for hp in block.hp_values:
                    for duty in block.duty_values:
                        for power in block.power_values:
                            if ctx.cancel.is_set():
                                final = RunState.CANCELLED
                                ctx.error = ctx.cancel_reason
                                return
                            row = await self._measure_step(
                                ctx, pm, cm, idx, hp, duty, power, t0,
                            )
                            ctx.results.append(row)
                            idx += 1
                            if ctx.cmd_failures >= _LINK_FAIL_LIMIT:
                                raise RuntimeError(
                                    f"DUT not answering: {_LINK_FAIL_LIMIT} commands "
                                    f"failed in a row, last: {row.error}"
                                )

        except Exception as e:
            final = RunState.ERROR
            ctx.error = f"{type(e).__name__}: {e}"
            log.exception("Sweep failed")
        finally:
            ctx.finished_at = time.time()
            await self._teardown(ctx, ctx.device or device, pm, cm)
            if on_finish is not None and ctx.results:
                try:
                    status = self.status().model_copy(update={"state": final})
                    ctx.autosave_path = await on_finish(status, list(ctx.results))
                except Exception as e:
                    # The rows are still in memory and Export still works; a
                    # failed autosave must not turn a good run into a bad one.
                    log.warning("Sweep autosave failed: %s: %s", type(e).__name__, e)
            ctx.state = final
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
