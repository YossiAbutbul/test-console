"""A product report as a Word document, in the lab's report style.

The style is the lab's own RF reports' (the "Sonata Allegro - SW2233 Antenna
RF Shift" report it was taken from): A4 portrait, 2.54 cm margins, Calibri
with navy (#002060) headings, a cover page -- logo, the product in large
navy display type, the report's subtitle, a photo, "Tested By" and "Date" --
then the logo top-left in the header and a blue page number centred in the
footer, and tables with a light blue (#D9E2F3) header row and black rules.

The document is the report's layout (Product.blocks) printed in order. Runs
are numbered in the order they appear, and the summary lists them in that
order, so "3." in the summary is the third run in the document.

Fonts are named, not embedded, as the reference names them: a PC without
Source Sans Pro (the cover) or Aptos Narrow (tables) shows Word's substitute,
exactly as it does for the reference report.
"""

from __future__ import annotations

import io
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Optional

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .chart_docx import add_chart
from .models import Block, Entry, EntryDut, Product
from .rich import Span, plain, spans, split, strip

NAVY = RGBColor(0x00, 0x20, 0x60)
BLUE = RGBColor(0x44, 0x72, 0xC4)
BLACK = RGBColor(0x00, 0x00, 0x00)
MUTED = RGBColor(0x59, 0x59, 0x59)
PASS = RGBColor(0x1E, 0x7F, 0x3C)
FAIL = RGBColor(0xC0, 0x26, 0x2D)
HEAD_FILL = "D9E2F3"
FAIL_FILL = "FBE9E9"
BORDER = "000000"

BODY_FONT = "Calibri"
TABLE_FONT = "Aptos Narrow"
DISPLAY_FONT = "Source Sans Pro Black"
COVER_FONT = "Source Sans Pro"

PAGE_W, PAGE_H, MARGIN = 21.0, 29.7, 2.54
TEXT_W = PAGE_W - 2 * MARGIN          # 15.92 cm
LOGO_COVER_W, LOGO_HEADER_W = 11.5, 3.4

ImageFile = Callable[[Optional[str]], Optional[Path]]

#: The share of the text width the block being printed may use (its
#: `width`, resized on the page): tables scale their columns by it, and
#: paragraphs and headings take a right indent. Pictures size themselves.
_SCALE: ContextVar[float] = ContextVar("_scale", default=1.0)


def _narrow(p) -> None:
    """A paragraph as narrow as its block was made on the page."""
    sc = _SCALE.get()
    if sc < 0.999:
        p.paragraph_format.right_indent = Cm(TEXT_W * (1 - sc))


# --- small helpers -----------------------------------------------------------

