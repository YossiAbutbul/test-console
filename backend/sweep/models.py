"""Wire types for the parameter sweep.

Shared by the runner, the Excel export and the `/test` routes, so the HTTP
schema and the engine cannot drift apart.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

# Validation ranges, per the CATM2 command spec.
# All three axes are 1-based. Zero is not a valid setting for any of them — the
# DUT does not answer a command carrying one, which hangs the sweep on that
# point rather than failing it. `validate_ranges` therefore rejects 0 before the
# run starts, and these defaults never generate one.
#
# These must stay in step with `RANGES` in
# frontend/src/tests/powerSweep/PowerSweepPage.tsx.
HP_MAX_RANGE = range(1, 8)         # 1..7
PA_DC_RANGE = range(1, 5)          # 1..4
POWER_RANGE = range(1, 23)         # 1..22

# Settle delay before anything is read. Below 400 ms the power sensor's averaged
# reading still carries energy from the previous point, so a low-power point
# inherits the previous high-power figure while its current reads correctly —
# which looks like a measurement fault rather than a timing one. Found on the
# bench; `settle_ms` refuses anything lower.
#
# Mirrored by MIN_SETTLE_MS / DEFAULT_SETTLE_MS in frontend/src/lib/settle.ts.
MIN_SETTLE_MS = 400
DEFAULT_SETTLE_MS = 400


class RunState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    ERROR = "error"


class SweepBlock(BaseModel):
    """One group of combinations: its own span on each of the three axes.

    A sweep was a single cross-product of three ranges, which cannot express
    "power 1-12 while duty is 2-4, then power 13-22 while duty is 1" -- that
    had to be two runs with their exports stitched together afterwards. A list
    of blocks is the same thing in one run, and each block is still a plain
    cross-product internally.

    Blocks are run in order and are not de-duplicated: two that overlap measure
    the overlapping points twice, which is the operator's choice to make.
    """

    power_values: list[int] = Field(default_factory=lambda: list(POWER_RANGE))
    duty_values: list[int] = Field(default_factory=lambda: list(PA_DC_RANGE))
    hp_values: list[int] = Field(default_factory=lambda: list(HP_MAX_RANGE))

    @property
    def steps(self) -> int:
        return len(self.hp_values) * len(self.duty_values) * len(self.power_values)


class SweepConfig(BaseModel):
    """One sweep's plan.

    The runner walks `effective_blocks` in order, and within each block
    iterates hp × duty × power at `freq_hz`.
    """

    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF)
    power_values: list[int] = Field(default_factory=lambda: list(POWER_RANGE))
    duty_values: list[int] = Field(default_factory=lambda: list(PA_DC_RANGE))
    hp_values: list[int] = Field(default_factory=lambda: list(HP_MAX_RANGE))
    blocks: list[SweepBlock] = Field(
        default_factory=list,
        description=(
            "Optional multi-range plan. When empty the three *_values lists are "
            "run as a single block, which is what every older client sends."
        ),
    )
    settle_ms: int = Field(default=DEFAULT_SETTLE_MS, ge=MIN_SETTLE_MS, le=10_000)
    cmd_timeout_s: float = Field(default=5.0, ge=0.1, le=60.0)
    pa_mode: int = Field(default=0, ge=0, le=2, description="0=OFF 1=ON 2=AUTO")
    path_loss_db: float = Field(
        default=0.0, ge=-200.0, le=200.0,
        description="Added to the raw sensor reading: DUT power = sensor + path_loss_db",
    )

    @property
    def effective_blocks(self) -> list[SweepBlock]:
        """The blocks the runner will actually walk.

        An empty `blocks` means the legacy single cross-product, so a client
        that knows nothing about blocks -- and every existing caller -- keeps
        working unchanged.
        """
        if self.blocks:
            return self.blocks
        return [SweepBlock(
            power_values=self.power_values,
            duty_values=self.duty_values,
            hp_values=self.hp_values,
        )]

    def validate_ranges(self) -> None:
        """Reject a plan the DUT would refuse, before any hardware is touched."""
        for block in self.effective_blocks:
            for value in block.duty_values:
                if value not in PA_DC_RANGE:
                    raise ValueError(f"PaDutyCycle out of range: {value}")
            for value in block.hp_values:
                if value not in HP_MAX_RANGE:
                    raise ValueError(f"HpMax out of range: {value}")
            for value in block.power_values:
                if value not in POWER_RANGE:
                    raise ValueError(f"Power out of range: {value}")

    @property
    def total_steps(self) -> int:
        return sum(block.steps for block in self.effective_blocks)


class ResultRow(BaseModel):
    """One measured sweep point. A failed step still produces a row, with
    `error` set, so the client can show exactly where a run went wrong."""

    idx: int
    freq_hz: int
    power_dbm_setting: int
    pa_duty_cycle: int
    hp_max: int
    tx_power_dbm: Optional[float] = None
    """Sensor reading plus `SweepConfig.path_loss_db` — i.e. power at the DUT."""
    tx_power_dbm_raw: Optional[float] = None
    """Uncorrected sensor reading, kept so a wrong path loss can be undone."""
    current_a: Optional[float] = None
    voltage_v: Optional[float] = None
    tx_hex: str
    rx_hex: str
    ok: bool
    status: int
    error: Optional[str] = None
    t_ms: int


class RunStatus(BaseModel):
    """Snapshot polled by the client while a sweep runs."""

    state: RunState
    completed: int
    total: int
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    config: Optional[SweepConfig] = None
    last_row: Optional[ResultRow] = None
