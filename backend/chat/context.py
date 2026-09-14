"""Turning measurement tables into the fewest tokens that still answer questions.

A run's rows go to the model as *text*, and text costs quota, so nothing is
sent raw. Three things do the work:

* columns that never vary are lifted out of the table and stated once
  ("freq_mhz=868.0"), which on a typical sweep export is most of the width;
* every numeric column gets a min/max/mean/missing line, so a question about
  the shape of the data can be answered from the summary even when the rows
  themselves were sampled;
* the rows are TSV, not JSON, so there is no repeated key per cell, which is
  roughly a 3x saving on a wide table.

If it still does not fit, rows are sampled evenly (never truncated from the
end, since the tail of a sweep is usually the interesting part) and the header
says so, so the model knows not to claim completeness.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

#: Wider than this and the extra columns are named but not printed.
MAX_COLS = 40
#: Rows printed before sampling kicks in.
DEFAULT_MAX_ROWS = 120


@dataclass
class Table:
    name: str
    rows: list[dict[str, Any]]
    columns: list[str] = field(default_factory=list)


def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _num(v: Any) -> float | None:
    """The value as a float, or None when it is not a plain number.

    Strings are included because a CSV round-trip turns every number into one,
    and a column that reads as text would lose its stats for no reason.
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and not math.isfinite(v) else float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if not s:
            return None
        try:
            f = float(s)
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


def fmt(v: Any) -> str:
    """Compact rendering of one cell.

    Floats lose their trailing zeros and stop at 6 significant figures: the
    instruments do not report more than that, and `-12.340000000000001` is
    three tokens of noise.
    """
    if _is_blank(v):
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    f = _num(v)
    if f is None:
        return re.sub(r"\s+", " ", str(v)).strip()
    if f == int(f) and abs(f) < 1e15:
        return str(int(f))
    return f"{f:.6g}"


def _columns_of(rows: Sequence[dict[str, Any]], given: Sequence[str] | None) -> list[str]:
    if given:
        return list(given)
    seen: dict[str, None] = {}
    for r in rows:
        for k in r:
            seen.setdefault(k, None)
    return list(seen)


def _stats_line(col: str, values: list[Any]) -> str | None:
    nums = [n for n in (_num(v) for v in values) if n is not None]
    if len(nums) < 2:
        return None
    lo, hi = min(nums), max(nums)
    mean = sum(nums) / len(nums)
    missing = sum(1 for v in values if _is_blank(v))
    line = f"{col}: min={fmt(lo)} max={fmt(hi)} mean={fmt(round(mean, 6))} n={len(nums)}"
    if missing:
        line += f" missing={missing}"
    return line


def _sample(rows: Sequence[Any], limit: int) -> tuple[list[Any], bool]:
    """Evenly spaced subset, first and last row always kept."""
    if len(rows) <= limit:
        return list(rows), False
    step = (len(rows) - 1) / (limit - 1)
    idx = sorted({int(round(i * step)) for i in range(limit)} | {0, len(rows) - 1})
    return [rows[i] for i in idx], True


