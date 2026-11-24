"""The five sweeps and frequency accuracy, one point at a time: line-for-line ports of each test's
`createRun` in `frontend/src/tests/<id>/sweepTest.ts`.

Each executor knows its points, the row a point produces, and the commands
around it. The loop that walks the points -- order, timeouts, Stop -- is the
runner's (runner.py `_run_points`), as `runSequence` was the browser's.

`measure` never raises: a failure lands in the row, and the DUT is keyed down
in `finally` whatever happened, so a bad point cannot leave it transmitting
into the next one.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from .ble_link import BleLink
from ..freqacc.zoom import ref_level_for, sweep_timeout_s
from .judge import (
    AUTO_TONE_MAX_S, auto_tone_seconds, find_loss, off_air_reason, point_verdict, verdict_of,
    verdict_within_margin,
)
from .models import (
    BlePoint, FreqPoint, FreqSettings, LoraCwPoint, LoraModPoint, LteCwPoint, LteModPoint, PathLoss, StepIn,
)
from .rig import Rig

Row = dict[str, Any]

#: Budget for the commands and reads either side of the settle delay.
#: LoRa as automationLayout.ts STEP_OVERHEAD_TIMEOUT_MS; LTE sends two frames a
#: point and has its own (LteAutomationPanel STEP_OVERHEAD_TIMEOUT_MS).
LORA_OVERHEAD_S = 30.0
LTE_OVERHEAD_S = 40.0
#: BLE: a tone, its grace, a relink and two reads (bleCw/plan.ts stepBudgetMs).
_BLE_RELINK_S = 30.0
_BLE_MEASURE_HEADROOM_S = 15.0


def message(e: BaseException) -> str:
    """An exception as a row's error: a route function's `detail`, else its text."""
    detail = getattr(e, "detail", None)
    if detail:
        return str(detail)
    return str(e) or type(e).__name__


@dataclass
class StepCtx:
    rig: Rig
    step: StepIn
    path_loss: PathLoss
    cancel: asyncio.Event
    #: A settle Stop cuts short.
    sleep: Callable[[float], Awaitable[None]]
    #: A wait nothing cuts short (a tone on air).
    sleep_plain: Callable[[float], Awaitable[None]]
    #: Epoch ms (BLE tone timing) and a monotonic clock in ms (read timing).
    now_ms: Callable[[], float]
    mono_ms: Callable[[], float]
    note: Callable[..., None]
    ble: BleLink
    #: Frequencies (MHz) read with no path-loss row, for one note at the end.
    uncalibrated: set[float] = field(default_factory=set)

    def loss(self, freq_mhz: float) -> float:
        db, calibrated = find_loss(self.path_loss, freq_mhz)
        if not calibrated:
            self.uncalibrated.add(freq_mhz)
        return db

    def expected_loss(self, freq_mhz: float) -> float:
        """The loss for ranging the analyzer -- looked up without counting it
        as a reading made at an uncalibrated frequency."""
        return find_loss(self.path_loss, freq_mhz)[0]

    @property
    def settle_s(self) -> float:
        return self.step.settle_ms / 1000


class Executor:
    """One test's points and what a run of them does to the rig."""

    def __init__(self, ctx: StepCtx) -> None:
        self.ctx = ctx

    @property
    def points(self) -> list[Any]:
        raise NotImplementedError

    def step_timeout_s(self) -> float:
        raise NotImplementedError

    def blank_row(self, p: Any) -> Row:
        raise NotImplementedError

    def freq_mhz(self, p: Any) -> float:
        return p.freq_mhz

    async def before(self) -> None:
        """Once, before the first point (outside the step timeout)."""

    async def before_item(self, p: Any, i: int) -> None:
        """Before each point, outside its timeout: work that waits on the DUT
        rebooting may take as long as it takes."""

    async def measure(self, p: Any) -> Row:
        raise NotImplementedError

    async def after(self) -> None:
        """Leaves the DUT idle at the end of the step, however it ended."""

    async def on_stop(self) -> None:
        """Called at once on Stop: tell the DUT, since abandoning a point only
        ends our side of the conversation."""