def _when(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso


def _date(iso: str) -> str:
    """The reference's date form: 08.11.2026."""
    try:
        return datetime.fromisoformat(iso).strftime("%d.%m.%Y")
    except ValueError:
        return iso


def unit_label(d: EntryDut) -> str:
    """"Bench 3 (80E127FAA9F9)", or whatever part of that is known."""
    who = d.nickname or d.name
    if who and d.mac:
        return f"{who} ({d.mac})"
    return who or d.mac or "Unknown unit"


def entry_meta(e: Entry) -> str:
    """The line under a run's heading: its unit, when, and who."""
    meta = [f"Unit: {unit_label(e.dut)}", f"Added: {_when(e.added_at)}"]
    if e.operator:
        meta.append(f"Operator: {e.operator}")
    return "    \u00b7    ".join(meta)


def result_detail(e: Entry) -> str:
    s = e.summary
    return (f"{s.points} point{'s' if s.points != 1 else ''}"
            + (f", {s.passed} pass, {s.failed} fail" if s.passed or s.failed else ""))


def _l(labels: dict[str, str], key: str, default: str) -> str:
    """A block's own word for `key`, or the default when it has none. It
    may carry formatting (rich.py); every writer below prints it."""
    v = labels.get(key, "").strip()
    return v if plain(v).strip() else default


def _rich(p, value, font: Optional[str], size: Optional[float] = None, *, bold: Optional[bool] = None,
          color: Optional[RGBColor] = None, italic: Optional[bool] = None) -> None:
    """Words into a paragraph, as runs: the place's font, size, weight and
    colour, except where the words were made bold, italic, underlined or
    coloured on the page.
    With no `font` the paragraph's style decides (a heading's)."""
    runs = value if isinstance(value, list) else spans(value)
    for s in runs:
        r = p.add_run(s.text)
        b = s.bold if s.bold is not None else bold
        c = RGBColor.from_string(s.color) if s.color else color
        if s.underline:
            r.underline = True
        if font:
            _font(r, font, size, bold=b, color=c, italic=True if s.italic else italic)
            continue
        if s.italic:
            r.italic = True
        if size is not None:
            r.font.size = Pt(size)
        if b is not None:
            r.bold = b
        if c is not None:
            r.font.color.rgb = c
        if italic is not None and not s.italic:
            r.italic = italic


def _heading(doc: Document, value: str, style: str):
    p = doc.add_paragraph(style=style)
    _rich(p, value, None)
    return p


def _fill(fills: Optional[tuple[str, dict[str, str]]], key: str) -> Optional[str]:
    """A table row's fill chosen on the page: labels["fill:<table><key>"] --
    "RRGGBB", "none" for no fill at all (a failed row's shade or the header's
    blue taken off too), or None for the row's own."""
    if not fills:
        return None
    v = fills[1].get(f"fill:{fills[0]}{key}", "").strip().lstrip("#")
    if v.lower() == "none":
        return "none"
    return v.upper() if len(v) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in v) else None


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def _font(run, name: str, size: Optional[float] = None, *, bold: Optional[bool] = None,
          color: Optional[RGBColor] = None, italic: Optional[bool] = None) -> None:
    """A run in `name` for every script: python-docx's font.name sets only
    the Latin slots, and Word falls back to the theme font for the rest."""
    run.font.name = name
    rpr = run._r.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    for slot in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        fonts.set(qn(slot), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color


def _style_font(style, name: str) -> None:
    style.font.name = name
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    for slot in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        fonts.set(qn(slot), name)
    # A theme font attribute would win over the named one.
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if fonts.get(qn(attr)) is not None:
            del fonts.attrib[qn(attr)]


def _shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _borders(table, color: str = BORDER) -> None:
    tbl_pr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        b.append(el)
    tbl_pr.append(b)


def _repeat_header(row) -> None:
    """A long table repeats its header row on every page it runs onto."""
    tr_pr = row._tr.get_or_add_trPr()
    h = OxmlElement("w:tblHeader")
    h.set(qn("w:val"), "true")
    tr_pr.append(h)


def _row_height(row, cm: float) -> None:
    """At least this tall: the reference's tables breathe, 0.85 cm a row."""
    tr_pr = row._tr.get_or_add_trPr()
    h = OxmlElement("w:trHeight")
    h.set(qn("w:val"), str(int(cm * 567)))
    h.set(qn("w:hRule"), "atLeast")
    tr_pr.append(h)


def _write(cell, text: str, *, size: float, bold: bool = False, color: Optional[RGBColor] = None,
           align=WD_ALIGN_PARAGRAPH.CENTER) -> None:
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    lines = split(spans(text), "\n") if text else [[]]
    p = cell.paragraphs[0]
    for i, line in enumerate(lines):
        if i:
            p = cell.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        p.alignment = align
        if line:
            _rich(p, line, TABLE_FONT, size, bold=bold, color=color or BLACK)


def _field(paragraph, code: str, size: float, color: RGBColor) -> None:
    """A Word field (PAGE), filled in by Word when it lays the page out."""
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, code), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)
    _font(run, BODY_FONT, size, color=color)


def _result_color(result: str) -> Optional[RGBColor]:
    return PASS if result == "Pass" else FAIL if result == "Fail" else None


