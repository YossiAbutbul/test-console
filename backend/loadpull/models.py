"""One measured Load Pull point, as the browser reports it.

The run loop lives in the frontend for this test — the trombone, switch, VNA
and DUT are driven from there — so rows arrive over the wire rather than out of
a backend runner.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class LoadPullRow(BaseModel):
    pos_pulses: int
    pos_mm: float
    #: Absent on rows recorded before a run could sweep more than one of each,
    #: and on CSVs exported then. Those land in "All" and in an "Unspecified"
    #: sheet rather than being dropped.
    freq_mhz: Optional[float] = None
    power_dbm_setting: Optional[float] = None
    power_dbm: Optional[float] = None
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


class LoadPullExportRequest(BaseModel):
    rows: list[LoadPullRow]
    meta: Optional[LoadPullMeta] = None
