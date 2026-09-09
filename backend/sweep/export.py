"""Excel export for sweep results.

Workbook layout:
- "All" sheet: every row, in sweep order.
- "Run" sheet: the config the sweep ran with. Without it a saved workbook could
  not say which path loss or settle time produced its numbers, so two files with
  different corrections were indistinguishable once they left the app.
- One sheet per *measured* power bucket, named "<N> dBm", holding the rows whose
  measured power rounds to N. Sheets run from the highest bucket down; within a
  sheet, rows run from closest to the bucket's nominal value outwards.
"""

from __future__ import annotations

import time
from io import BytesIO
from typing import Any, Iterable

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from .models import ResultRow, SweepConfig

# "#" is the sweep index, not the row's position in this sheet: a bucket sheet
# reorders its rows, so a per-sheet counter matched nothing in the All sheet or
# in the app's results table and a row could not be traced between them.
#
# "Power Set" vs "Measured": the old pair was "Power" and "Power [dBm]", which
# read as though the *second* one was the commanded value. Both carry their unit
# now, and the app's table uses the same two names.
# Column order follows the sweep's own configuration -- Power, PA DC, HP Max --
# so a row reads in the order the run was set up. It used to be the reverse of
# that, which is the runner's nesting order (hp outermost) rather than anything
# the operator sees.
#
# Order is not part of the file format: `parse_workbook` matches on the header
# text, so a workbook written before this change still imports.
HEADERS = [
    "#", "Power Set [dBm]", "PA DC", "HP Max", "Measured [dBm]", "Raw [dBm]",
    "CC [mA]", "V [V]", "Status",
]
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


def _volts(voltage_v: float | None) -> float | None:
    """Supply voltage beside the current, so a row carries the power it drew
    rather than only half of it."""
    return None if voltage_v is None else round(voltage_v, 3)


def _write_header(ws: Worksheet, row: int = 1) -> None:
    for col, name in enumerate(HEADERS, start=1):
        ws.cell(row=row, column=col, value=name).font = HEADER_FONT


def _status(r: ResultRow) -> str:
    """Why a row has no numbers, in the file rather than only in the app.

    A failed point used to export as blank power and blank current, which is
    indistinguishable from one that simply did not measure.
    """
    if r.error:
        return r.error
    return "ok" if r.ok else f"status={r.status}"


def _row_values(r: ResultRow) -> list[Any]:
    """Order must match HEADERS — the two are asserted against each other in
    backend/tests/test_sweep.py."""
    return [
        r.idx + 1,
        r.power_dbm_setting,
        _hex_byte(r.pa_duty_cycle),
        _hex_byte(r.hp_max),
        r.tx_power_dbm,
        # The uncorrected reading. `ResultRow` keeps it so a wrong path loss can
        # be undone after the fact, but that was useless while it stayed out of
        # the file the results actually leave in.
        r.tx_power_dbm_raw,
        _milliamps(r.current_a),
        _volts(r.voltage_v),
        _status(r),
    ]


def _write_sheet(ws: Worksheet, rows: Iterable[ResultRow]) -> None:
    _write_header(ws)
    for i, r in enumerate(rows, start=1):
        for col, value in enumerate(_row_values(r), start=1):
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


def _int_from_cell(value: Any, field: str, row: int) -> int:
    """Accept the hex bytes we write (`0x07`) as well as plain integers."""
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    try:
        return int(text, 16) if text.lower().startswith("0x") else int(float(text))
    except ValueError:
        raise ValueError(f"row {row}: {field} is not a number ({value!r})") from None


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_workbook(data: bytes) -> list[ResultRow]:
    """Read back a workbook this module wrote.

    The inverse of `build_workbook`, kept beside it so the column order cannot
    drift between the two. Only the "All" sheet is read — the bucket sheets hold
    the same rows in a different order, so importing them too would duplicate
    every point.

    Fields the workbook does not carry (`tx_hex`, `rx_hex`, `t_ms`) come back
    empty; `freq_hz` is recovered from the Run sheet when the file has one.
    """
    from openpyxl import load_workbook  # local: only importing pays for it

    wb = load_workbook(BytesIO(data), data_only=True)
    if "All" not in wb.sheetnames:
        raise ValueError(
            "no 'All' sheet — this is not a sweep workbook exported by this app"
        )
    ws = wb["All"]

    # Located by name, not by position. The column order changed once already
    # -- to follow the configuration rather than the runner's loop nesting --
    # and a file written before that must still import. Matching on the header
    # text makes the order a presentation choice instead of a format promise.
    header = [c.value for c in ws[1]]
    at = {str(name): i for i, name in enumerate(header) if name is not None}
    missing = [h for h in HEADERS if h not in at]
    if missing:
        raise ValueError(
            f"missing columns: {missing}. Found {[h for h in header if h]}. "
            "The file was exported by a different version of this app."
        )

    freq_hz = 0
    if "Run" in wb.sheetnames:
        for label, value in wb["Run"].iter_rows(min_row=2, values_only=True):
            if label == "Frequency [MHz]" and value is not None:
                freq_hz = int(round(float(value) * 1e6))
                break

    idx_c = at["#"]
    set_c = at["Power Set [dBm]"]
    duty_c = at["PA DC"]
    hp_c = at["HP Max"]
    meas_c = at["Measured [dBm]"]
    raw_c = at["Raw [dBm]"]
    cc_c = at["CC [mA]"]
    volt_c = at["V [V]"]
    status_c = at["Status"]
    rows: list[ResultRow] = []
    for n, values in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if values[idx_c] is None:
            continue  # trailing blank row
        status_text = str(values[status_c] or "").strip()
        ok = status_text.lower() == "ok"
        cc_ma = _float_or_none(values[cc_c])
        rows.append(
            ResultRow(
                # Stored 1-based for readability; `idx` is 0-based.
                idx=_int_from_cell(values[idx_c], "#", n) - 1,
                freq_hz=freq_hz,
                power_dbm_setting=_int_from_cell(values[set_c], "Power Set [dBm]", n),
                pa_duty_cycle=_int_from_cell(values[duty_c], "PA DC", n),
                hp_max=_int_from_cell(values[hp_c], "HP Max", n),
                tx_power_dbm=_float_or_none(values[meas_c]),
                tx_power_dbm_raw=_float_or_none(values[raw_c]),
                current_a=None if cc_ma is None else cc_ma / 1000.0,
                voltage_v=_float_or_none(values[volt_c]),
                tx_hex="",
                rx_hex="",
                ok=ok,
                status=0 if ok else -1,
                # Anything that is not a plain "ok" was the reason the row had no
                # numbers, so it travels back as the error.
                error=None if ok else (status_text or None),
                t_ms=0,
            )
        )
    return rows


