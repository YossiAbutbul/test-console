"""A product report as sheets: one per test type, one table each.

The report page draws exactly this (GET /reports/{pid}/sheets) and the Excel
export writes it (GET /reports/{pid}/export.xlsx), so what the operator reads
in the app and what they send on are the same tables.

Runs of one test type share a sheet and a table. What tells their rows apart
-- the unit (MAC and its nickname), which run it was and when, and the run's
own settings -- is written as columns in front of the test's results, so
rows from different units or settings sit side by side and can be filtered.
MAC is a column on every sheet, even one unit's: a sheet reads the same whether
it holds one unit or ten, and a filter on it never has to be added later.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from pydantic import BaseModel

from .. import workbook as wbk
from .models import Cell, Entry, Product

#: The sheet (tab) name per test slug. A slug not listed is named by its
#: run's title. The slugs are each test page's "Add to report" `test:`.
SHEET_NAMES: dict[str, str] = {
    "tx-cw-automation": "LoRa CW",
    "lora-modulated-automation": "LoRa Modulated",
    "frequency-accuracy": "LoRa Freq accuracy",
    "lte-cw-automation": "LTE CW",
    "lte-modulated-automation": "LTE Modulated",
    "lte-frequency-accuracy": "LTE Freq accuracy",
    "ble-cw-automation": "BLE CW",
}

#: The columns in front of every test's own, in this order.
RUN_COLUMNS = ["MAC", "Unit", "Run", "Added"]
#: Settings left out of the tables: the operator found Settle noise -- it is
#: the same on nearly every run and says nothing about the unit.
HIDDEN_SETTINGS = {"Settle"}

SUMMARY_SHEET = "Summary"
SUMMARY_COLUMNS = ["Run", "Test", "MAC", "Unit", "Added", "Points", "Passed", "Failed", "Result"]

#: Excel refuses these in a sheet name, and caps it at 31 characters.
_BAD_SHEET_CHARS = set('[]:*?/\\')
_SHEET_MAX = 31


class Sheet(BaseModel):
    #: The test slug this sheet holds.
    test: str
    #: The tab's name, unique in the workbook and valid in Excel.
    name: str
    #: The runs' own title, e.g. "LoRa CW automation".
    title: str
    #: Run ids on this sheet, in report order.
    entry_ids: list[str]
    columns: list[str]
    rows: list[list[Cell]]


class ReportSheets(BaseModel):
    product: str
    notes: str
    #: [label, value] lines above the summary table.
    facts: list[tuple[str, str]]
    summary_columns: list[str]
    summary_rows: list[list[Cell]]
    sheets: list[Sheet]


def _sheet_name(raw: str, taken: set[str]) -> str:
    base = "".join("-" if c in _BAD_SHEET_CHARS else c for c in raw).strip().strip("'") or "Test"
    base = base[:_SHEET_MAX]
    name, n = base, 2
    # Excel compares sheet names ignoring case.
    while name.lower() in taken:
        tail = f" ({n})"
        name = base[:_SHEET_MAX - len(tail)] + tail
        n += 1
    taken.add(name.lower())
    return name


def unit_label(e: Entry) -> str:
    return e.dut.nickname or e.dut.name or ""


def _added(e: Entry) -> str:
    # Stored as ISO seconds ("2026-11-16T13:30:05"): a space reads better in a
    # cell, and the text stays sortable.
    return e.added_at.replace("T", " ")


def _merge(order: list[str], names: list[str]) -> None:
    """Append the names not yet in `order`, keeping first-seen order."""
    for n in names:
        if n not in order:
            order.append(n)


def build_sheets(prod: Product) -> ReportSheets:
    entries = prod.entries
    number = {e.id: i for i, e in enumerate(entries, start=1)}

    groups: dict[str, list[Entry]] = {}
    for e in entries:
        groups.setdefault(e.test, []).append(e)

    taken = {SUMMARY_SHEET.lower()}
    sheets: list[Sheet] = []
    for test, runs in groups.items():
        setting_names: list[str] = []
        result_names: list[str] = []
        for e in runs:
            _merge(setting_names, [k for k, _ in e.settings if k not in HIDDEN_SETTINGS])
            _merge(result_names, e.columns)
        # A setting or result named like a run column (or each other) would
        # make two columns one; the later one is told apart by what it is.
        fixed = set(RUN_COLUMNS)
        setting_cols = [f"{s} (setting)" if s in fixed else s for s in setting_names]
        fixed |= set(setting_cols)
        result_cols = [f"{c} (result)" if c in fixed else c for c in result_names]

        rows: list[list[Cell]] = []
        for e in runs:
            settings = dict(e.settings)
            head: list[Cell] = [e.dut.mac or "", unit_label(e), number[e.id], _added(e)]
            mid: list[Cell] = [settings.get(s, "") for s in setting_names]
            at = {c: i for i, c in enumerate(e.columns)}
            for r in e.rows:
                tail: list[Cell] = [r[at[c]] if c in at and at[c] < len(r) else None for c in result_names]
                rows.append(head + mid + tail)

        sheets.append(Sheet(
            test=test,
            name=_sheet_name(SHEET_NAMES.get(test) or runs[0].title, taken),
            title=runs[0].title,
            entry_ids=[e.id for e in runs],
            columns=RUN_COLUMNS + setting_cols + result_cols,
            rows=rows,
        ))

    macs = sorted({e.dut.mac for e in entries if e.dut.mac})
    dates = sorted(e.added_at[:10] for e in entries)
    facts: list[tuple[str, str]] = [("Product", prod.name)]
    if prod.notes:
        facts.append(("Notes", prod.notes))
    facts += [
        ("Runs", str(len(entries))),
        ("Units", ", ".join(macs) or "—"),
        ("Period", (dates[0] if dates[0] == dates[-1] else f"{dates[0]} – {dates[-1]}") if dates else "—"),
    ]
    sheet_of = {e.id: s.name for s in sheets for e in groups[s.test]}
    summary_rows: list[list[Cell]] = [
        [number[e.id], sheet_of[e.id], e.dut.mac or "", unit_label(e), _added(e),
         e.summary.points, e.summary.passed, e.summary.failed, e.summary.result]
        for e in entries
    ]
    return ReportSheets(
        product=prod.name, notes=prod.notes, facts=facts,
        summary_columns=SUMMARY_COLUMNS, summary_rows=summary_rows, sheets=sheets,
    )


# --- workbook --------------------------------------------------------------

TITLE_FONT = Font(bold=True, size=12)
_WIDE = {"MAC": 16, "Added": 20, "Unit": 14, "Test": 20}


def _write_table(ws: Any, columns: list[str], rows: list[list[Cell]], top: int) -> None:
    wbk.write_header(ws, columns, row=top)
    for r, row in enumerate(rows, start=top + 1):
        for c, v in enumerate(row, start=1):
            wbk.write_cell(ws, r, c, v, columns[c - 1])
    wbk.set_widths(ws, columns)
    # Wider than their headers: a 12-digit MAC, a date and time, a nickname.
    for name, width in _WIDE.items():
        if name in columns:
            ws.column_dimensions[get_column_letter(columns.index(name) + 1)].width = width
    last = top + len(rows)
    if columns:
        ws.auto_filter.ref = f"A{top}:{get_column_letter(len(columns))}{max(last, top)}"
    for name in ("Verdict", "Result"):
        if name in columns:
            _flag_fail(ws, columns.index(name) + 1, top + 1, last)


def _flag_fail(ws: Any, col: int, first: int, last: int) -> None:
    """The workbooks' red on a failed verdict, as a rule so an edited cell
    follows (see backend/workbook.py's flag_bad_status)."""
    if last < first:
        return
    letter = get_column_letter(col)
    ref = f"${letter}{first}"
    ws.conditional_formatting.add(
        f"{letter}{first}:{letter}{last}",
        FormulaRule(formula=[f'LEFT(LOWER({ref}),4)="fail"'], fill=wbk.BAD_FILL, font=wbk.BAD_FONT),
    )


def build_xlsx(prod: Product, app_version: str) -> bytes:
    rs = build_sheets(prod)
    wb = Workbook()
    ws = wb.active
    ws.title = SUMMARY_SHEET
    ws.cell(row=1, column=1, value=f"{rs.product} — test report").font = TITLE_FONT
    facts = rs.facts + [("App version", app_version)]
    for i, (k, v) in enumerate(facts, start=2):
        ws.cell(row=i, column=1, value=k).font = wbk.HEADER_FONT
        ws.cell(row=i, column=2, value=v)
    top = len(facts) + 3
    _write_table(ws, rs.summary_columns, rs.summary_rows, top)
    ws.freeze_panes = f"A{top + 1}"

    for s in rs.sheets:
        ws = wb.create_sheet(s.name)
        _write_table(ws, s.columns, s.rows, 1)
        # Header and the MAC column stay in view on a wide table.
        ws.freeze_panes = "B2"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
