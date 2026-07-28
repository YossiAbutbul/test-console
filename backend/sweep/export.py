"""Excel export for sweep results.

Workbook layout:
- "All" sheet: every row, in sweep order.
- One sheet per *measured* power bucket, named "<N> dBm", holding the rows whose
  measured power rounds to N. Sheets run from the highest bucket down; within a
  sheet, rows run from closest to the bucket's nominal value outwards.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any, Iterable

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from .models import ResultRow

HEADERS = ["#", "HP Max", "PA DC", "Power", "Power [dBm]", "CC [mA]"]
HEADER_FONT = Font(bold=True)

# Readings at or below this are the sensor's under-range sentinel, not a real
# measurement, so they get no bucket of their own.
UNDER_RANGE_DBM = -50.0

COL_WIDTH_MIN = 8
COL_WIDTH_MAX = 24


def _hex_byte(value: int) -> str:
    return f"0x{value:02X}"


def _milliamps(current_a: float | None) -> float | None:
    return None if current_a is None else round(current_a * 1000.0, 2)


def _write_header(ws: Worksheet, row: int = 1) -> None:
    for col, name in enumerate(HEADERS, start=1):
        ws.cell(row=row, column=col, value=name).font = HEADER_FONT


def _row_values(rank: int, r: ResultRow) -> list[Any]:
    return [
        rank,
        _hex_byte(r.hp_max),
        _hex_byte(r.pa_duty_cycle),
        r.power_dbm_setting,
        r.tx_power_dbm,
        _milliamps(r.current_a),
    ]


def _write_sheet(ws: Worksheet, rows: Iterable[ResultRow]) -> None:
    _write_header(ws)
    for i, r in enumerate(rows, start=1):
        for col, value in enumerate(_row_values(i, r), start=1):
            ws.cell(row=i + 1, column=col, value=value)
    _autosize(ws)


def _autosize(ws: Worksheet) -> None:
    for col in ws.columns:
        letter = get_column_letter(col[0].column)
        width = max((len(str(c.value)) for c in col if c.value is not None), default=4)
        ws.column_dimensions[letter].width = min(max(width + 2, COL_WIDTH_MIN), COL_WIDTH_MAX)


def _bucket_by_measured_power(rows: Iterable[ResultRow]) -> dict[int, list[ResultRow]]:
    """Group rows by round(measured dBm), dropping unmeasured/under-range ones."""
    buckets: dict[int, list[ResultRow]] = {}
    for r in rows:
        if r.tx_power_dbm is None or r.tx_power_dbm < UNDER_RANGE_DBM:
            continue
        buckets.setdefault(int(round(r.tx_power_dbm)), []).append(r)
    return buckets


def build_workbook(rows: Iterable[ResultRow]) -> bytes:
    """Render sweep rows to an .xlsx file, returned as bytes."""
    rows = list(rows)
    wb = Workbook()

    ws_all = wb.active
    ws_all.title = "All"
    _write_sheet(ws_all, rows)

    buckets = _bucket_by_measured_power(rows)
    for bucket in sorted(buckets, reverse=True):
        subset = sorted(buckets[bucket], key=lambda r: abs((r.tx_power_dbm or 0.0) - bucket))
        _write_sheet(wb.create_sheet(title=f"{bucket} dBm"), subset)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
