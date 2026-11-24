"""What a test sequence is made of, as the page sends it and reads it back.

The page still plans: each test turns its settings into points in the browser
(`frontend/src/tests/<id>/sweepTest.ts`), so the editors stay as they are. This
side executes those points. Rows are plain dicts with the field names the
page's result tables already use (`AutomationResultRow` and its siblings in
`frontend/src/store/*PageStore.ts`), so the tables, reports and CSV exports
read them unchanged.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from ..sweep.models import RunState, SpectrumSettings

TestId = Literal[
    "power", "modulated", "lte-cw", "lte-modulated", "ble-cw", "freq-accuracy", "lte-freq-accuracy",
]
SetupId = Literal["main", "ble", "load-pull"]


class LoraCwPoint(BaseModel):
    freq_mhz: float
    power_dbm: int
    pa_mode: int = Field(ge=0, le=2)
    #: Tolerance around `power_dbm`, or None when the point is not judged.
    margin_db: Optional[float] = None


class LoraModPoint(BaseModel):
    freq_mhz: float
    power_dbm: int
    modem: int
    bandwidth: int
    datarate: int
    margin_db: Optional[float] = None


class LteCwPoint(BaseModel):
    earfcn: int
    band: Optional[int] = None
    freq_mhz: float
    power_dbm: float = Field(ge=0, le=23)
    margin_db: Optional[float] = None


class LteModPoint(BaseModel):
    earfcn: int
    band: Optional[int] = None
    freq_mhz: float
    power_dbm: float = Field(ge=0, le=23)
    bandwidth: int
    mcs: int
    rb_count: int
    margin_db: Optional[float] = None


class BlePoint(BaseModel):
    channel: int = Field(ge=0, le=39)
    freq_mhz: float
    #: The tone power parameter, 6-31.
    power: int = Field(ge=6, le=31)
    min_dbm: Optional[float] = None
    max_dbm: Optional[float] = None


class FreqPoint(BaseModel):
    """A frequency accuracy point: a CW carrier the analyzer zooms in on."""

    #: The carrier's nominal frequency; for LTE the EARFCN's uplink centre as
    #: the page resolved it. The error is against this.
    freq_mhz: float = Field(gt=0)
    #: LoRa: whole dBm. LTE: 0..23 dBm.
    power_dbm: float = Field(ge=0, le=255)
    pa_mode: int = Field(default=2, ge=0, le=2)
    #: LTE only: the channel keyed.
    earfcn: Optional[int] = Field(default=None, ge=0)
    #: The final error must be within +- this many ppm; None: not judged.
    limit_ppm: Optional[float] = Field(default=None, gt=0)


class FreqStage(BaseModel):
    span_hz: float = Field(gt=0, le=3_000_000_000)
    rbw_hz: float = Field(gt=0)
    vbw_hz: float = Field(gt=0)


class FreqSettings(BaseModel):
    """The zoom, as the Frequency accuracy page's Measure settings hold it."""

    #: Widest first; each re-centres on the previous stage's peak.
    stages: list[FreqStage] = Field(min_length=1, max_length=6)
    #: Each stage's peak must be within +- this many ppm of nominal, by stage;
    #: None (or missing) for a stage that is not judged.
    stage_limits_ppm: list[Optional[float]] = Field(default_factory=list)


Point = Union[LoraCwPoint, LoraModPoint, LteCwPoint, LteModPoint, BlePoint, FreqPoint]


class PowerSource(BaseModel):
    """What reads power: the sensor, or the analyzer at these settings."""

    source: Literal["sensor", "spectrum"] = "sensor"
    spectrum: SpectrumSettings = Field(default_factory=SpectrumSettings)


class StepIn(BaseModel):
    uid: str
    test: TestId
    setup: SetupId
    #: "LoRa CW", or the operator's name for the step -- for the log.
    label: str
    points: list[dict[str, Any]]
    settle_ms: int = Field(ge=0, le=600_000)
    power: PowerSource = Field(default_factory=PowerSource)
    #: BLE only: a fixed tone length in whole seconds, or None for auto.
    tone_s: Optional[int] = Field(default=None, ge=1, le=255)
    #: Frequency accuracy only: the zoom stages and their tolerances.
    freq: Optional[FreqSettings] = None


class PathLossPoint(BaseModel):
    freq_mhz: float
    db: float


class PathLoss(BaseModel):
    """The bench's path loss, as the page holds it (`lib/pathLoss.ts`)."""

    default_db: float = 0.0
    points: list[PathLossPoint] = Field(default_factory=list)


class SequenceIn(BaseModel):
    steps: list[StepIn] = Field(min_length=1)
    #: The setup the bench is on as the run starts, if known.
    bench: Optional[SetupId] = None
    path_loss: PathLoss = Field(default_factory=PathLoss)


StepVerdict = Literal["pass", "fail", "na", "error", "stopped", "not-run", "running"]


class StepOutcome(BaseModel):
    uid: str
    verdict: StepVerdict = "not-run"
    passed: int = 0
    failed: int = 0
    measured: int = 0
    planned: int = 0
    errors: int = 0
    ms: int = 0
    #: Why the step ended the run, for `error`.
    message: Optional[str] = None


class RecablePrompt(BaseModel):
    """The run is waiting for the bench to be re-cabled before a step."""

    seq: int
    step_uid: str
    from_setup: Optional[SetupId] = None
    to_setup: SetupId


class Note(BaseModel):
    """A line for the page's log, numbered so a page polls only new ones."""

    seq: int
    message: str
    level: Literal["info", "warn", "error"] = "info"


class Current(BaseModel):
    uid: str
    #: Its place among the steps that run.
    index: int
    #: Points finished, of planned.
    done: int
    total: int


class SequenceStatus(BaseModel):
    state: RunState = RunState.IDLE
    steps: list[StepOutcome] = Field(default_factory=list)
    current: Optional[Current] = None
    prompt: Optional[RecablePrompt] = None
    #: The setup the bench is known to be on.
    bench: Optional[SetupId] = None
    notes: list[Note] = Field(default_factory=list)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    #: How it ended: stopped by the operator, declined at a re-cable, or a
    #: step that could not go on. None while running or after a clean finish.
    ended: Optional[Literal["stopped", "declined", "error"]] = None


class RecableAnswer(BaseModel):
    seq: int
    ok: bool