def _is_numeric(col: Iterable) -> bool:
    seen = False
    for v in col:
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            return False
        if isinstance(v, (int, float)):
            seen = True
            continue
        try:
            float(str(v))
            seen = True
        except ValueError:
            return False
    return seen


def _table(doc: Document, header: list[str], rows: list[list[str]], *, size: float = 10,
           first_bold: bool = False, first_left: bool = False, widths: Optional[list[float]] = None,
           fail_rows: Optional[list[bool]] = None,
           color_of: Optional[Callable[[int, int], Optional[RGBColor]]] = None,
           fills: Optional[tuple[str, dict[str, str]]] = None) -> None:
    """The reference's table: black rules, a light blue header row, centred
    cells in Aptos Narrow; a parameter table's first column bold and left.
    `fills` is (the table's name, the block's labels): a row filled on the
    page is filled here, over the failed-row shade."""
    t = doc.add_table(rows=1, cols=len(header))
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    _borders(t)
    head_fill = _fill(fills, "_h")
    head_fill = HEAD_FILL if head_fill is None else None if head_fill == "none" else head_fill
    for i, c in enumerate(header):
        cell = t.rows[0].cells[i]
        _write(cell, c, size=size, bold=True)
        if head_fill:
            _shade(cell, head_fill)
    _repeat_header(t.rows[0])
    _row_height(t.rows[0], 0.85)
    for ri, row in enumerate(rows):
        r = t.add_row()
        _row_height(r, 0.85)
        own = _fill(fills, f":{ri}")
        fill = None if own == "none" else own or (FAIL_FILL if fail_rows and fail_rows[ri] else None)
        for ci in range(len(header)):
            v = row[ci] if ci < len(row) else ""
            color = color_of(ri, ci) if color_of else None
            left = (first_bold or first_left) and ci == 0
            _write(r.cells[ci], v, size=size, bold=((first_bold and ci == 0) or color is not None),
                   color=color, align=WD_ALIGN_PARAGRAPH.LEFT if left else WD_ALIGN_PARAGRAPH.CENTER)
            if fill:
                _shade(r.cells[ci], fill)
    if widths:
        sc = _SCALE.get()
        t.autofit = False
        for row in t.rows:
            for cell, w in zip(row.cells, widths):
                cell.width = Cm(w * sc)
    doc.add_paragraph()   # the reference leaves a line under every table


def _para(doc: Document, text: str, size: float = 12, *, bold: bool = False, italic: bool = False,
          color: RGBColor = BLACK, align=None):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    _narrow(p)
    _rich(p, text, BODY_FONT, size, bold=bold, italic=italic, color=color)
    return p


# --- document ----------------------------------------------------------------

def _setup(doc: Document, logo: Optional[Path]) -> None:
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(PAGE_W), Cm(PAGE_H)
    sec.left_margin = sec.right_margin = sec.top_margin = sec.bottom_margin = Cm(MARGIN)
    sec.header_distance = sec.footer_distance = Cm(1.25)
    # The cover is a title page: no header logo, no page number.
    sec.different_first_page_header_footer = True

    normal = doc.styles["Normal"]
    _style_font(normal, BODY_FONT)
    normal.font.size = Pt(11)
    normal.font.color.rgb = BLACK
    normal.paragraph_format.space_after = Pt(8)
    for name, size, before, after in (("Heading 1", 16, 6, 11), ("Heading 2", 13, 6, 6)):
        st = doc.styles[name]
        _style_font(st, BODY_FONT)
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.italic = False
        st.font.color.rgb = NAVY
        st.paragraph_format.space_before = Pt(before)
        st.paragraph_format.space_after = Pt(after)
        st.paragraph_format.keep_with_next = True

    head = sec.header.paragraphs[0]
    head.alignment = WD_ALIGN_PARAGRAPH.LEFT
    # Into the margin, as the reference's logo sits: its left edge 1.7 cm
    # from the page, not lined up with the text.
    head.paragraph_format.left_indent = Cm(-0.85)
    if logo is not None:
        head.add_run().add_picture(str(logo), width=Cm(LOGO_HEADER_W))

    foot = sec.footer.paragraphs[0]
    foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _field(foot, "PAGE", 10, BLUE)