def _reading_into(row: Row, m: Any, raw_key: str = "measured_dbm_raw") -> None:
    row[raw_key] = m.power_dbm
    row["current_a"] = m.current_a
    row["voltage_v"] = m.voltage_v


# ---------------------------------------------------------------- LoRa


class _LoraBase(Executor):
    def step_timeout_s(self) -> float:
        return self.ctx.settle_s + LORA_OVERHEAD_S

    async def _tx(self, p: Any):
        raise NotImplementedError

    async def measure(self, p: Any) -> Row:
        """TX on at this point -> settle -> read power/CC -> TX off.

        Off after every point rather than left transmitting into the next,
        so each reading starts from the same state.
        """
        ctx = self.ctx
        row = self.blank_row(p)
        if ctx.cancel.is_set():
            return row
        try:
            tx = await self._tx(p)
            row["ok"] = tx.ok
            row["status"] = tx.status
            if not tx.ok:
                row["error"] = f"tx status={tx.status}"
            else:
                await ctx.sleep(ctx.settle_s)
                if ctx.cancel.is_set():
                    return row
                # The analyzer is ranged to the power as it arrives after the
                # cable; the sensor ignores it.
                m = await ctx.rig.measure(
                    round(p.freq_mhz * 1_000_000), ctx.step.power, p.power_dbm - ctx.expected_loss(p.freq_mhz),
                )
                _reading_into(row, m)
                # Per point: a run sweeps frequencies, so one figure would be
                # right for at most one of them.
                loss = ctx.loss(p.freq_mhz)
                row["measured_dbm"] = None if m.power_dbm is None else m.power_dbm + loss
                # Judged on the corrected power against what was asked for.
                row["verdict"] = verdict_within_margin(row["measured_dbm"], p.power_dbm, p.margin_db)
                if m.error:
                    row["error"] = m.error
        except Exception as e:
            # A cancelled request is the operator stopping, not a fault.
            row["error"] = None if ctx.cancel.is_set() else message(e)
        finally:
            try:
                await ctx.rig.stop()
            except Exception:
                pass  # reported by the end-of-run stop
        return row

    async def after(self) -> None:
        try:
            await self.ctx.rig.stop()
        except Exception:
            pass

    async def on_stop(self) -> None:
        try:
            await self.ctx.rig.stop()
        except Exception as e:
            self.ctx.note(f"stop failed: {message(e)}", "error")


class LoraCw(_LoraBase):
    @property
    def points(self) -> list[LoraCwPoint]:
        return [LoraCwPoint(**p) for p in self.ctx.step.points]

    def blank_row(self, p: LoraCwPoint) -> Row:
        return {
            "freq_mhz": p.freq_mhz, "set_power_dbm": p.power_dbm, "pa_mode": p.pa_mode,
            "measured_dbm": None, "measured_dbm_raw": None, "current_a": None, "voltage_v": None,
            "margin_db": p.margin_db, "verdict": None, "ok": False, "status": None, "error": None,
        }

    async def _tx(self, p: LoraCwPoint):
        return await self.ctx.rig.lora_power(round(p.freq_mhz * 1_000_000), p.power_dbm, p.pa_mode)


class LoraModulated(_LoraBase):
    @property
    def points(self) -> list[LoraModPoint]:
        return [LoraModPoint(**p) for p in self.ctx.step.points]

    def blank_row(self, p: LoraModPoint) -> Row:
        return {
            "freq_mhz": p.freq_mhz, "set_power_dbm": p.power_dbm,
            "modem": p.modem, "bandwidth": p.bandwidth, "datarate": p.datarate,
            "measured_dbm": None, "measured_dbm_raw": None, "current_a": None, "voltage_v": None,
            "margin_db": p.margin_db, "verdict": None, "ok": False, "status": None, "error": None,
        }

    async def _tx(self, p: LoraModPoint):
        return await self.ctx.rig.lora_modulated(
            p.bandwidth, round(p.freq_mhz * 1_000_000), p.power_dbm, p.modem, p.datarate,
        )


# ---------------------------------------------------------------- LTE


