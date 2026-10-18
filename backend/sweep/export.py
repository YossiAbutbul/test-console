"""Excel export for sweep results.

Workbook layout:
- "All" sheet: every row, in sweep order.
- "Run" sheet: the config the sweep ran with. Without it a saved workbook could
  not say which path loss or settle time produced its numbers, so two files with
  different corrections were indistinguishable once they left the app. It also
  carries a short summary, the rig (DUT, instrument IDNs and addresses) and when
  and by which build the file was written.
- "Best settings" sheet: one row per measured power bucket, holding the
  combination that reached it for the least current -- the same table the app's
  Best settings view shows (`frontend/src/tests/powerSweep/bestSettings.ts`).
- One sheet per *measured* power bucket, named "<N> dBm", holding the rows whose
  measured power rounds to N. Sheets run from the highest bucket down; within a
  sheet, rows run from closest to the bucket's nominal value outwards.

Presentation (header style, frozen panes, filters, two-decimal display, the red
Status rule) comes from `backend/workbook.py`, shared with the load-pull export.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any, Callable, Iterable

from openpyxl import Workbook
from openpyxl.worksheet.worksheet import Worksheet

from .. import workbook as wbk
from .models import ResultRow, RigInfo, SweepConfig

# "#" is the sweep index, not the row's position in this sheet: a bucket sheet
# reorders its rows, so a per-sheet counter matched nothing in the All sheet or
# in the app's results table and a row could not be traced between them.
#
# "Set" vs "Measured": the old pair was "Power" and "Power [dBm]", which read as
# though the *second* one was the commanded value. Both carry their unit now.
# "Set [dBm]" was "Power Set [dBm]" until the sweep, load-pull and CSV exports
# were given one vocabulary; `HEADER_ALIASES` keeps those files importing.
# Column order follows the sweep's own configuration -- Power, PA DC, HP Max --
# so a row reads in the order the run was set up. It used to be the reverse of
# that, which is the runner's nesting order (hp outermost) rather than anything
# the operator sees.
#
# Order is not part of the file format: `parse_workbook` matches on the header
# text, so a workbook written before this change still imports.
HEADERS = [
    "#", "Set [dBm]", "PA DC", "HP Max", "Measured [dBm]", "Raw [dBm]",
    "CC [mA]", "V [V]", "Status",
]
#: Earlier spellings of a header, accepted on import so files exported before a
#: rename still read back.
HEADER_ALIASES = {"Set [dBm]": ("Power Set [dBm]",)}

# Readings at or below this are the sensor's under-range sentinel, not a real
# measurement, so they get no bucket of their own.
UNDER_RANGE_DBM = -50.0


def _milliamps(current_a: float | None) -> float | None:
    # Not rounded: the cell format shows two decimals, the cell keeps the
    # reading. See backend/workbook.py.
    return None if current_a is None else current_a * 1000.0


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
        # Plain integers, not the "0x03" text they used to be: text cannot be
        # filtered or sorted numerically. `_int_from_cell` still reads the hex
        # form, so older files import.
        r.pa_duty_cycle,
        r.hp_max,
        r.tx_power_dbm,
        # The uncorrected reading. `ResultRow` keeps it so a wrong path loss can
        # be undone after the fact, but that was useless while it stayed out of
        # the file the results actually leave in.
        r.tx_power_dbm_raw,
        _milliamps(r.current_a),
        # Supply voltage beside the current, so a row carries the power it drew
        # rather than only half of it.
        r.voltage_v,
        _status(r),
    ]


def _write_sheet(ws: Worksheet, rows: Iterable[ResultRow], *, scale_current: bool) -> None:
    """`scale_current` colours CC [mA] -- on a bucket sheet, where every row
    reached the same power and the cheapest is what is being looked for. On All
    the powers differ, so a colour scale there would only rank drive levels."""
    wbk.write_header(ws, HEADERS)
    n = 0
    for n, r in enumerate(rows, start=1):
        for col, value in enumerate(_row_values(r), start=1):
            wbk.write_cell(ws, n + 1, col, value, HEADERS[col - 1])
    wbk.finish_table(ws, HEADERS, n)
    wbk.flag_bad_status(ws, HEADERS.index("Status") + 1, 2, n + 1)
    if scale_current:
        wbk.current_scale(ws, HEADERS.index("CC [mA]") + 1, 2, n + 1)


def _bucket_by_measured_power(rows: Iterable[ResultRow]) -> dict[int, list[ResultRow]]:
    """Group rows by round(measured dBm), dropping unmeasured/under-range ones."""
    buckets: dict[int, list[ResultRow]] = {}
    for r in rows:
        if r.tx_power_dbm is None or r.tx_power_dbm < UNDER_RANGE_DBM:
            continue
        buckets.setdefault(int(round(r.tx_power_dbm)), []).append(r)
    return buckets


BEST_HEADERS = ["Level [dBm]", *HEADERS, "Rows at level"]


def _cheapest(rows: list[ResultRow]) -> ResultRow | None:
    """Lowest-current row, or None if none of them reported a current.

    Must agree with `buildLevels` in bestSettings.ts: a missing current is not a
    low one, so those rows are never picked, and ties go to the earlier row in
    sweep order (JS sort is stable; `min` keeps the first of equals).
    """
    measured = [r for r in rows if r.current_a is not None]
    return min(measured, key=lambda r: r.current_a) if measured else None


def _write_best_sheet(ws: Worksheet, buckets: dict[int, list[ResultRow]]) -> None:
    wbk.write_header(ws, BEST_HEADERS)
    status_col = BEST_HEADERS.index("Status") + 1
    last = 1
    for last, level in enumerate(sorted(buckets, reverse=True), start=2):
        group = buckets[level]
        best = _cheapest(group)
        wbk.write_cell(ws, last, 1, level)
        ws.cell(row=last, column=1).font = wbk.HEADER_FONT
        if best is None:
            # Kept rather than dropped: the level was reached, the file should
            # say so, and say why it has no recommendation.
            ws.cell(row=last, column=status_col, value="no current reading")
        else:
            for col, value in enumerate(_row_values(best), start=2):
                wbk.write_cell(ws, last, col, value, BEST_HEADERS[col - 1])
        wbk.write_cell(ws, last, len(BEST_HEADERS), len(group))
    wbk.finish_table(ws, BEST_HEADERS, last - 1)
    wbk.flag_bad_status(ws, status_col, 2, last)
    wbk.current_scale(ws, BEST_HEADERS.index("CC [mA]") + 1, 2, last)


def _int_from_cell(value: Any, field: str, row: int) -> int:
    """Accept the hex bytes older exports wrote (`0x07`) as well as plain integers."""
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
    for name, old in HEADER_ALIASES.items():
        for alias in old:
            if name not in at and alias in at:
                at[name] = at[alias]
    missing = [h for h in HEADERS if h not in at]
    if missing:
        raise ValueError(
            f"missing columns: {missing}. Found {[h for h in header if h]}. "
            "The file was exported by a different version of this app."
        )

    freq_hz = 0
    if "Run" in wb.sheetnames:
        for label, value, *_ in wb["Run"].iter_rows(min_row=2, max_col=2, values_only=True):
            if label == "Frequency [MHz]" and value is not None:
                freq_hz = int(round(float(value) * 1e6))
                break

    idx_c = at["#"]
    set_c = at["Set [dBm]"]
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
                power_dbm_setting=_int_from_cell(values[set_c], "Set [dBm]", n),
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


#: Spelt as the CSV exports and the app spell it (`PA_MODE_LABEL` in
#: frontend/src/tests/power/csv.ts) -- it used to be "OFF"/"ON"/"AUTO" here.
_PA_MODE_NAMES = {0: "Off", 1: "On", 2: "Auto"}


def _describe_values(values: list[int]) -> str:
    """"0–7 (8 values)" for a contiguous run, an explicit list otherwise."""
    if not values:
        return "(none)"
    ordered = sorted(values)
    contiguous = ordered == list(range(ordered[0], ordered[-1] + 1))
    if contiguous and len(ordered) > 2:
        return f"{ordered[0]}–{ordered[-1]} ({len(ordered)} values)"
    return ", ".join(str(v) for v in ordered)


def _write_run_sheet(
    ws: Worksheet,
    cfg: SweepConfig,
    rows: list[ResultRow],
    started_at: float | None,
    finished_at: float | None,
    rig: RigInfo | None,
) -> None:
    """Label/value pairs — read top to bottom, not a table."""
    entries: list[tuple[str, Any]] = [
        ("Frequency [MHz]", cfg.freq_hz / 1e6),
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
        ("Rows recorded", len(rows)),
    ]
    entries += wbk.summary_entries(
        [r.ok for r in rows], (r.tx_power_dbm for r in rows), "Measured",
        started_at, finished_at,
    )
    rig = rig or RigInfo()
    entries += wbk.rig_entries(
        dut_mac=rig.dut_mac, dut_name=rig.dut_name,
        power_sensor_idn=rig.power_sensor_idn, power_sensor_address=rig.power_sensor_address,
        dc_analyzer_idn=rig.dc_analyzer_idn, dc_analyzer_address=rig.dc_analyzer_address,
        dc_channel=rig.dc_channel,
    )
    entries += wbk.export_entries(rig.operator, rig.notes)
    _write_run_entries(ws, entries)


def _read_run_entries(wb: Any) -> list[tuple[Any, Any]] | None:
    """The Run sheet's label/value pairs, exactly as the file holds them."""
    if "Run" not in wb.sheetnames:
        return None
    return [
        (label, value)
        for label, value, *_ in wb["Run"].iter_rows(min_row=2, max_col=2, values_only=True)
        if label is not None
    ]