def _cover(doc: Document, prod: Product, b: Block, logo: Optional[Path], image_file: ImageFile) -> None:
    lab = b.labels
    if logo is not None:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(36)
        p.add_run().add_picture(str(logo), width=Cm(LOGO_COVER_W))

    # The product, as large as its name allows on one or two lines.
    name = _l(lab, "title", prod.name)
    n = len(plain(name))
    size = 60 if n <= 16 else 46 if n <= 26 else 36
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    _rich(p, name, DISPLAY_FONT, size, bold=True, color=NAVY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    _rich(p, _l(lab, "subtitle", "RF Test Report"), DISPLAY_FONT, 28, bold=True, color=NAVY)

    path = image_file(b.image_id) if b.image_id else None
    if path is not None:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(str(path), width=Cm(TEXT_W * b.width / 100))

    operators = sorted({e.operator for e in prod.entries if e.operator})
    dates = sorted(e.added_at for e in prod.entries)
    for key, label, value in (
        ("tested_by", "Tested By:", ", ".join(operators)),
        ("date", "Date:", _date(dates[-1]) if dates else datetime.now().strftime("%d.%m.%Y")),
    ):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        _rich(p, _l(lab, f"{key}_label", label), COVER_FONT, 14, bold=True, color=BLACK)
        _rich(p, " " + _l(lab, key, value or "-"), COVER_FONT, 14, color=BLACK)
    # Notes written on the cover before it took the lab's form are kept.
    if prod.notes.strip():
        p = _para(doc, prod.notes.strip(), 12)
        p.paragraph_format.space_before = Pt(12)


def _summary(doc: Document, entries: list[Entry], number: dict[int, int], lab: dict[str, str]) -> None:
    """One row per run, in document order."""
    _heading(doc, _l(lab, "title", "Summary:"), "Heading 2")
    if not entries:
        _para(doc, "No runs have been added to this report yet.", 11, color=MUTED)
        return
    rows = []
    for ri, e in enumerate(entries):
        s = e.summary
        cells = [str(number[id(e)]), e.title, unit_label(e.dut), _when(e.added_at),
                 str(s.points), str(s.passed), str(s.failed), s.result]
        # Every cell can be reworded on the page: "sum:<row>:<col>".
        rows.append([_l(lab, f"sum:{ri}:{ci}", v) for ci, v in enumerate(cells)])
    head = ["#", "Test", "Unit", "Added", "Points", "Pass", "Fail", "Result"]
    _table(doc, [_l(lab, f"sum_h:{ci}", h) for ci, h in enumerate(head)], rows, size=9,
           widths=[0.8, 3.3, 3.8, 3.0, 1.3, 1.1, 1.1, 1.5],
           fail_rows=[e.summary.result == "Fail" for e in entries], fills=("sum", lab),
           color_of=lambda ri, ci: _result_color(entries[ri].summary.result) if ci == 7 else None)


def _entry(doc: Document, n: int, e: Entry, *, new_page: bool,
           show_settings: bool = True, show_note: bool = True,
           lab: Optional[dict[str, str]] = None) -> None:
    lab = lab or {}
    h = _heading(doc, f"{n}. {_l(lab, 'title', e.title)}", "Heading 1")
    h.paragraph_format.page_break_before = new_page
    _narrow(h)

    _para(doc, _l(lab, "meta", entry_meta(e)), 10, color=MUTED)

    s = e.summary
    p = doc.add_paragraph()
    _rich(p, _l(lab, "result_label", "Result:") + " ", BODY_FONT, 12, bold=True)
    _rich(p, _l(lab, "result", s.result if s.result != "-" else "not judged"), BODY_FONT, 12, bold=True,
          color=_result_color(s.result) or BLACK)
    _rich(p, "    " + _l(lab, "result_detail", result_detail(e)), BODY_FONT, 12)

    if show_note and e.note.strip():
        _para(doc, _l(lab, "note", e.note.strip()), 12, italic=True)

    if show_settings and e.settings:
        _heading(doc, _l(lab, "settings", "Settings:"), "Heading 2")
        _table(doc, [_l(lab, "set_h:0", "Parameter"), _l(lab, "set_h:1", "Value")],
               [[_l(lab, f"set:{ri}:0", k), _l(lab, f"set:{ri}:1", v)] for ri, (k, v) in enumerate(e.settings)],
               first_bold=True, widths=[5.0, 8.7], fills=("set", lab))

    _heading(doc, _l(lab, "results", "Results:"), "Heading 2")
    if not e.rows:
        _para(doc, "No rows.", 11, color=MUTED)
        return
    cols = e.columns
    vi = next((i for i, c in enumerate(cols) if c.strip().lower() == "verdict"), None)

    def verdict(row) -> str:
        return str(row[vi]).strip().lower() if vi is not None and vi < len(row) and row[vi] is not None else ""

    rows = [[_l(lab, f"res:{ri}:{i}",
                (_cell_text(row[i]).capitalize() if i == vi else _cell_text(row[i] if i < len(row) else None)))
             for i in range(len(cols))] for ri, row in enumerate(e.rows)]
    cols = [_l(lab, f"res_h:{i}", c) for i, c in enumerate(cols)]
    # Portrait leaves 16 cm: a fourteen-column table needs the smaller type.
    size = 10 if len(cols) <= 6 else 9 if len(cols) <= 9 else 7.5
    _table(doc, cols, rows, size=size, widths=[TEXT_W / len(cols)] * len(cols),
           fail_rows=[verdict(r).startswith("fail") for r in e.rows], fills=("res", lab),
           color_of=lambda ri, ci: (PASS if verdict(e.rows[ri]).startswith("pass") else
                                    FAIL if verdict(e.rows[ri]).startswith("fail") else None) if ci == vi else None)


def _units(doc: Document, prod: Product, lab: dict[str, str]) -> None:
    """The units the runs were measured on: one cell, one per line, as the
    reference lists its unit IDs."""
    units: list[str] = []
    for e in prod.entries:
        u = unit_label(e.dut)
        if u not in units:
            units.append(u)
    _table(doc, [_l(lab, "col1", "Parameter"), _l(lab, "col2", "Value")],
           [[_l(lab, "row", "Unit IDs"), _l(lab, "units", "\n".join(units) or "-")]], first_left=True, widths=[6.9, 9.0],
           fills=("units", lab))


def _image(doc: Document, b: Block, image_file: ImageFile) -> None:
    """A picture at the block's share of the text width, centred, its
    caption under it in 9 pt as the reference captions its charts."""
    path = image_file(b.image_id) if b.image_id else None
    if path is None:
        return   # an empty picture block prints nothing
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Cm(TEXT_W * b.width / 100))
    if plain(b.text).strip():
        _para(doc, b.text.strip(), 9, align=WD_ALIGN_PARAGRAPH.CENTER)


