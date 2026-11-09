"""Load Pull rows, the export request, and the run the backend drives.

Rows come back two ways: out of `loadpull.runner` for a run measured here,
and over the wire with an export request, since the page holds the table.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..sweep.models import DEFAULT_SETTLE_MS, MIN_SETTLE_MS, RunState, SpectrumSettings


class LoadPullRow(BaseModel):
    pos_pulses: int
    pos_mm: float
    #: Absent on rows recorded before a run could sweep more than one of each,
    #: and on CSVs exported then. Those land in "All" and in an "Unspecified"
    #: sheet rather than being dropped.
    freq_mhz: Optional[float] = None
    #: LTE runs only: the channel sent. `freq_mhz` is its uplink frequency,
    #: which is what the sheets are grouped by.
    earfcn: Optional[int] = None
    power_dbm_setting: Optional[float] = None
    #: Manual attenuator on the trombone's second output. Absent when the run
    #: did not sweep it.
    att_db: Optional[float] = None
    power_dbm: Optional[float] = None
    #: The uncorrected sensor reading. Kept because the correction moves the
    #: number by tens of dB without moving where the sensor actually sat, so a
    #: corrected value cannot say how far into the meter's range it was -- and
    #: that is what decides whether the point is trustworthy. Absent on rows
    #: recorded before it existed.
    power_dbm_raw: Optional[float] = None
    current_a: Optional[float] = None
    r_ohm: Optional[float] = None
    x_ohm: Optional[float] = None
    s11_db: Optional[float] = None
    error: Optional[str] = None


class PathLossPoint(BaseModel):
    freq_mhz: float
    db: float
    #: False when the frequency had no table entry and the default was used.
    calibrated: bool = True


class LoadPullMeta(BaseModel):
    """What the run was asked to do, for the workbook's Run sheet.

    None of it is derivable from the rows: the specs record what was requested
    rather than what came back, and a file without them cannot say which path
    loss produced its numbers or how long the PA was left to settle.
    """
    #: Which radio keyed the DUT, "LoRa" or "LTE". Absent from clients that
    #: predate LTE Load Pull, which were all LoRa.
    radio: Optional[str] = None
    freq_spec: Optional[str] = None
    power_spec: Optional[str] = None
    settle_ms: Optional[int] = None
    pa_mode: Optional[int] = None
    delta_x_mm: Optional[float] = None
    zero_pulses: Optional[int] = None
    end_pulses: Optional[int] = None
    path_loss_default_db: Optional[float] = None
    path_loss_points: list[PathLossPoint] = []
    dut_mac: Optional[str] = None
    #: The DUT's advertised name -- the nearest thing to a device type the BLE
    #: link carries.
    dut_name: Optional[str] = None
    #: Epoch seconds. Optional because the run loop is in the browser and older
    #: clients do not send them; the Run sheet says "—" rather than guessing.
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    #: The rig. Filled by the export route from the sessions `/instruments`
    #: holds when the client does not send them -- which it normally does not,
    #: since the backend is the side that knows.
    power_sensor_idn: Optional[str] = None
    power_sensor_address: Optional[str] = None
    #: "sensor" or "spectrum", and the analyzer when it read power.
    power_source: Optional[str] = None
    spectrum_idn: Optional[str] = None
    dc_analyzer_idn: Optional[str] = None
    dc_analyzer_address: Optional[str] = None
    dc_channel: Optional[int] = None
    #: Free text for the Run sheet, optional.
    operator: Optional[str] = None
    notes: Optional[str] = None


class LoadPullExportRequest(BaseModel):
    rows: list[LoadPullRow]
    meta: Optional[LoadPullMeta] = None

# ---------- The run itself ----------
#
# The loop used to live in the browser, so a tab that crashed took the run
# with it -- twice at ~890 points of an attenuator sweep. It runs here now:
# the page sends the plan, then only watches it and answers the attenuator
# prompts, and a reloaded page re-attaches to the run still in progress.

#: Trombone pulses per millimetre. Mirrors PULSES_PER_MM in
#: frontend/src/lib/trombone.ts.
PULSES_PER_MM = 400

#: The modem's ceiling; mirrors MAX_TX_POWER_DBM in device/lte.py.
LTE_MAX_POWER_DBM = 23

#: More points than this is not a run anyone meant to start. The page caps a
#: plan at what its browser storage can hold (~11 400 rows), well under this.
MAX_PLAN_POINTS = 20_000


class PlanPoint(BaseModel):
    """One measurement of the plan, as the page laid it out."""
    pos: int
    freq_mhz: float = Field(gt=0)
    #: LTE only: the channel sent to the modem; `freq_mhz` is its uplink.
    earfcn: Optional[int] = Field(default=None, ge=0)
    power_dbm: float
    #: Null when the run is not sweeping the attenuator.
    att_db: Optional[float] = None


class LoadPullRunConfig(BaseModel):
    radio: Literal["LoRa", "LTE"]
    #: The whole plan, in the order it is measured.
    points: list[PlanPoint] = Field(min_length=1, max_length=MAX_PLAN_POINTS)
    #: Points already measured, for Continue: the run starts at this index.
    start_index: int = Field(default=0, ge=0)
    settle_ms: int = Field(default=DEFAULT_SETTLE_MS, ge=MIN_SETTLE_MS, le=60_000)
    #: LoRa only. 0=OFF 1=ON 2=AUTO.
    pa_mode: int = Field(default=2, ge=0, le=2)
    #: Path loss for every frequency in the plan, already resolved by the page
    #: (which owns the table); added to the sensor reading.
    path_loss: list[PathLossPoint] = []
    #: What reads TX power: the USB sensor, or the spectrum analyzer at
    #: `spectrum` (centred on each point's frequency). Path loss is added to
    #: either.
    power_source: Literal["sensor", "spectrum"] = "sensor"
    spectrum: SpectrumSettings = Field(default_factory=SpectrumSettings)
    #: VNA span either side of each frequency, as a fraction of it.
    vna_half_span_frac: float = Field(default=0.005, gt=0, le=0.5)
    #: The page's identity for the plan, echoed in the status so a reloaded
    #: page can tell whether the run in progress is the one it has rows for.
    plan_key: Optional[str] = None
    cmd_timeout_s: float = Field(default=5.0, ge=0.1, le=30.0)

    @model_validator(mode="after")
    def _consistent(self) -> "LoadPullRunConfig":
        if self.start_index >= len(self.points):
            raise ValueError("start_index is past the end of the plan")
        for i, p in enumerate(self.points):
            if self.radio == "LTE":
                if p.earfcn is None:
                    raise ValueError(f"point {i + 1} has no EARFCN")
                if not 0 <= p.power_dbm <= LTE_MAX_POWER_DBM:
                    raise ValueError(f"point {i + 1}: power must be 0-{LTE_MAX_POWER_DBM} dBm")
            elif p.power_dbm != int(p.power_dbm) or not 0 <= p.power_dbm <= 255:
                # The LoRa power frame carries a whole dBm.
                raise ValueError(f"point {i + 1}: LoRa power must be a whole 0-255 dBm")
        return self


class AttPrompt(BaseModel):
    """The run is waiting for the operator to set the attenuator."""
    #: Increments per prompt, so a page answers each one exactly once.
    seq: int
    db: float
    #: 0-based attenuator step, of `cycles`.
    cycle: int
    cycles: int
    #: The plan's later settings, in order -- the ones a jump can go to.
    upcoming: list[float] = []


class LoadPullStatus(BaseModel):
    state: RunState
    radio: Optional[str] = None
    #: Points done, counting the ones a Continue started past.
    completed: int = 0
    total: int = 0
    start_index: int = 0
    #: Rows this run has measured so far.
    rows: int = 0
    #: Points passed over by jumping the attenuator ahead; counted in
    #: `completed`, never measured.
    skipped: int = 0
    errors: int = 0
    #: What the run is doing right now, for the page: "modem", "moving",
    #: "vna", "measuring", "attenuator", or None.
    phase: Optional[str] = None
    att_prompt: Optional[AttPrompt] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    plan_key: Optional[str] = None