class _LteBase(Executor):
    def __init__(self, ctx: StepCtx) -> None:
        super().__init__(ctx)
        #: The point keyed and not yet aborted, for Stop and the step's end.
        self._live: Optional[Any] = None

    def step_timeout_s(self) -> float:
        return self.ctx.settle_s + LTE_OVERHEAD_S

    async def _test(self, p: Any, start: bool):
        raise NotImplementedError

    async def before(self) -> None:
        # Once for the whole run: the boot is ~10 s. Cycling rather than
        # skipping when the modem looks up means the sweep starts from a modem
        # in a known state, with nothing left running on it.
        self.ctx.note("restarting the modem")
        try:
            await self.ctx.rig.lte_modem_off()
        except Exception as e:
            # Most likely already down, which is where this was going.
            self.ctx.note(f"LTE modem off (run start) failed: {message(e)}", "warn")
        r = await self.ctx.rig.lte_modem_on()
        if not r.ok:
            raise RuntimeError(f"modem on rejected (status {r.status})")

    async def measure(self, p: Any) -> Row:
        """Test on -> settle -> read power/CC -> abort.

        The abort is not tidiness: the modem takes one test at a time and
        drops a START that arrives while another runs, so without it every
        later point would silently measure this one's channel.
        """
        ctx = self.ctx
        row = self.blank_row(p)
        if ctx.cancel.is_set():
            return row
        try:
            tx = await self._test(p, True)
            row["ok"] = tx.ok
            row["status"] = tx.status
            if not tx.ok:
                row["error"] = f"tx status={tx.status}"
            else:
                self._live = p
                await ctx.sleep(ctx.settle_s)
                if ctx.cancel.is_set():
                    return row
                m = await ctx.rig.measure(
                    round(p.freq_mhz * 1e6), ctx.step.power, p.power_dbm - ctx.expected_loss(p.freq_mhz),
                )
                _reading_into(row, m)
                loss = ctx.loss(p.freq_mhz)
                row["measured_dbm"] = None if m.power_dbm is None else m.power_dbm + loss
                row["verdict"] = verdict_within_margin(row["measured_dbm"], p.power_dbm, p.margin_db)
                if m.error:
                    row["error"] = m.error
        except Exception as e:
            row["error"] = None if ctx.cancel.is_set() else message(e)
        finally:
            try:
                await self._test(p, False)
                self._live = None
            except Exception:
                pass  # reported by the end-of-run abort
        return row

    async def _abort_live(self) -> None:
        live = self._live
        if live is None:
            return
        try:
            await self._test(live, False)
        except Exception as e:
            self.ctx.note(f"abort failed: {message(e)}", "error")
        self._live = None

    async def after(self) -> None:
        await self._abort_live()

    async def on_stop(self) -> None:
        await self._abort_live()


class LteCw(_LteBase):
    @property
    def points(self) -> list[LteCwPoint]:
        return [LteCwPoint(**p) for p in self.ctx.step.points]

    def blank_row(self, p: LteCwPoint) -> Row:
        return {
            "earfcn": p.earfcn, "band": p.band, "freq_mhz": p.freq_mhz, "set_power_dbm": p.power_dbm,
            "measured_dbm": None, "measured_dbm_raw": None, "current_a": None, "voltage_v": None,
            "margin_db": p.margin_db, "verdict": None, "ok": False, "status": None, "error": None,
        }

    async def _test(self, p: LteCwPoint, start: bool):
        return await self.ctx.rig.lte_cw(p.earfcn, p.power_dbm, start)


class LteModulated(_LteBase):
    @property
    def points(self) -> list[LteModPoint]:
        return [LteModPoint(**p) for p in self.ctx.step.points]

    def blank_row(self, p: LteModPoint) -> Row:
        return {
            "earfcn": p.earfcn, "band": p.band, "freq_mhz": p.freq_mhz, "set_power_dbm": p.power_dbm,
            "bandwidth": p.bandwidth, "mcs": p.mcs, "rb_count": p.rb_count,
            "measured_dbm": None, "measured_dbm_raw": None, "current_a": None, "voltage_v": None,
            "margin_db": p.margin_db, "verdict": None, "ok": False, "status": None, "error": None,
        }

    async def _test(self, p: LteModPoint, start: bool):
        return await self.ctx.rig.lte_modulated(p.earfcn, p.power_dbm, p.bandwidth, p.mcs, p.rb_count, start)