def _text(doc: Document, text: str) -> None:
    """The operator's text: a blank line starts a new paragraph."""
    for para in split(spans(text), "\n\n"):
        runs: list[Span] = strip(para)
        if runs:
            _para(doc, runs, 12)


def document_order(prod: Product) -> list[tuple[Block, Entry]]:
    """Every run the layout prints, in the order it prints them: an entry
    block's run where it stands, an "All runs" block's runs (those placed
    nowhere else) where it stands."""
    by_id = {e.id: e for e in prod.entries}
    placed = {b.entry_id for b in prod.blocks if b.type == "entry"}
    out: list[tuple[Block, Entry]] = []
    for b in prod.blocks:
        if b.type == "entry" and b.entry_id in by_id:
            out.append((b, by_id[b.entry_id]))
        elif b.type == "all_entries":
            out.extend((b, e) for e in prod.entries if e.id not in placed)
    return out


def build_docx(prod: Product, app_version: str, image_file: ImageFile = lambda iid: None,
               logo: Optional[Path] = None) -> bytes:
    doc = Document()
    _setup(doc, logo)
    ordered = document_order(prod)
    number = {id(e): n for n, (_, e) in enumerate(ordered, start=1)}
    placed = {b.entry_id for b in prod.blocks if b.type == "entry"}
    by_id = {e.id: e for e in prod.entries}
    started = False   # nothing printed yet: no break before the first page
    for i, b in enumerate(prod.blocks):
        # Pictures and the cover photo size themselves from `width`.
        scale = _SCALE.set(1.0 if b.type in ("image", "cover", "chart") else b.width / 100)
        try:
            _print_block(doc, prod, b, i, ordered, number, placed, by_id, logo, image_file, app_version, started)
        finally:
            _SCALE.reset(scale)
        if b.type == "all_entries" and any(e.id not in placed for e in prod.entries):
            started = True
        started = started or b.type in (
            "cover", "summary", "heading", "text", "entry", "image", "params", "units", "chart")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _print_block(doc: Document, prod: Product, b: Block, i: int, ordered, number, placed, by_id,
                 logo: Optional[Path], image_file: ImageFile, app_version: str, started: bool) -> None:
    """One block of the layout, at the width _SCALE gives it."""
    if b.type == "cover":
        _cover(doc, prod, b, logo, image_file)
        # The cover is a page of its own; what follows starts the next.
        if i < len(prod.blocks) - 1 and prod.blocks[i + 1].type != "page_break":
            doc.add_page_break()
    elif b.type == "summary":
        _summary(doc, [e for _, e in ordered], number, b.labels)
    elif b.type == "heading":
        if plain(b.text).strip():
            _narrow(_heading(doc, b.text.strip(), f"Heading {b.level}"))
    elif b.type == "text":
        _text(doc, b.text)
    elif b.type == "image":
        _image(doc, b, image_file)
    elif b.type == "chart":
        # A Word chart of the run's numbers, not a picture: it can be
        # restyled and its data edited in Word.
        add_chart(doc, b, by_id.get(b.entry_id) if b.entry_id else None, TEXT_W * b.width / 100)
    elif b.type == "params":
        # Rows left empty are not printed; a row's fill follows its row.
        kept = [(ri, r) for ri, r in enumerate(b.rows) if any(plain(c).strip() for c in r)]
        if kept:
            lab = dict(b.labels)
            for k, (ri, _) in enumerate(kept):
                lab[f"fill:par:{k}"] = b.labels.get(f"fill:par:{ri}", "")
            _table(doc, [_l(b.labels, "col1", "Parameter"), _l(b.labels, "col2", "Value")],
                   [[(r + ["", ""])[0], (r + ["", ""])[1]] for _, r in kept], first_bold=True, widths=[6.9, 9.0],
                   fills=("par", lab))
    elif b.type == "units":
        _units(doc, prod, b.labels)
    elif b.type == "page_break":
        if started and not (i > 0 and prod.blocks[i - 1].type == "cover"):
            doc.add_page_break()
        elif i > 0 and prod.blocks[i - 1].type == "cover":
            doc.add_page_break()
    elif b.type == "entry" and b.entry_id in by_id:
        e = by_id[b.entry_id]
        _entry(doc, number[id(e)], e, new_page=False,
               show_settings=b.show_settings, show_note=b.show_note, lab=b.labels)
    elif b.type == "all_entries":
        # Each on its own page after the first, as a run reads best alone.
        first = True
        for e in prod.entries:
            if e.id not in placed:
                _entry(doc, number[id(e)], e, new_page=started and not first,
                       show_settings=b.show_settings, show_note=b.show_note,
                       lab={k: v for k, v in b.labels.items() if k != "title"})
                first = False
                started = True