_PA_MODE_NAMES = {0: "OFF", 1: "ON", 2: "AUTO"}


def _describe_values(values: list[int]) -> str:
    """"0–7 (8 values)" for a contiguous run, an explicit list otherwise."""
    if not values:
        return "(none)"
    ordered = sorted(values)
    contiguous = ordered == list(range(ordered[0], ordered[-1] + 1))
    if contiguous and len(ordered) > 2:
        return f"{ordered[0]}–{ordered[-1]} ({len(ordered)} values)"
    return ", ".join(str(v) for v in ordered)


def _stamp(epoch: float | None) -> str:
    return "—" if epoch is None else time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch))


def _write_run_sheet(
    ws: Worksheet,
    cfg: SweepConfig,
    row_count: int,
    started_at: float | None,
    finished_at: float | None,
) -> None:
    """Label/value pairs — read top to bottom, not a table."""
    entries: list[tuple[str, Any]] = [
        ("Frequency [MHz]", round(cfg.freq_hz / 1e6, 4)),
        ("Path loss [dB]", cfg.path_loss_db),
        ("Settle [ms]", cfg.settle_ms),
        ("PA mode", f"{_PA_MODE_NAMES.get(cfg.pa_mode, '?')} ({cfg.pa_mode})"),
        ("Command timeout [s]", cfg.cmd_timeout_s),
    ]
    # A multi-block plan cannot be described by three lines of values -- the
    # whole point of it is that the axes do not apply uniformly -- so each
    # block gets its own row. A single-block plan keeps the flat form it has
    # always had rather than growing a "Block 1" label for no reason.
    blocks = cfg.effective_blocks
    if len(blocks) == 1:
        entries += [
            ("Power Set values", _describe_values(blocks[0].power_values)),
            ("PA DC values", _describe_values(blocks[0].duty_values)),
            ("HP Max values", _describe_values(blocks[0].hp_values)),
        ]
    else:
        for n, b in enumerate(blocks, start=1):
            entries.append((
                f"Block {n}",
                f"Power {_describe_values(b.power_values)}"
                f" · PA DC {_describe_values(b.duty_values)}"
                f" · HP Max {_describe_values(b.hp_values)}"
                f" · {b.steps} steps",
            ))
    entries += [
        ("Steps planned", cfg.total_steps),
        ("Rows recorded", row_count),
        ("Started", _stamp(started_at)),
        ("Finished", _stamp(finished_at)),
    ]
    ws.cell(row=1, column=1, value="Setting").font = HEADER_FONT
    ws.cell(row=1, column=2, value="Value").font = HEADER_FONT
    for i, (label, value) in enumerate(entries, start=2):
        ws.cell(row=i, column=1, value=label).font = HEADER_FONT
        ws.cell(row=i, column=2, value=value)
    _autosize(ws)


def build_workbook(
    rows: Iterable[ResultRow],
    config: SweepConfig | None = None,
    started_at: float | None = None,
    finished_at: float | None = None,
) -> bytes:
    """Render sweep rows to an .xlsx file, returned as bytes.

    `config` is optional so callers that only have rows — tests, and any future
    re-export of stored results — still get a valid workbook, just without the
    Run sheet.
    """
    rows = list(rows)
    wb = Workbook()

    ws_all = wb.active
    ws_all.title = "All"
    _write_sheet(ws_all, rows)

    # Right after "All" rather than last: appended behind a dozen bucket sheets
    # it would not be found. "All" stays the sheet the file opens on.
    if config is not None:
        _write_run_sheet(
            wb.create_sheet(title="Run", index=1), config, len(rows), started_at, finished_at,
        )

    buckets = _bucket_by_measured_power(rows)
    for bucket in sorted(buckets, reverse=True):
        subset = sorted(buckets[bucket], key=lambda r: abs((r.tx_power_dbm or 0.0) - bucket))
        _write_sheet(wb.create_sheet(title=f"{bucket} dBm"), subset)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