# ---------------------------------------------------------------- BLE


class BleCw(Executor):
    def __init__(self, ctx: StepCtx) -> None:
        super().__init__(ctx)
        #: Set by a point whose DUT did not come back; the next point ends the run.
        self._lost: Optional[str] = None
        #: Longest time yet, from a tone's start being sent to its reading
        #: finishing -- what an auto tone is sized from.
        self._slowest_window: Optional[float] = None
        #: The auto tone last used, so a change is noted once.
        self._last_auto: Optional[int] = None
        self._plan = self.points

    @property
    def points(self) -> list[BlePoint]:
        return [BlePoint(**p) for p in self.ctx.step.points]

    def step_timeout_s(self) -> float:
        tone = AUTO_TONE_MAX_S if self.ctx.step.tone_s is None else self.ctx.step.tone_s
        return tone + 0.2 + _BLE_RELINK_S + _BLE_MEASURE_HEADROOM_S

    def blank_row(self, p: BlePoint) -> Row:
        return {
            "channel": p.channel, "freq_mhz": p.freq_mhz, "power_param": p.power,
            "measured_dbm": None, "measured_dbm_raw": None, "current_a": None, "voltage_v": None,
            "min_dbm": p.min_dbm, "max_dbm": p.max_dbm, "verdict": None,
            "status": None, "ok": False, "error": None,
        }

    async def before_item(self, p: BlePoint, i: int) -> None:
        # A DUT that did not come back from the last point ends the run here,
        # rather than failing every point after it in milliseconds.
        if self._lost:
            raise RuntimeError(self._lost)
        prev = self._plan[i - 1].power if i > 0 else None
        if prev == p.power:
            return
        self.ctx.note(f"tone power {p.power} — resetting the DUT")
        # The first power is set even if the DUT may be on it: a run starts
        # from a power it set itself, as the LTE run power-cycles its modem.
        if i == 0:
            await self.ctx.ble.set_power(p.power)
        else:
            await self.ctx.ble.ensure_power(p.power)

    async def measure(self, p: BlePoint) -> Row:
        """Tone on -> settle -> read power/CC -> wait out the tone -> relink."""
        ctx = self.ctx
        row = self.blank_row(p)
        if ctx.cancel.is_set():
            return row
        started = False
        auto = ctx.step.tone_s is None
        tone_s = auto_tone_seconds(self._slowest_window) if auto else ctx.step.tone_s
        if auto and tone_s != self._last_auto:
            w = self._slowest_window
            ctx.note(
                f"auto tone: {tone_s} s for the first point, until a reading has been timed" if w is None
                else f"auto tone: {tone_s} s per point (slowest reading finished {w / 1000:.1f} s into its tone)"
            )
            self._last_auto = tone_s
        try:
            r = await ctx.ble.tone(p.channel, tone_s)
            started = True
            # Unanswered is the expected shape: the link goes with the tone.
            row["status"] = r.status if r.acknowledged else None
            await ctx.sleep(ctx.settle_s)
            if ctx.cancel.is_set():
                return row
            loss = ctx.loss(p.freq_mhz)
            read_start = ctx.mono_ms()
            m = await ctx.rig.measure(round(p.freq_mhz * 1e6), ctx.step.power, None)
            read_ms = ctx.mono_ms() - read_start
            _reading_into(row, m)
            row["measured_dbm"] = None if m.power_dbm is None else m.power_dbm + loss
            row["verdict"] = verdict_of(row["measured_dbm"], p.min_dbm, p.max_dbm)
            row["ok"] = not m.error
            if m.error:
                row["error"] = m.error
            # A late read keeps its numbers, so it can be seen for what it
            # was, but is not judged or counted as measured.
            read_end = ctx.now_ms()
            until = ctx.ble.until_ms
            off_air = off_air_reason(read_end, until, read_ms)
            if off_air:
                row["ok"] = False
                row["verdict"] = None
                row["error"] = f"{off_air}; {m.error}" if m.error else off_air
            # From when the start went out: everything the tone has to outlast.
            if until is not None:
                span = read_end - (until - tone_s * 1000)
                self._slowest_window = max(self._slowest_window or 0, span)
        except Exception as e:
            row["error"] = None if ctx.cancel.is_set() else message(e)
        finally:
            if started:
                try:
                    await ctx.ble.finish_tone()
                except Exception as e:
                    lost = f"DUT did not come back after the tone: {message(e)}"
                    self._lost = lost
                    row["ok"] = False
                    if not row["error"]:
                        row["error"] = lost
        return row

    async def after(self) -> None:
        # A tone left on air -- a point abandoned by its timeout -- is waited
        # out, so the step ends with the DUT back on the link.
        await self.ctx.ble.finish_tone()

    async def on_stop(self) -> None:
        until = self.ctx.ble.until_ms
        if until is not None:
            left = max(0, round((until - self.ctx.now_ms()) / 1000 + 0.499))
            self.ctx.note(
                f"stopping — the tone on air cannot be cut short; reconnecting when it ends in {left} s", "warn",
            )


