"""Wire types for the parameter sweep.

Shared by the runner, the Excel export and the `/test` routes, so the HTTP
schema and the engine cannot drift apart.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

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


# Detectors the FSC3 accepts; see DETECTORS in backend/spectrum/config.py.
# Mirrored by SPECTRUM_DETECTORS in
# frontend/src/tests/powerSweep/PowerSweepPage.tsx.
SPECTRUM_DETECTORS = ("APE", "POS", "NEG", "SAMP", "RMS")


class SpectrumSettings(BaseModel):
    """How the analyzer is set up when it, not the power sensor, reads power.

    Centred on the sweep's own frequency, so there is no centre here. The
    reference offset is forced to 0 at the start of the run: the path loss is
    added in software (`path_loss_db`), and an offset left on the analyzer
    would count the cable twice.
    """

    span_hz: float = Field(default=1_000_000, gt=0, le=3_000_000_000)
    rbw_hz: float = Field(default=100_000, gt=0)
    vbw_hz: float = Field(default=300_000, gt=0)
    detector: Literal["APE", "POS", "NEG", "SAMP", "RMS"] = "POS"


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
    power_source: Literal["sensor", "spectrum"] = Field(
        default="sensor",
        description="What reads TX power: the USB power sensor or the spectrum analyzer.",
    )
    spectrum: SpectrumSettings = Field(default_factory=SpectrumSettings)
    measure_current: bool = Field(
        default=True,
        description=(
            "Read current and voltage from the DC analyzer at each step. Off, "
            "the analyzer is not opened at all, so a power-only sweep runs on a "
            "rig without one and skips its two reads per step."
        ),
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
    #: Where the finished run's workbook was saved on its own, so a backend
    #: restart cannot lose the rows. Set once the run has ended.
    autosave_path: Optional[str] = None


class RigInfo(BaseModel):
    """The bench a sweep ran on, for the workbook's Run sheet.

    Captured when the run starts rather than at export: by then the DUT may be
    disconnected or another sensor plugged in, and the file would name the rig
    as it is now instead of the one that produced its numbers.
    """

    dut_mac: Optional[str] = None
    #: The DUT's advertised name -- the nearest thing to a device type the BLE
    #: link carries.
    dut_name: Optional[str] = None
    power_sensor_idn: Optional[str] = None
    #: Serial the sensor was opened by, when the sweep opened it itself.
    power_sensor_address: Optional[str] = None
    dc_analyzer_idn: Optional[str] = None
    dc_analyzer_address: Optional[str] = None
    dc_channel: Optional[int] = None
    #: Set instead of the power sensor's when the analyzer read power.
    spectrum_idn: Optional[str] = None
    spectrum_address: Optional[str] = None
    #: Supplied with the export request, not the run.
    operator: Optional[str] = None
    notes: Optional[str] = None