def _write_run_entries(ws: Worksheet, entries: list[tuple[Any, Any]]) -> None:
    wbk.write_run_entries(ws, entries)


def run_entry(data: bytes, label: str) -> Any:
    """One value off a workbook's Run sheet, or None -- e.g. its DUT MAC, to
    name a re-exported file after the run it holds rather than after now."""
    from openpyxl import load_workbook  # local: only importing pays for it

    entries = _read_run_entries(load_workbook(BytesIO(data), data_only=True)) or []
    return next((v for k, v in entries if k == label), None)


def _assemble(rows: list[ResultRow], write_run: Callable[[Worksheet], None] | None) -> bytes:
    wb = Workbook()

    ws_all = wb.active
    ws_all.title = "All"
    _write_sheet(ws_all, rows, scale_current=False)

    # Right after "All" rather than last: appended behind a dozen bucket sheets
    # it would not be found. "All" stays the sheet the file opens on.
    if write_run is not None:
        write_run(wb.create_sheet(title="Run", index=1))

    buckets = _bucket_by_measured_power(rows)
    # Ahead of the buckets for the same reason as Run: it is the answer the
    # sweep exists for, and behind a dozen bucket sheets it would not be found.
    if buckets:
        _write_best_sheet(wb.create_sheet(title="Best settings"), buckets)

    for bucket in sorted(buckets, reverse=True):
        subset = sorted(buckets[bucket], key=lambda r: abs((r.tx_power_dbm or 0.0) - bucket))
        _write_sheet(wb.create_sheet(title=f"{bucket} dBm"), subset, scale_current=True)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_workbook(
    rows: Iterable[ResultRow],
    config: SweepConfig | None = None,
    started_at: float | None = None,
    finished_at: float | None = None,
    rig: RigInfo | None = None,
) -> bytes:
    """Render sweep rows to an .xlsx file, returned as bytes.

    `config` is optional so callers that only have rows — tests, and any future
    re-export of stored results — still get a valid workbook, just without the
    Run sheet. `rig` fills the Run sheet's Rig and Export sections; without it
    they read "—" rather than being left out, so a reader can tell the file did
    not record them rather than wonder whether the section ever existed.
    """
    rows = list(rows)
    if config is None:
        return _assemble(rows, None)
    return _assemble(
        rows, lambda ws: _write_run_sheet(ws, config, rows, started_at, finished_at, rig),
    )


def rebuild_workbook(data: bytes) -> bytes:
    """Re-export a workbook this module wrote, in the current layout.

    For a file exported before a sheet existed (Best settings, say): the rows
    come back through `parse_workbook` and every derived sheet is rendered
    afresh. The Run sheet is copied as it stands rather than rebuilt -- the file
    does not carry a full `SweepConfig`, and its path loss and settle time are
    exactly what must not be lost or re-guessed on the way through.
    """
    from openpyxl import load_workbook  # local: only importing pays for it

    rows = parse_workbook(data)
    entries = _read_run_entries(load_workbook(BytesIO(data), data_only=True))
    if entries is None:
        return _assemble(rows, None)
    return _assemble(rows, lambda ws: _write_run_entries(ws, entries))
