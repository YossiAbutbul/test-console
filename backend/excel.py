"""Excel export for sweep results.

Layout per reference workbook:
- "All" sheet: every row, sorted by index.
- One sheet per setting Power value present in the dataset, named "<P> dBm".
  Each per-power sheet is sorted descending by measured Power [dBm].
  Columns: #, HP Max (hex), PA DC (hex), Power, Power [dBm], CC [mA]
"""

from __future__ import annotations

from io import BytesIO
from typing import Iterable

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from .test_runner import ResultRow

HEADERS = ["#", "HP Max", "PA DC", "Power", "Power [dBm]", "CC [mA]"]
HEADER_FONT = Font(bold=True)


def _hex_byte(v: int) -> str:
    return f"0x{v:02X}"


def _mA(current_a: float | None) -> float | None:
    return None if current_a is None else round(current_a * 1000.0, 2)


def _write_header(ws, row: int = 1) -> None:
    for col, name in enumerate(HEADERS, start=1):
        c = ws.cell(row=row, column=col, value=name)
        c.font = HEADER_FONT


def _row_values(rank: int, r: ResultRow) -> list:
    return [
        rank,
        _hex_byte(r.hp_max),
        _hex_byte(r.pa_duty_cycle),
        r.power_dbm_setting,
        r.tx_power_dbm,
        _mA(r.current_a),
    ]


def _autosize(ws) -> None:
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        width = max((len(str(c.value)) for c in col if c.value is not None), default=4)
        ws.column_dimensions[col_letter].width = min(max(width + 2, 8), 24)


def build_workbook(rows: Iterable[ResultRow]) -> bytes:
    rows = list(rows)
    wb = Workbook()

    # --- All sheet ---
    ws_all = wb.active
    ws_all.title = "All"
    _write_header(ws_all)
    for i, r in enumerate(rows, start=1):
        for col, val in enumerate(_row_values(i, r), start=1):
            ws_all.cell(row=i + 1, column=col, value=val)
    _autosize(ws_all)

    # --- Per-measured-power sheets ---
    # Bucket each row by round(measured dBm). Tab "N dBm" gets rows whose
    # measured power is in [N - 0.5, N + 0.5).
    buckets: dict[int, list[ResultRow]] = {}
    for r in rows:
        if r.tx_power_dbm is None:
            continue
        # Skip sentinel / under-range readings.
        if r.tx_power_dbm < -50:
            continue
        bucket = int(round(r.tx_power_dbm))
        buckets.setdefault(bucket, []).append(r)

    for bucket in sorted(buckets.keys(), reverse=True):
        subset = buckets[bucket]
        # Sort ascending by closeness to the tab's target.
        subset.sort(key=lambda r, t=bucket: abs((r.tx_power_dbm or 0.0) - t))
        ws = wb.create_sheet(title=f"{bucket} dBm")
        _write_header(ws)
        for i, r in enumerate(subset, start=1):
            for col, val in enumerate(_row_values(i, r), start=1):
                ws.cell(row=i + 1, column=col, value=val)
        _autosize(ws)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
