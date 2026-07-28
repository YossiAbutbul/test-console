"""Wire types for the parameter sweep.

Shared by the runner, the Excel export and the `/test` routes, so the HTTP
schema and the engine cannot drift apart.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

# Validation ranges, per the CATM2 command spec.
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
    """One sweep's plan. The runner iterates hp × duty × power at `freq_hz`."""

    freq_hz: int = Field(..., ge=0, le=0xFFFFFFFF)
    power_values: list[int] = Field(default_factory=lambda: list(POWER_RANGE))
    duty_values: list[int] = Field(default_factory=lambda: list(PA_DC_RANGE))
    hp_values: list[int] = Field(default_factory=lambda: list(HP_MAX_RANGE))
    settle_ms: int = Field(default=30, ge=0, le=10_000)
    cmd_timeout_s: float = Field(default=5.0, ge=0.1, le=60.0)
    pa_mode: int = Field(default=0, ge=0, le=2, description="0=OFF 1=ON 2=AUTO")
    path_loss_db: float = Field(
        default=0.0, ge=-200.0, le=200.0,
        description="Added to the raw sensor reading: DUT power = sensor + path_loss_db",
    )

    def validate_ranges(self) -> None:
        """Reject a plan the DUT would refuse, before any hardware is touched."""
        for value in self.duty_values:
            if value not in PA_DC_RANGE:
                raise ValueError(f"PaDutyCycle out of range: {value}")
        for value in self.hp_values:
            if value not in HP_MAX_RANGE:
                raise ValueError(f"HpMax out of range: {value}")
        for value in self.power_values:
            if value not in POWER_RANGE:
                raise ValueError(f"Power out of range: {value}")

    @property
    def total_steps(self) -> int:
        return len(self.hp_values) * len(self.duty_values) * len(self.power_values)


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