def compact_table(table: Table, *, budget: int, max_rows: int = DEFAULT_MAX_ROWS) -> str:
    """Render one table as the compact text block described in the module docstring."""
    rows = table.rows
    cols = _columns_of(rows, table.columns)
    if not rows:
        return f"### {table.name}\n(no rows)\n"

    # Drop the empty, lift out the constant.
    kept: list[str] = []
    constants: list[str] = []
    for c in cols:
        values = [r.get(c) for r in rows]
        if all(_is_blank(v) for v in values):
            continue
        distinct = {fmt(v) for v in values}
        if len(distinct) == 1 and len(rows) > 1:
            constants.append(f"{c}={distinct.pop()}")
        else:
            kept.append(c)

    dropped_cols: list[str] = []
    if len(kept) > MAX_COLS:
        dropped_cols = kept[MAX_COLS:]
        kept = kept[:MAX_COLS]

    out = io.StringIO()
    out.write(f"### {table.name} - {len(rows)} rows x {len(cols)} columns\n")
    if constants:
        out.write("same on every row: " + ", ".join(constants) + "\n")
    if dropped_cols:
        out.write("columns omitted for width: " + ", ".join(dropped_cols) + "\n")

    stats = [s for s in (_stats_line(c, [r.get(c) for r in rows]) for c in kept) if s]
    if stats:
        out.write("summary:\n" + "\n".join("  " + s for s in stats) + "\n")

    if not kept:
        return out.getvalue()

    shown, sampled = _sample(rows, max_rows)
    # Shrink the sample until the block fits rather than cutting it off
    # mid-row: half a row of numbers reads as a measurement and would be
    # quoted back as one.
    while True:
        body = io.StringIO()
        body.write("\t".join(kept) + "\n")
        for r in shown:
            body.write("\t".join(fmt(r.get(c)) for c in kept) + "\n")
        text = body.getvalue()
        if len(out.getvalue()) + len(text) <= budget or len(shown) <= 4:
            break
        shown, _ = _sample(shown, max(4, len(shown) // 2))
        sampled = True

    if sampled:
        out.write(f"rows (TSV, {len(shown)} of {len(rows)} sampled evenly):\n")
    else:
        out.write("rows (TSV, all of them):\n")
    out.write(text)
    return out.getvalue()


# -- attachments ---------------------------------------------------------

def _rows_from_matrix(name: str, matrix: list[list[Any]]) -> Table | None:
    """Read a sheet-shaped block of cells as a header row plus data rows."""
    matrix = [r for r in matrix if any(not _is_blank(c) for c in r)]
    if not matrix:
        return None
    header = matrix[0]
    body = matrix[1:]
    # A sheet whose first row is not really a header (the Run sheet of our
    # exports is key/value pairs) still reads fine as a two-column table, so
    # the only thing worth fixing here is a blank or repeated column name.
    cols = [(fmt(h) or f"col{i + 1}") for i, h in enumerate(header)]
    seen: dict[str, int] = {}
    for i, c in enumerate(cols):
        if c in seen:
            seen[c] += 1
            cols[i] = f"{c}.{seen[c]}"
        else:
            seen[c] = 0
    rows = [
        {cols[i]: (r[i] if i < len(r) else None) for i in range(len(cols))}
        for r in body
    ]
    if not rows:
        rows = [{c: None for c in cols}]
    return Table(name=name, rows=rows, columns=cols)


def parse_csv(data: bytes, name: str) -> list[Table]:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        dialect: Any = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    matrix = [list(r) for r in csv.reader(io.StringIO(text), dialect)]
    table = _rows_from_matrix(name, matrix)
    return [table] if table else []


def parse_xlsx(data: bytes, name: str) -> list[Table]:
    # Imported here rather than at module scope so the chat still loads on a
    # checkout without openpyxl; only attachments would fail.
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    tables: list[Table] = []
    try:
        for ws in wb.worksheets:
            matrix = [list(row) for row in ws.iter_rows(values_only=True)]
            table = _rows_from_matrix(f"{name} / {ws.title}", matrix)
            if table:
                tables.append(table)
    finally:
        wb.close()
    return tables


def parse_upload(data: bytes, filename: str) -> list[Table]:
    lower = filename.lower()
    if lower.endswith((".xlsx", ".xlsm")):
        return parse_xlsx(data, filename)
    if lower.endswith((".csv", ".tsv", ".txt")):
        return parse_csv(data, filename)
    raise ValueError(
        f"Unsupported file type: {filename}. Attach .xlsx, .xlsm, .csv or .tsv."
    )


def digest_upload(data: bytes, filename: str, *, budget: int) -> str:
    """One attached file as a single compact text block.

    The budget is split across the sheets rather than spent first-come, so a
    workbook whose first sheet is enormous does not starve the others.
    """
    tables = parse_upload(data, filename)
    if not tables:
        return f"### {filename}\n(empty file)\n"
    share = max(800, budget // len(tables))
    parts = [compact_table(t, budget=share) for t in tables]
    return "\n".join(parts)[:budget]


def join_blocks(blocks: Iterable[str], *, budget: int) -> str:
    """Concatenate context blocks, stopping cleanly at the overall budget."""
    out: list[str] = []
    used = 0
    for b in blocks:
        if not b:
            continue
        if used + len(b) > budget:
            out.append("(further context omitted to stay inside the token budget)")
            break
        out.append(b)
        used += len(b)
    return "\n\n".join(out)
