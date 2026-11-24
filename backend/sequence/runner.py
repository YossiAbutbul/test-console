"""Test Sequence run engine: several sweeps, one after another, in the backend.

It lives here, not in the page, for the reason Load Pull's runner does: a
browser loop dies with its tab, mid-point, sometimes with the DUT keyed. Now a
tab can close or reload and the run goes on; the page re-attaches by polling
`status`. And as a run the backend holds, it is guarded against every other
(`api/runs.py`), which a browser loop never was.

    per step:     re-cable pause if its bench setup differs, then its points
    per point:    as the step's executor does it (steps.py)
    at the end:   the rig left idle, however the run ended

A step that measured and missed its limits is a result: the run carries on.
A step that raises -- a modem that will not start, a DUT that did not come
back -- ends the run, since the next step would meet the same DUT.

One run at a time, tracked by the module-level `runner`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, Protocol

from ..sweep.models import RunState
from .ble_link import BleLink
from .models import Current, Note, RecablePrompt, SequenceIn, SequenceStatus, SetupId, StepIn, StepOutcome
from .rig import Rig
from .steps import EXECUTORS, PROTOCOL_OF, Executor, Row, StepCtx, message

log = logging.getLogger(__name__)

#: How long shutdown waits for the run to stop and key the DUT down. As the
#: other runners (sweep/runner.py _SHUTDOWN_GRACE_S).
_SHUTDOWN_GRACE_S = 15.0
#: Notes kept for the page; it reads only the ones it has not seen.
_NOTES_KEPT = 200

_SETUP_NAMES = {"main": "Main", "ble": "BLE", "load-pull": "Load Pull"}


class Clock(Protocol):
    def now_ms(self) -> float: ...
    def mono_ms(self) -> float: ...
    async def sleep(self, seconds: float, cancel: Optional[asyncio.Event] = None) -> None: ...


class RealClock:
    def now_ms(self) -> float:
        return time.time() * 1000

    def mono_ms(self) -> float:
        return time.monotonic() * 1000

    async def sleep(self, seconds: float, cancel: Optional[asyncio.Event] = None) -> None:
        if seconds <= 0:
            return
        if cancel is None:
            await asyncio.sleep(seconds)
            return
        # A settle Stop cuts short.
        try:
            await asyncio.wait_for(cancel.wait(), seconds)
        except asyncio.TimeoutError:
            pass


@dataclass
class _Ctx:
    seq: SequenceIn
    rig: Rig
    clock: Clock
    state: RunState = RunState.RUNNING
    outcomes: list[StepOutcome] = field(default_factory=list)
    rows: dict[str, list[Row]] = field(default_factory=dict)
    current: Optional[Current] = None
    bench: Optional[SetupId] = None
    notes: list[Note] = field(default_factory=list)
    note_seq: int = 0
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    ended: Optional[str] = None
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_reason: Optional[str] = None
    task: Optional[asyncio.Task] = None
    prompt: Optional[RecablePrompt] = None
    prompt_answer: Optional[asyncio.Future] = None
    prompt_seq: int = 0
    #: The step in flight's executor, for Stop to tell the DUT.
    executor: Optional[Executor] = None
    #: Protocols whose steps started, for leaving the rig idle.
    used: set[str] = field(default_factory=set)
    ble: Optional[BleLink] = None


def _verdict(passed: int, failed: int, errors: int) -> str:
    """FAIL leads: a step with one FAIL is a failed step whatever else it holds."""
    if failed:
        return "fail"
    if errors:
        return "error"
    if passed:
        return "pass"
    return "na"


def _fmt_freq(test: str, mhz: float) -> str:
    return f"{mhz:.1f}" if test.startswith("lte") else f"{mhz:g}"


#: The step id a sweep page's own run goes by (frontend useAutomationRun).
PAGE_RUN_PREFIX = "run:"


class SequenceRunner:
    def __init__(self) -> None:
        self._ctx: Optional[_Ctx] = None
        self._lock = asyncio.Lock()

    # ---------- what the routes call ----------

    def status(self) -> SequenceStatus:
        ctx = self._ctx
        if ctx is None:
            return SequenceStatus()
        return SequenceStatus(
            state=ctx.state,
            steps=[o.model_copy() for o in ctx.outcomes],
            current=ctx.current.model_copy() if ctx.current else None,
            prompt=ctx.prompt,
            bench=ctx.bench,
            notes=list(ctx.notes),
            started_at=ctx.started_at,
            finished_at=ctx.finished_at,
            error=ctx.error,
            ended=ctx.ended if ctx.state != RunState.RUNNING else None,
        )

    def running(self) -> bool:
        return self._ctx is not None and self._ctx.state == RunState.RUNNING

    def name(self) -> str:
        """What the run is, for an operator told it holds the rig: a sweep
        page's own run (one step, named after the page, "run:power") by its
        test; anything else is a Test Sequence."""
        ctx = self._ctx
        if ctx is not None and len(ctx.seq.steps) == 1 and ctx.seq.steps[0].uid.startswith(PAGE_RUN_PREFIX):
            return ctx.seq.steps[0].label
        return "Test Sequence"

    def rows(self, uid: str, since: int = 0) -> list[Row]:
        """A step's rows from index `since`."""
        if self._ctx is None:
            return []
        return [dict(r) for r in self._ctx.rows.get(uid, [])[since:]]

    async def start(self, seq: SequenceIn, rig: Rig, clock: Optional[Clock] = None) -> SequenceStatus:
        async with self._lock:
            if self.running():
                raise RuntimeError("A Test Sequence is already running")
            ctx = _Ctx(
                seq=seq, rig=rig, clock=clock or RealClock(), started_at=time.time(), bench=seq.bench,
                outcomes=[StepOutcome(uid=s.uid, planned=len(s.points)) for s in seq.steps],
            )
            ctx.ble = BleLink(
                rig, ctx.clock.now_ms, lambda s: ctx.clock.sleep(s), lambda m: self._note(ctx, m),
            )
            # RUNNING from here, not from inside the task, so a second start
            # arriving before the task runs is refused. Same race as the others.
            self._ctx = ctx
            ctx.task = asyncio.create_task(self._run(ctx))
            return self.status()

    async def cancel(self, reason: Optional[str] = None) -> SequenceStatus:
        ctx = self._ctx
        if ctx and ctx.state == RunState.RUNNING:
            if reason and ctx.cancel_reason is None:
                ctx.cancel_reason = reason
            ctx.cancel.set()
            # A run parked on a re-cable prompt must not sit there.
            self._answer(ctx, False)
            # Tell the DUT now rather than at the end of the point: abandoning
            # a point only ends our side of the conversation.
            ex = ctx.executor
            if ex is not None:
                try:
                    await ex.on_stop()
                except Exception as e:
                    log.warning("stop on cancel failed: %s", message(e))
        return self.status()

    def answer_prompt(self, seq: int, ok: bool) -> SequenceStatus:
        """The operator's reply to re-cable prompt `seq`. A stale reply -- to a
        prompt already answered from another tab -- is ignored."""
        ctx = self._ctx
        if ctx and ctx.prompt and ctx.prompt.seq == seq:
            self._answer(ctx, ok)
        return self.status()

    async def shutdown(self) -> None:
        """Stop a running sequence, and let it leave the rig idle, before the
        process releases the hardware under it."""
        ctx = self._ctx
        if ctx is None or ctx.state != RunState.RUNNING or ctx.task is None:
            return
        log.warning("Backend shutting down mid Test Sequence")
        await self.cancel("backend shut down mid-run")
        try:
            await asyncio.wait_for(asyncio.shield(ctx.task), _SHUTDOWN_GRACE_S)
        except Exception as e:
            log.warning("Test Sequence did not stop within %.0fs: %s", _SHUTDOWN_GRACE_S, e)

    # ---------- the run ----------

    def _note(self, ctx: _Ctx, msg: str, level: str = "info") -> None:
        ctx.note_seq += 1
        ctx.notes.append(Note(seq=ctx.note_seq, message=msg, level=level))
        del ctx.notes[:-_NOTES_KEPT]
        getattr(log, "warning" if level != "info" else "info")("sequence: %s", msg)

    @staticmethod
    def _answer(ctx: _Ctx, ok: bool) -> None:
        fut = ctx.prompt_answer
        if fut is not None and not fut.done():
            fut.set_result(ok)
        ctx.prompt = None
        ctx.prompt_answer = None

    async def _recable(self, ctx: _Ctx, step: StepIn) -> bool:
        """Wait for the operator to re-cable for `step`. Unbounded: it waits on
        a person, with the rig idle -- every step keys the DUT down at its end,
        so nothing transmits on the wrong cabling while it waits."""
        ctx.prompt_seq += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        ctx.prompt_answer = fut
        ctx.prompt = RecablePrompt(seq=ctx.prompt_seq, step_uid=step.uid, from_setup=ctx.bench, to_setup=step.setup)
        self._note(ctx, f"waiting to re-cable for {step.label}: "
                        f"{_SETUP_NAMES.get(ctx.bench or '', 'not known')} → {_SETUP_NAMES[step.setup]}")
        return await fut

    async def _run(self, ctx: _Ctx) -> None:
        final = RunState.DONE
        try:
            for i, step in enumerate(ctx.seq.steps):
                if ctx.cancel.is_set():
                    ctx.ended = "stopped"
                    break
                if step.setup != ctx.bench:
                    ok = await self._recable(ctx, step)
                    if ctx.cancel.is_set():
                        ctx.ended = "stopped"
                        break
                    if not ok:
                        ctx.ended = "declined"
                        self._note(ctx, "stopped at a re-cable prompt", "warn")
                        break
                    ctx.bench = step.setup
                await self._run_step(ctx, step, i)
                out = ctx.outcomes[i]
                if ctx.cancel.is_set():
                    ctx.ended = "stopped"
                    break
                if out.message:
                    ctx.ended = "error"
                    ctx.error = out.message
                    break
            if ctx.ended in ("stopped", "declined"):
                final = RunState.CANCELLED
                if ctx.cancel_reason:
                    ctx.error = ctx.cancel_reason
            elif ctx.ended == "error":
                final = RunState.ERROR
        except Exception as e:
            final = RunState.ERROR
            ctx.ended = "error"
            ctx.error = message(e)
            log.exception("Test Sequence failed")
        finally:
            self._answer(ctx, False)
            ctx.current = None
            ctx.executor = None
            await self._leave_idle(ctx)
            ctx.finished_at = time.time()
            # Published last, once the rig is idle: the page stops polling when
            # the run leaves RUNNING, and a new run must not start while this
            # one is still tearing down.
            ctx.state = final
            log.info("Test Sequence ended: %s", final.value)

    async def _run_step(self, ctx: _Ctx, step: StepIn, index: int) -> None:
        out = ctx.outcomes[index]
        out.verdict = "running"
        prefix = f"step {index + 1} · {step.label}"
        clock = ctx.clock
        sctx = StepCtx(
            rig=ctx.rig, step=step, path_loss=ctx.seq.path_loss, cancel=ctx.cancel,
            sleep=lambda s: clock.sleep(s, ctx.cancel), sleep_plain=lambda s: clock.sleep(s),
            now_ms=clock.now_ms, mono_ms=clock.mono_ms,
            note=lambda m, level="info": self._note(ctx, f"{prefix} · {m}", level),
            ble=ctx.ble,
        )
        ex = EXECUTORS[step.test](sctx)
        ctx.executor = ex
        ctx.used.add(PROTOCOL_OF[step.test])
        points = ex.points
        rows: list[Row] = []
        ctx.rows[step.uid] = rows
        ctx.current = Current(uid=step.uid, index=index, done=0, total=len(points))
        timeout = ex.step_timeout_s()
        t0 = clock.mono_ms()
        self._note(ctx, f"{prefix} — started, {len(points)} points")

        def tally() -> None:
            out.passed = sum(1 for r in rows if r.get("verdict") == "pass")
            out.failed = sum(1 for r in rows if r.get("verdict") == "fail")
            out.errors = sum(1 for r in rows if r.get("error"))
            out.measured = len(rows)

        try:
            await ex.before()
            for i, p in enumerate(points):
                if ctx.cancel.is_set():
                    break
                ctx.current = Current(uid=step.uid, index=index, done=i, total=len(points))
                # Deliberately untimed: it may wait on a reboot.
                await ex.before_item(p, i)
                if ctx.cancel.is_set():
                    break
                try:
                    row = await asyncio.wait_for(ex.measure(p), timeout)
                except asyncio.TimeoutError:
                    msg = f"point {i + 1} timed out after {timeout:.0f}s"
                    self._note(ctx, f"{prefix} · {msg}", "error")
                    row = {**ex.blank_row(p), "error": msg}
                # Stopped while this point was in flight: what came back is
                # partial, and recording it would read as a failed measurement
                # rather than the point the operator interrupted.
                if ctx.cancel.is_set():
                    break
                rows.append(row)
                tally()
        except Exception as e:
            out.message = f"step {index + 1} ({step.label}): {message(e)}"
            self._note(ctx, f"{prefix} — {message(e)}", "error")
        finally:
            try:
                await ex.after()
            except Exception as e:
                self._note(ctx, f"{prefix} · could not leave the DUT idle: {message(e)}", "error")
            ctx.executor = None

        tally()
        out.ms = round(clock.mono_ms() - t0)
        if out.message:
            out.verdict = "error"
        elif ctx.cancel.is_set() and out.measured < out.planned:
            out.verdict = "stopped"
            self._note(ctx, f"{prefix} — stopped after {out.measured}/{out.planned} points", "warn")
        else:
            out.verdict = _verdict(out.passed, out.failed, out.errors)
            self._note(ctx, f"{prefix} — finished, {out.measured}/{out.planned} points"
                            + (f", {out.errors} errors" if out.errors else ""),
                       "warn" if out.errors else "info")
        # Apart from the error count: a point that measured cleanly and missed
        # its limits is a result, not a fault.
        judged = out.passed + out.failed
        if judged:
            self._note(ctx, f"{prefix} · {out.passed}/{judged} points within limits",
                       "warn" if out.failed else "info")
        if sctx.uncalibrated:
            fl = ", ".join(_fmt_freq(step.test, f) for f in sorted(sctx.uncalibrated))
            self._note(ctx, f"{prefix} · path loss not calibrated at {fl} MHz — those points used the "
                            f"default {ctx.seq.path_loss.default_db:g} dB and their measured power is only as "
                            "good as that figure.", "warn")

    async def _leave_idle(self, ctx: _Ctx) -> None:
        """Switch off what the run started, however it ended. Each part on its
        own: one that fails does not keep the others on."""
        done: list[str] = []
        if "LoRa" in ctx.used:
            try:
                await ctx.rig.stop()
                done.append("LoRa TX off")
            except Exception as e:
                self._note(ctx, f"LoRa stop at the end failed: {message(e)}", "error")
        if "LTE" in ctx.used:
            # The pages leave the modem on for the operator's next Send; a
            # sequence's end is the end of the bench's use.
            try:
                await ctx.rig.lte_modem_off()
                done.append("LTE modem off")
            except Exception as e:
                self._note(ctx, f"LTE modem off at the end failed: {message(e)}", "error")
        if "BLE" in ctx.used and ctx.ble is not None:
            try:
                await ctx.ble.finish_tone()
                done.append("BLE back on the link")
            except Exception as e:
                self._note(ctx, f"BLE did not come back at the end: {message(e)}", "error")
        if done:
            self._note(ctx, f"rig left idle: {', '.join(done)}")


runner = SequenceRunner()
