"""Load Pull run engine.

Walks the plan the page sends -- trombone position, then each frequency and
power there, with the attenuator as the outermost axis -- exactly as the
browser loop did, so a run measures the same points in the same order:

    per position:  move the trombone; switch to the VNA and read each frequency
                   on its own zoomed span; switch to the PCB
    per point:     key the DUT, settle, read power and current, key it down
    per att step:  park on the VNA and wait for the operator to set it

It lives here because the browser loop died with its tab: twice at ~890 points
of an attenuator sweep, Chrome killed the page and the run stopped mid-point
with the DUT left keyed. A tab can crash, reload or close now and the run goes
on; the page re-attaches by polling `status`.

Hardware is behind `Rig`, so the loop is testable without any. The live rig
(api/loadpull.py) calls the same functions the motor, servo, VNA, measure and
device routes do, through the same buses and locks.

One run at a time, tracked by the module-level `runner`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, Protocol

from ..sweep.models import RunState
from .models import (
    PULSES_PER_MM, AttPrompt, LoadPullRow, LoadPullRunConfig, LoadPullStatus, PlanPoint,
)

log = logging.getLogger(__name__)

#: Consecutive points whose TX command raised before the run gives up -- the
#: DUT link is gone, and every remaining point would fail in milliseconds.
#: Same rule and figure as the sweep (_LINK_FAIL_LIMIT there).
_LINK_FAIL_LIMIT = 3

#: Budget for one point around its settle delays: a full-travel trombone move,
#: two switch moves, a VNA read per frequency, the TX command and the reads.
#: Same figures the browser loop used (STEP_OVERHEAD_TIMEOUT_MS, VNA_READ_TIMEOUT_MS).
_STEP_OVERHEAD_S = 90.0
_VNA_READ_S = 10.0

#: How long shutdown waits for the run to stop and key the DUT down before the
#: BLE link is released under it. See TestRunner.shutdown in sweep/runner.py.
_SHUTDOWN_GRACE_S = 15.0

# Log the first few points, then every 50th.
_LOG_HEAD = 3
_LOG_EVERY = 50


class TxResult(Protocol):
    ok: bool
    status: int


class Rig(Protocol):
    """Everything the run touches. Methods raise on failure."""

    async def move(self, pos: int) -> None: ...
    #: The motor's soft travel limits, in pulses.
    async def travel_limits(self, lo: int, hi: int) -> None: ...
    async def wait_motor_idle(self, cancel: asyncio.Event) -> None: ...
    async def motor_stop(self) -> None: ...
    async def switch(self, target: str) -> None: ...
    async def vna_span(self, start_hz: int, stop_hz: int) -> None: ...
    #: The marker at `hz`: a dict with r_ohm, x_ohm, s11_mag_db, or None.
    async def vna_read(self, hz: int) -> Optional[dict]: ...
    async def tx_on(self, config: LoadPullRunConfig, point: PlanPoint) -> TxResult: ...
    async def tx_off(self, config: LoadPullRunConfig, point: PlanPoint) -> None: ...
    #: (raw power dBm, current A, error) -- a partial reading is still a reading.
    async def measure(self, hz: int) -> tuple[Optional[float], Optional[float], Optional[str]]: ...
    async def modem_cycle(self) -> None: ...
    async def end_run(self, config: LoadPullRunConfig) -> None: ...


@dataclass
class _Ctx:
    config: LoadPullRunConfig
    rig: Rig
    state: RunState = RunState.RUNNING
    rows: list[LoadPullRow] = field(default_factory=list)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    phase: Optional[str] = None
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_reason: Optional[str] = None
    task: Optional[asyncio.Task] = None
    prompt: Optional[AttPrompt] = None
    prompt_answer: Optional[asyncio.Future] = None
    prompt_seq: int = 0
    tx_failures: int = 0
    #: Plan points jumped over by the operator (see `_run`).
    skipped: int = 0
    #: Where the trombone is parked, so later points there skip the move.
    pos: Optional[int] = None
    #: The VNA markers read at `pos`, by requested frequency (Hz).
    markers: dict[int, dict] = field(default_factory=dict)


def _hz(mhz: float) -> int:
    return round(mhz * 1_000_000)


def _message(e: BaseException) -> str:
    # A route function raised through `handle_driver_errors` carries its text
    # in `detail`; anything else is named by type.
    detail = getattr(e, "detail", None)
    return str(detail) if detail else f"{type(e).__name__}: {e}"


class LoadPullRunner:
    def __init__(self) -> None:
        self._ctx: Optional[_Ctx] = None
        self._lock = asyncio.Lock()

    # ---------- what the routes call ----------

    def status(self) -> LoadPullStatus:
        ctx = self._ctx
        if ctx is None:
            return LoadPullStatus(state=RunState.IDLE)
        c = ctx.config
        return LoadPullStatus(
            state=ctx.state,
            radio=c.radio,
            completed=c.start_index + len(ctx.rows) + ctx.skipped,
            total=len(c.points),
            start_index=c.start_index,
            rows=len(ctx.rows),
            skipped=ctx.skipped,
            errors=sum(1 for r in ctx.rows if r.error),
            phase=ctx.phase if ctx.state == RunState.RUNNING else None,
            att_prompt=ctx.prompt,
            started_at=ctx.started_at,
            finished_at=ctx.finished_at,
            error=ctx.error,
            plan_key=c.plan_key,
        )

    def rows(self, since: int = 0) -> list[LoadPullRow]:
        """This run's rows from index `since` (0 = the first point it measured)."""
        return list(self._ctx.rows[since:]) if self._ctx else []

    async def start(self, config: LoadPullRunConfig, rig: Rig) -> LoadPullStatus:
        async with self._lock:
            if self._ctx and self._ctx.state == RunState.RUNNING:
                raise RuntimeError("A Load Pull run is already in progress")
            ctx = _Ctx(config=config, rig=rig, started_at=time.time())
            # RUNNING from here, not from inside the task, so a second start
            # arriving before the task runs is refused. Same race as the sweep.
            self._ctx = ctx
            ctx.task = asyncio.create_task(self._run(ctx))
            return self.status()

    async def cancel(self, reason: Optional[str] = None) -> LoadPullStatus:
        ctx = self._ctx
        if ctx and ctx.state == RunState.RUNNING:
            if reason and ctx.cancel_reason is None:
                ctx.cancel_reason = reason
            ctx.cancel.set()
            # A run parked on the attenuator prompt must not sit there.
            self._answer(ctx, False)
            # Stop the carriage now rather than at the end of its move: Stop
            # always halted the motor too.
            try:
                await ctx.rig.motor_stop()
            except Exception as e:
                log.warning("motor stop on cancel failed: %s", _message(e))
        return self.status()

    def answer_prompt(self, seq: int, proceed: bool, att_db: Optional[float] = None) -> LoadPullStatus:
        """The operator's reply to attenuator prompt `seq`, with the setting
        dialled in when it is not the one asked for. A stale reply -- to a
        prompt already answered from another tab -- is ignored."""
        ctx = self._ctx
        if ctx and ctx.prompt and ctx.prompt.seq == seq:
            self._answer(ctx, proceed, att_db)
        return self.status()

    def clear(self) -> LoadPullStatus:
        if self._ctx and self._ctx.state == RunState.RUNNING:
            raise RuntimeError("stop the Load Pull run before clearing it")
        self._ctx = None
        return self.status()

    async def shutdown(self) -> None:
        """Stop a running run, and let it key the DUT down, before the process
        releases the hardware under it."""
        ctx = self._ctx
        if ctx is None or ctx.state != RunState.RUNNING or ctx.task is None:
            return
        log.warning("Backend shutting down mid Load Pull at point %d", ctx.config.start_index + len(ctx.rows))
        await self.cancel("backend shut down mid-run")
        try:
            await asyncio.wait_for(asyncio.shield(ctx.task), _SHUTDOWN_GRACE_S)
        except Exception as e:
            log.warning("Load Pull did not stop within %.0fs: %s", _SHUTDOWN_GRACE_S, e)

    # ---------- the loop ----------

    @staticmethod
    def _answer(ctx: _Ctx, proceed: bool, att_db: Optional[float] = None) -> None:
        fut = ctx.prompt_answer
        if fut is not None and not fut.done():
            fut.set_result((proceed, att_db))
        ctx.prompt = None
        ctx.prompt_answer = None

    async def _sleep(self, ctx: _Ctx, seconds: float) -> None:
        """A settle that Stop cuts short."""
        try:
            await asyncio.wait_for(ctx.cancel.wait(), seconds)
        except asyncio.TimeoutError:
            pass

    async def _ask_att(
        self, ctx: _Ctx, db: float, cycle: int, cycles: int, upcoming: list[float],
    ) -> tuple[bool, Optional[float]]:
        """Wait for the operator: whether to go on, and the setting dialled in
        if it is not `db`."""
        # Park the switch on the VNA first: the DUT is not transmitting between
        # cycles, so the analyzer is the only way to watch the attenuator take
        # effect while it is dialled in. Non-fatal -- it can be set blind, and
        # the next point re-routes the switch itself.
        try:
            await ctx.rig.switch("VNA")
        except Exception as e:
            log.warning("could not park the switch on VNA: %s", _message(e))
        ctx.prompt_seq += 1
        ctx.prompt = AttPrompt(seq=ctx.prompt_seq, db=db, cycle=cycle, cycles=cycles, upcoming=upcoming)
        ctx.prompt_answer = asyncio.get_running_loop().create_future()
        ctx.phase = "attenuator"
        fut = ctx.prompt_answer
        # Unbounded by nature: it waits for a person. Outside any step budget.
        proceed, att_db = await fut
        return bool(proceed), att_db

    async def _run(self, ctx: _Ctx) -> None:
        c = ctx.config
        final = RunState.DONE
        freqs = list(dict.fromkeys(p.freq_mhz for p in c.points))
        att_steps = list(dict.fromkeys(p.att_db for p in c.points if p.att_db is not None))
        loss = {round(pl.freq_mhz, 6): pl.db for pl in c.path_loss}
        step_timeout = (
            c.settle_ms / 1000.0 * (len(freqs) + 2)
            + len(freqs) * _VNA_READ_S + _STEP_OVERHEAD_S
        )
        # The planned setting of the cycle under way, and what was dialled in
        # for it when the operator chose another (None: as planned).
        att_plan: Optional[float] = None
        att_override: Optional[float] = None
        log.info(
            "Load Pull (%s) started: points %d-%d of %d",
            c.radio, c.start_index + 1, len(c.points), len(c.points),
        )
        try:
            # The motor's soft limits are one pair shared by both Load Pull
            # pages, each of which sets its own ends when on screen; another
            # page's left in place refused this plan's positions past them.
            # So the run sets them from its own plan, the whole of it, which
            # a Continue needs as much as a fresh start.
            positions = [p.pos for p in c.points]
            await ctx.rig.travel_limits(min(positions), max(positions))

            # Once per run, as on the LTE CW sweep: down and up again, so the
            # run starts from a known modem. One that will not come up fails
            # the run here, before the trombone has moved.
            if c.radio == "LTE":
                ctx.phase = "modem"
                await ctx.rig.modem_cycle()

            i = c.start_index
            while i < len(c.points):
                if ctx.cancel.is_set():
                    break
                p = c.points[i]
                if p.att_db is not None and att_plan != p.att_db:
                    k = att_steps.index(p.att_db)
                    ok, chosen = await self._ask_att(ctx, p.att_db, k, len(att_steps), att_steps[k + 1:])
                    if not ok or ctx.cancel.is_set():
                        ctx.cancel.set()
                        break
                    att_plan, att_override = p.att_db, None
                    if chosen is not None and chosen != p.att_db:
                        if chosen in att_steps[k + 1:]:
                            # A later setting of the sweep: jump to its cycle.
                            # Attenuation is the outermost axis, so the cycles
                            # in between are one run of points, passed over
                            # and never measured.
                            j = next(n for n in range(i, len(c.points)) if c.points[n].att_db == chosen)
                            ctx.skipped += j - i
                            log.info("attenuator jumped %s -> %s dB: %d points skipped", p.att_db, chosen, j - i)
                            i, p, att_plan = j, c.points[j], chosen
                        else:
                            # Off the plan (or an earlier setting): this cycle
                            # runs at it, recorded as what it was, and the plan
                            # carries on after it.
                            att_override = chosen
                            log.info("attenuator set to %s dB for the %s dB cycle", chosen, p.att_db)
                    # Forget where the trombone is, so the new cycle drives it
                    # back to the start rather than assuming it is there.
                    ctx.pos = None
                if att_override is not None:
                    p = p.model_copy(update={"att_db": att_override})
                try:
                    row = await asyncio.wait_for(self._point(ctx, p, freqs, loss), step_timeout)
                except asyncio.TimeoutError:
                    row = self._blank(p)
                    row.error = f"point timed out after {step_timeout:.0f}s"
                    await self._tx_off(ctx, p)
                # Stopped while this point was in flight: what came back is
                # partial, and recording it would read as a failed measurement
                # rather than the point the operator interrupted. Continue
                # measures it again.
                if ctx.cancel.is_set():
                    break
                ctx.rows.append(row)
                n = c.start_index + len(ctx.rows) + ctx.skipped
                if len(ctx.rows) <= _LOG_HEAD or n % _LOG_EVERY == 0:
                    log.info("Load Pull point %d/%d%s", n, len(c.points), f": {row.error}" if row.error else "")
                if ctx.tx_failures >= _LINK_FAIL_LIMIT:
                    raise RuntimeError(
                        f"DUT not answering: {_LINK_FAIL_LIMIT} commands failed in a row, last: {row.error}"
                    )
                i += 1
            if ctx.cancel.is_set():
                final = RunState.CANCELLED
                ctx.error = ctx.cancel_reason
        except Exception as e:
            final = RunState.ERROR
            ctx.error = _message(e)
            log.exception("Load Pull failed")
        finally:
            ctx.phase = None
            self._answer(ctx, False)
            try:
                await ctx.rig.end_run(c)
            except Exception as e:
                log.warning("Load Pull teardown failed: %s", _message(e))
            ctx.finished_at = time.time()
            # Published last, once the DUT is keyed down: the page stops
            # polling when the run leaves RUNNING, and a new run must not start
            # while this one is still tearing down.
            ctx.state = final
            log.info("Load Pull ended: %s, %d rows", final.value, len(ctx.rows))

    @staticmethod
    def _blank(p: PlanPoint) -> LoadPullRow:
        return LoadPullRow(
            pos_pulses=p.pos,
            pos_mm=p.pos / PULSES_PER_MM,
            freq_mhz=p.freq_mhz,
            earfcn=p.earfcn,
            power_dbm_setting=p.power_dbm,
            att_db=p.att_db,
        )

    async def _tx_off(self, ctx: _Ctx, p: PlanPoint) -> None:
        try:
            await ctx.rig.tx_off(ctx.config, p)
        except Exception as e:
            log.warning("TX off failed: %s", _message(e))

    async def _point(
        self, ctx: _Ctx, p: PlanPoint, freqs: list[float], loss: dict[float, float],
    ) -> LoadPullRow:
        """One plan point. Never raises: failures land on the row.

        The trombone moves, and the VNA is read, only when the position changes
        -- both are the slow parts, and repeating them per (frequency, power)
        would multiply a run by the electrical sweep for nothing new.
        """
        c = ctx.config
        rig = ctx.rig
        settle = c.settle_ms / 1000.0
        row = self._blank(p)
        hz = _hz(p.freq_mhz)
        try:
            if ctx.pos != p.pos:
                ctx.phase = "moving"
                await rig.move(p.pos)
                await rig.wait_motor_idle(ctx.cancel)
                if ctx.cancel.is_set():
                    return row
                # Each frequency on its own zoomed span. The settle after each
                # span change lets a fresh sweep land -- the analyzer free-runs
                # and a read takes its latest trace -- and the first one also
                # covers the switch settling.
                ctx.phase = "vna"
                await rig.switch("VNA")
                markers: dict[int, dict] = {}
                for f in freqs:
                    fhz = _hz(f)
                    half = round(fhz * c.vna_half_span_frac)
                    await rig.vna_span(fhz - half, fhz + half)
                    await self._sleep(ctx, settle)
                    if ctx.cancel.is_set():
                        return row
                    mk = await rig.vna_read(fhz)
                    if mk is not None:
                        markers[fhz] = mk
                ctx.markers = markers
                if not markers:
                    log.warning("no VNA markers at %.2f mm", p.pos / PULSES_PER_MM)
                await rig.switch("PCB")
                await self._sleep(ctx, settle)
                if ctx.cancel.is_set():
                    return row
                ctx.pos = p.pos

            mk = ctx.markers.get(hz)
            if mk:
                row.r_ohm = mk.get("r_ohm")
                row.x_ohm = mk.get("x_ohm")
                row.s11_db = mk.get("s11_mag_db")

            ctx.phase = "measuring"
            try:
                tx = await rig.tx_on(c, p)
            except Exception:
                ctx.tx_failures += 1
                raise
            ctx.tx_failures = 0
            if not tx.ok:
                row.error = f"tx status={tx.status}"
            else:
                await self._sleep(ctx, settle)
                if ctx.cancel.is_set():
                    await self._tx_off(ctx, p)
                    return row
                raw, current, err = await rig.measure(hz)
                # Both: the corrected figure is what the run measures, the raw
                # one says how near the edge of its range the sensor was.
                row.power_dbm_raw = raw
                row.power_dbm = None if raw is None else raw + loss.get(round(p.freq_mhz, 6), 0.0)
                row.current_a = current
                if err:
                    row.error = err
            await self._tx_off(ctx, p)
        except Exception as e:
            if not ctx.cancel.is_set():
                row.error = _message(e)
            await self._tx_off(ctx, p)
        return row


runner = LoadPullRunner()