# ---------------------------------------------------------------- Frequency accuracy


class _FreqAccuracy(Executor):
    """Key a CW carrier, zoom the analyzer in on it stage by stage, judge its
    error in ppm, key it down. As backend/api/freq_accuracy.py runs a plan
    from its own page, through the same zoom (freqacc/zoom.py) on the same
    analyzer bus; the page's run and a step's are one at a time between them.

    LoRa keys LoRa power, LTE the LTE CW test held for minutes (a 10 Hz RBW
    sweep alone runs tens of seconds), aborted once the point is measured.
    """

    lte = False

    def __init__(self, ctx: StepCtx) -> None:
        super().__init__(ctx)
        #: The point keyed and not yet keyed down, for Stop and the step's end.
        self._live: Optional[FreqPoint] = None

    @property
    def settings(self) -> FreqSettings:
        f = self.ctx.step.freq
        if f is None:
            raise RuntimeError("no zoom stages for this frequency accuracy step")
        return f

    @property
    def points(self) -> list[FreqPoint]:
        return [FreqPoint(**p) for p in self.ctx.step.points]

    def _stage_limits(self) -> list[Optional[float]]:
        f = self.settings
        return [f.stage_limits_ppm[i] if i < len(f.stage_limits_ppm) else None for i in range(len(f.stages))]

    def step_timeout_s(self) -> float:
        # Each stage: its settle, then a sweep as long as its span and RBW
        # make it, with the margin the page's run allows a stage.
        per = sum(self.ctx.settle_s + sweep_timeout_s(st.span_hz, st.rbw_hz) + 15.0 for st in self.settings.stages)
        return per + (LTE_OVERHEAD_S if self.lte else LORA_OVERHEAD_S)

    def blank_row(self, p: FreqPoint) -> Row:
        # The page's own result fields (AutoResult in
        # frontend/src/tests/freqAccuracy/AutomationPanel.tsx), so its table,
        # export and report read a step's rows as they read the page's.
        return {
            "freqMhz": p.freq_mhz, "earfcn": p.earfcn, "power": p.power_dbm, "paMode": p.pa_mode,
            "limitPpm": p.limit_ppm, "stagePpm": [], "stageLimits": self._stage_limits(),
            "measuredHz": None, "errorHz": None, "errorPpm": None, "levelDbm": None,
            "note": "", "verdict": None, "error": None,
        }

    async def before(self) -> None:
        await self.ctx.rig.zoom_begin()
        if self.lte:
            # As the page's run: down first and unconditionally -- nothing
            # reports the modem's state, and a test left on it would swallow
            # the first START.
            self.ctx.note("restarting the modem")
            try:
                await self.ctx.rig.lte_modem_off()
            except Exception as e:
                self.ctx.note(f"LTE modem off (run start) failed: {message(e)}", "warn")
            r = await self.ctx.rig.lte_modem_on()
            if not r.ok:
                raise RuntimeError(f"the LTE modem did not come up (status {r.status})")

    async def _key(self, p: FreqPoint, on: bool):
        rig = self.ctx.rig
        if self.lte:
            if p.earfcn is None:
                raise RuntimeError("an LTE point needs an EARFCN")
            return await rig.lte_cw(p.earfcn, p.power_dbm, on, hold=True)
        if on:
            return await rig.lora_power(round(p.freq_mhz * 1_000_000), int(p.power_dbm), p.pa_mode)
        await rig.stop()
        return None

    async def measure(self, p: FreqPoint) -> Row:
        ctx = self.ctx
        row = self.blank_row(p)
        if ctx.cancel.is_set():
            return row
        nominal = round(p.freq_mhz * 1_000_000)
        warnings: list[str] = []
        try:
            # Live before the command goes out: it is keyed down after
            # whether or not it was answered -- a timeout does not prove the
            # DUT did not key.
            self._live = p
            tx = await self._key(p, True)
            if not tx.ok:
                raise RuntimeError(f"the DUT refused the CW command (status {tx.status})")
            await ctx.rig.zoom_prepare(ref_level_for(p.power_dbm))
            # Keyed once for the whole zoom: each stage narrows the span
            # around the peak the one before centred.
            center = float(nominal)
            last: Optional[dict] = None
            for n, st in enumerate(self.settings.stages, start=1):
                if ctx.cancel.is_set():
                    return row
                await ctx.rig.zoom_setup(n, st, center if n == 1 else None)
                # After every re-centre and span change; on stage 1 also the
                # carrier's own settling time.
                await ctx.sleep(ctx.settle_s)
                if ctx.cancel.is_set():
                    return row
                last = await ctx.rig.zoom_measure(n, center, st)
                row["stagePpm"].append((last["marker_hz"] - nominal) / nominal * 1e6)
                if last.get("warning"):
                    warnings.append(last["warning"])
                center = last["marker_hz"]
            assert last is not None
            err = last["marker_hz"] - nominal
            row["measuredHz"] = last["marker_hz"]
            row["errorHz"] = err
            row["errorPpm"] = err / nominal * 1e6
            row["levelDbm"] = last.get("level_dbm")
            row["verdict"] = point_verdict(row["errorPpm"], p.limit_ppm, row["stagePpm"], row["stageLimits"])
        except Exception as e:
            # A cancelled request is the operator stopping, not a fault.
            row["error"] = None if ctx.cancel.is_set() else message(e)
        finally:
            await self._down()
        row["note"] = row["error"] or " ".join(warnings)
        return row

    async def _down(self) -> None:
        live = self._live
        if live is None:
            return
        try:
            await self._key(live, False)
        except Exception as e:
            self.ctx.note(f"keying the DUT down failed: {message(e)}", "error")
        self._live = None

    async def after(self) -> None:
        await self._down()
        try:
            await self.ctx.rig.zoom_end()
        except Exception:
            pass  # the results stand regardless, as on the page

    async def on_stop(self) -> None:
        if self.lte:
            await self._down()
            return
        # LoRa: stop whatever is on air, live point or not.
        try:
            await self.ctx.rig.stop()
        except Exception as e:
            self.ctx.note(f"stop failed: {message(e)}", "error")


class LoraFreqAccuracy(_FreqAccuracy):
    lte = False


class LteFreqAccuracy(_FreqAccuracy):
    lte = True


EXECUTORS: dict[str, type[Executor]] = {
    "power": LoraCw,
    "modulated": LoraModulated,
    "lte-cw": LteCw,
    "lte-modulated": LteModulated,
    "ble-cw": BleCw,
    "freq-accuracy": LoraFreqAccuracy,
    "lte-freq-accuracy": LteFreqAccuracy,
}

PROTOCOL_OF: dict[str, str] = {
    "power": "LoRa", "modulated": "LoRa", "lte-cw": "LTE", "lte-modulated": "LTE", "ble-cw": "BLE",
    "freq-accuracy": "LoRa", "lte-freq-accuracy": "LTE",
}
