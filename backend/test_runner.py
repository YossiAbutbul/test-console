"""Parameter-sweep test runner.

For now: iterate (PaDutyCycle x HpMax). Power is single value per run; the
0..22 sweep gets added later. Frequency is single per run.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from .device import Device, PaMode
from .hw.base import CurrentMeter, PowerMeter

log = logging.getLogger(__name__)


# --- Validation ranges (per CATM2 spec) ---
HP_MAX_RANGE = range(0x00, 0x08)   # 0..7
PA_DC_RANGE = range(0x00, 0x05)    # 0..4
POWER_RANGE = range(1, 23)         # 1..22


class RunState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    ERROR = "error"


class SweepConfig(BaseModel):
    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF)
    power_values: list[int] = Field(default_factory=lambda: list(POWER_RANGE))
    duty_values: list[int] = Field(default_factory=lambda: list(PA_DC_RANGE))
    hp_values: list[int] = Field(default_factory=lambda: list(HP_MAX_RANGE))
    settle_ms: int = Field(default=30, ge=0, le=10_000)
    cmd_timeout_s: float = Field(default=5.0, ge=0.1, le=60.0)
    pa_mode: int = Field(default=0, ge=0, le=2, description="0=OFF 1=ON 2=AUTO")

    def validate_ranges(self) -> None:
        for v in self.duty_values:
            if v not in PA_DC_RANGE:
                raise ValueError(f"PaDutyCycle out of range: {v}")
        for v in self.hp_values:
            if v not in HP_MAX_RANGE:
                raise ValueError(f"HpMax out of range: {v}")
        for v in self.power_values:
            if v not in POWER_RANGE:
                raise ValueError(f"Power out of range: {v}")

    @property
    def total_steps(self) -> int:
        return len(self.hp_values) * len(self.duty_values) * len(self.power_values)


class ResultRow(BaseModel):
    idx: int
    freq_hz: int
    power_dbm_setting: int
    pa_duty_cycle: int
    hp_max: int
    tx_power_dbm: Optional[float] = None
    current_a: Optional[float] = None
    voltage_v: Optional[float] = None
    tx_hex: str
    rx_hex: str
    ok: bool
    status: int
    error: Optional[str] = None
    t_ms: int


class RunStatus(BaseModel):
    state: RunState
    completed: int
    total: int
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    config: Optional[SweepConfig] = None
    last_row: Optional[ResultRow] = None


@dataclass
class _RunCtx:
    config: SweepConfig
    state: RunState = RunState.IDLE
    results: list[ResultRow] = field(default_factory=list)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    task: Optional[asyncio.Task] = None


class TestRunner:
    def __init__(self) -> None:
        self._ctx: Optional[_RunCtx] = None
        self._lock = asyncio.Lock()

    def status(self) -> RunStatus:
        c = self._ctx
        if c is None:
            return RunStatus(state=RunState.IDLE, completed=0, total=0)
        return RunStatus(
            state=c.state,
            completed=len(c.results),
            total=c.config.total_steps,
            started_at=c.started_at,
            finished_at=c.finished_at,
            error=c.error,
            config=c.config,
            last_row=c.results[-1] if c.results else None,
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
            self._ctx = ctx
            ctx.task = asyncio.create_task(
                self._run(ctx, device, power_meter, current_meter)
            )
            return self.status()

    async def cancel(self) -> RunStatus:
        if self._ctx and self._ctx.state == RunState.RUNNING:
            self._ctx.cancel.set()
        return self.status()

    async def _run(
        self,
        ctx: _RunCtx,
        device: Device,
        pm: Optional[PowerMeter],
        cm: Optional[CurrentMeter],
    ) -> None:
        ctx.state = RunState.RUNNING
        ctx.started_at = time.time()
        t0 = time.perf_counter()
        log.info("Sweep started: %d steps", ctx.config.total_steps)

        try:
            if pm is not None:
                pm.set_frequency_hz(ctx.config.freq_hz)
                # Give sensor time to apply calibration before first read.
                await asyncio.sleep(0.2)

            idx = 0
            for hp in ctx.config.hp_values:
                for duty in ctx.config.duty_values:
                    for power in ctx.config.power_values:
                        if ctx.cancel.is_set():
                            ctx.state = RunState.CANCELLED
                            return

                        error: Optional[str] = None
                        tx_dbm: Optional[float] = None
                        cur_a: Optional[float] = None
                        volt_v: Optional[float] = None
                        tx_hex = ""
                        rx_hex = ""
                        ok = False
                        status = -1

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
                            tx_hex = result.tx.hex(" ")
                            rx_hex = result.rx.hex(" ")
                            ok = result.ok
                            status = result.status

                            await asyncio.sleep(ctx.config.settle_ms / 1000.0)
                            t_settle = time.perf_counter()

                            if pm is not None:
                                tx_dbm = await asyncio.to_thread(pm.read_dbm)
                            t_pm = time.perf_counter()

                            if cm is not None:
                                cur_a = await asyncio.to_thread(cm.read_current_a)
                            t_cm = time.perf_counter()

                            if idx < 3 or idx % 50 == 0:
                                log.info(
                                    "step %d/%d hp=%d duty=%d pow=%d "
                                    "cmd=%dms settle=%dms pm=%dms cm=%dms",
                                    idx, ctx.config.total_steps, hp, duty, power,
                                    int((t_cmd - t_step) * 1000),
                                    int((t_settle - t_cmd) * 1000),
                                    int((t_pm - t_settle) * 1000),
                                    int((t_cm - t_pm) * 1000),
                                )
                        except Exception as e:
                            error = f"{type(e).__name__}: {e}"
                            log.exception(
                                "Step failed idx=%d hp=%d duty=%d pow=%d",
                                idx, hp, duty, power,
                            )

                        row = ResultRow(
                            idx=idx,
                            freq_hz=ctx.config.freq_hz,
                            power_dbm_setting=power,
                            pa_duty_cycle=duty,
                            hp_max=hp,
                            tx_power_dbm=tx_dbm,
                            current_a=cur_a,
                            voltage_v=volt_v,
                            tx_hex=tx_hex,
                            rx_hex=rx_hex,
                            ok=ok,
                            status=status,
                            error=error,
                            t_ms=int((time.perf_counter() - t0) * 1000),
                        )
                        ctx.results.append(row)
                        idx += 1

            ctx.state = RunState.DONE
        except Exception as e:
            ctx.state = RunState.ERROR
            ctx.error = f"{type(e).__name__}: {e}"
            log.exception("Sweep failed")
        finally:
            ctx.finished_at = time.time()
            # Always send stop_test so CW does not stay on after sweep ends.
            try:
                await device.stop_test(timeout=ctx.config.cmd_timeout_s)
                log.info("Sent stop_test at end of sweep")
            except Exception as e:
                log.warning("stop_test at end of sweep failed: %s", e)
            for inst in (pm, cm):
                if inst is None:
                    continue
                try:
                    inst.disconnect()
                except Exception as e:
                    log.warning("Instrument disconnect failed: %s", e)
            log.info(
                "Sweep ended: state=%s completed=%d",
                ctx.state, len(ctx.results),
            )


runner = TestRunner()
