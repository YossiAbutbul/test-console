"""A report's chart as a real Word chart.

Word draws it from the numbers: it can be restyled with Word's Chart Design
tools, and "Edit Data" opens the run's columns in a workbook embedded with
it. The look follows the page's chart (frontend/src/tests/reports/
ReportChart.tsx): navy bold title, legend at the top, light grey grid, the
series in the report's navy and then Office's chart colours, the same
round axis steps.

What is plotted is worked out as the page works it out (chartData.ts): the
same number reading, the same columns, rows sorted along a numeric X.
  - line or points over a numeric X: an XY chart, so the points sit at
    their true frequency, as on the page;
  - bars, or anything over a column of words: a category chart.
"""

from __future__ import annotations

import io
import math
from typing import Optional
from xml.sax.saxutils import escape

from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm

from .models import Block, Entry

#: The page's SERIES (paperStyle.ts), in the same order.
SERIES = ["002060", "ED7D31", "4472C4", "70AD47", "FFC000", "7030A0", "A5A5A5"]
NAVY, INK, MUTED, GRID, AXIS = "002060", "000000", "595959", "D9D9D9", "8C8C8C"
#: The page draws its chart 640 x 360.
ASPECT = 360 / 640

CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
CT_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"


# --- the numbers (as chartData.ts) ----------------------------------------------

def num(v) -> Optional[float]:
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        n = float(v) if isinstance(v, (int, float)) else float(str(v).strip())
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def numeric_columns(e: Entry) -> list[int]:
    out = []
    for i in range(len(e.columns)):
        seen, ok = False, True
        for r in e.rows:
            v = r[i] if i < len(r) else None
            if v is None or v == "":
                continue
            if num(v) is None:
                ok = False
                break
            seen = True
        if ok and seen:
            out.append(i)
    return out


def chart_data(e: Entry, x: int, ys: list[int]):
    """(xs, numeric_x, series [(name, values)]) as the page plots them."""
    numeric_x = x in numeric_columns(e)
    cell = lambda r, i: r[i] if i < len(r) else None   # noqa: E731
    rows = list(e.rows)
    if numeric_x:
        rows = sorted((r for r in rows if num(cell(r, x)) is not None), key=lambda r: num(cell(r, x)))
    xs = [num(cell(r, x)) if numeric_x else ("" if cell(r, x) is None else str(cell(r, x))) for r in rows]
    series = [(e.columns[c] if c < len(e.columns) else f"Column {c + 1}", [num(cell(r, c)) for r in rows])
              for c in ys]
    return xs, numeric_x, series


def nice_ticks(lo: float, hi: float, count: int = 5) -> list[float]:
    """niceTicks in chartData.ts: steps of 1, 2 or 5 times a power of ten."""
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return [0, 1]
    if lo == hi:
        lo, hi = lo - 1, hi + 1
    raw = (hi - lo) / max(1, count)
    mag = 10 ** math.floor(math.log10(raw))
    step = next((m * mag for m in (1, 2, 5, 10) if m * mag >= raw), 10 * mag)
    v = math.floor(lo / step) * step
    out: list[float] = []
    while v <= hi + step * 1e-9:
        out.append(round(v, 10))
        v += step
    if out[-1] < hi:
        out.append(round(out[-1] + step, 10))
    return out


def _fmt(v: float) -> str:
    return f"{v:.6g}"


# --- the chart part ----------------------------------------------------------------

def _rpr(size: int, color: str, bold: bool = False) -> str:
    return (f'<a:defRPr sz="{size * 100}" b="{1 if bold else 0}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:defRPr>')


def _txpr(size: int, color: str, rot: Optional[int] = None) -> str:
    body = f'<a:bodyPr rot="{rot}" vert="horz"/>' if rot is not None else "<a:bodyPr/>"
    return f'<c:txPr>{body}<a:lstStyle/><a:p><a:pPr>{_rpr(size, color)}</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>'


def _title(text: str, size: int, color: str, bold: bool, rot: Optional[int] = None) -> str:
    body = f'<a:bodyPr rot="{rot}" vert="horz"/>' if rot is not None else "<a:bodyPr/>"
    return (f'<c:title><c:tx><c:rich>{body}<a:lstStyle/><a:p><a:pPr>{_rpr(size, color, bold)}</a:pPr>'
            f'<a:r><a:rPr lang="en-US" sz="{size * 100}" b="{1 if bold else 0}"><a:solidFill><a:srgbClr val="{color}"/>'
            f'</a:solidFill><a:latin typeface="Calibri"/><a:cs typeface="Calibri"/></a:rPr><a:t>{escape(text)}</a:t></a:r>'
            f'</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>')


def _col(i: int) -> str:
    return chr(ord("A") + i)


def _str_ref(f: str, values: list[str]) -> str:
    pts = "".join(f'<c:pt idx="{i}"><c:v>{escape(v)}</c:v></c:pt>' for i, v in enumerate(values))
    return f"<c:strRef><c:f>{f}</c:f><c:strCache><c:ptCount val=\"{len(values)}\"/>{pts}</c:strCache></c:strRef>"


def _num_ref(f: str, values: list[Optional[float]]) -> str:
    pts = "".join(f'<c:pt idx="{i}"><c:v>{v!r}</c:v></c:pt>' for i, v in enumerate(values) if v is not None)
    return (f"<c:numRef><c:f>{f}</c:f><c:numCache><c:formatCode>General</c:formatCode>"
            f"<c:ptCount val=\"{len(values)}\"/>{pts}</c:numCache></c:numRef>")


def _line_sp(color: str, line: bool) -> str:
    ln = (f'<a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:round/></a:ln>'
          if line else '<a:ln w="28575"><a:noFill/></a:ln>')
    return f"<c:spPr>{ln}</c:spPr>"


def _marker(color: str, size: int) -> str:
    return (f'<c:marker><c:symbol val="circle"/><c:size val="{size}"/><c:spPr><a:solidFill><a:srgbClr val="{color}"/>'
            f'</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>')


def _val_ax(ax: int, cross: int, pos: str, ticks: Optional[list[float]], title: str, grid: bool,
            cross_between: bool) -> str:
    scaling = '<c:orientation val="minMax"/>'
    unit = ""
    if ticks and len(ticks) > 1:
        scaling += f'<c:max val="{ticks[-1]!r}"/><c:min val="{ticks[0]!r}"/>'
        unit = f'<c:majorUnit val="{round(ticks[1] - ticks[0], 10)!r}"/>'
    gridlines = (f'<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="{GRID}"/></a:solidFill>'
                 '</a:ln></c:spPr></c:majorGridlines>') if grid else ""
    t = _title(title, 10, INK, False, -5400000 if pos == "l" else None) if title else ""
    line = (f'<a:ln w="9525"><a:solidFill><a:srgbClr val="{AXIS}"/></a:solidFill></a:ln>' if pos == "b"
            else "<a:ln><a:noFill/></a:ln>")
    return (f'<c:valAx><c:axId val="{ax}"/><c:scaling>{scaling}</c:scaling><c:delete val="0"/>'
            f'<c:axPos val="{pos}"/>{gridlines}{t}<c:numFmt formatCode="General" sourceLinked="0"/>'
            f'<c:majorTickMark val="{"out" if pos == "b" else "none"}"/><c:minorTickMark val="none"/>'
            f'<c:tickLblPos val="nextTo"/><c:spPr>{line}</c:spPr>{_txpr(9, MUTED)}'
            f'<c:crossAx val="{cross}"/><c:crosses val="autoZero"/>'
            f'<c:crossBetween val="{"between" if cross_between else "midCat"}"/>{unit}</c:valAx>')


def _cat_ax(ax: int, cross: int, title: str) -> str:
    t = _title(title, 10, INK, False) if title else ""
    return (f'<c:catAx><c:axId val="{ax}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>'
            f'<c:axPos val="b"/>{t}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/>'
            f'<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill>'
            f'<a:srgbClr val="{AXIS}"/></a:solidFill></a:ln></c:spPr>{_txpr(9, MUTED)}<c:crossAx val="{cross}"/>'
            f'<c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
            f'<c:noMultiLvlLbl val="0"/></c:catAx>')


def chart_xml(b: Block, e: Entry) -> Optional[str]:
    """The chart part, or None when there is nothing to plot."""
    xs, numeric_x, series = chart_data(e, b.x, b.ys)
    values = [v for _, s in series for v in s if v is not None]
    if not xs or not values:
        return None
    n = len(xs)
    x_name = e.columns[b.x] if b.x < len(e.columns) else ""
    y_name = series[0][0] if len(series) == 1 else ""
    y_ticks = nice_ticks(min(values + ([0.0] if b.kind == "bar" else [])), max(values))
    xy = numeric_x and b.kind != "bar"
    rng = lambda c: f"Sheet1!${_col(c)}$2:${_col(c)}${n + 1}"   # noqa: E731

    sers = []
    for i, (name, s) in enumerate(series):
        color = SERIES[i % len(SERIES)]
        head = (f'<c:idx val="{i}"/><c:order val="{i}"/>'
                f'<c:tx>{_str_ref(f"Sheet1!${_col(i + 1)}$1", [name])}</c:tx>')
        if b.kind == "bar":
            cats = [_fmt(v) if isinstance(v, float) else v for v in xs]
            sers.append(f'<c:ser>{head}<c:spPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></c:spPr>'
                        f'<c:invertIfNegative val="0"/><c:cat>{_str_ref(rng(0), cats)}</c:cat>'
                        f'<c:val>{_num_ref(rng(i + 1), s)}</c:val></c:ser>')
        elif xy:
            sers.append(f'<c:ser>{head}{_line_sp(color, b.kind == "line")}'
                        f'{_marker(color, 5 if b.kind == "line" else 7)}'
                        f'<c:xVal>{_num_ref(rng(0), xs)}</c:xVal><c:yVal>{_num_ref(rng(i + 1), s)}</c:yVal>'
                        f'<c:smooth val="0"/></c:ser>')
        else:
            sers.append(f'<c:ser>{head}{_line_sp(color, b.kind == "line")}'
                        f'{_marker(color, 5 if b.kind == "line" else 7)}'
                        f'<c:cat>{_str_ref(rng(0), [str(v) for v in xs])}</c:cat>'
                        f'<c:val>{_num_ref(rng(i + 1), s)}</c:val><c:smooth val="0"/></c:ser>')
    ser = "".join(sers)
    ax = '<c:axId val="500000001"/><c:axId val="500000002"/>'
    if b.kind == "bar":
        plot = (f'<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{ser}'
                f'<c:gapWidth val="80"/><c:overlap val="-5"/>{ax}</c:barChart>'
                + _cat_ax(500000001, 500000002, x_name)
                + _val_ax(500000002, 500000001, "l", y_ticks, y_name, True, True))
    elif xy:
        x_ticks = nice_ticks(min(xs), max(xs), 6)
        plot = (f'<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>{ser}{ax}</c:scatterChart>'
                + _val_ax(500000001, 500000002, "b", x_ticks, x_name, False, False)
                + _val_ax(500000002, 500000001, "l", y_ticks, y_name, True, False))
    else:
        plot = (f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{ser}'
                f'<c:marker val="1"/>{ax}</c:lineChart>'
                + _cat_ax(500000001, 500000002, x_name)
                + _val_ax(500000002, 500000001, "l", y_ticks, y_name, True, True))

    title = b.text.strip()
    head = (_title(title, 14, NAVY, True) + '<c:autoTitleDeleted val="0"/>') if title else '<c:autoTitleDeleted val="1"/>'
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<c:chartSpace xmlns:c="{NS_C}" xmlns:a="{NS_A}" xmlns:r="{NS_R}">'
            f'<c:date1904 val="0"/><c:roundedCorners val="0"/>'
            f'<c:chart>{head}<c:plotArea><c:layout/>{plot}</c:plotArea>'
            f'<c:legend><c:legendPos val="t"/><c:overlay val="0"/>{_txpr(10, INK)}</c:legend>'
            f'<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
            f'<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>{_txpr(10, INK)}'
            f'<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')


def workbook(b: Block, e: Entry) -> bytes:
    """The numbers behind the chart, for Word's "Edit Data"."""
    from openpyxl import Workbook

    xs, _, series = chart_data(e, b.x, b.ys)
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append([e.columns[b.x] if b.x < len(e.columns) else "X"] + [name for name, _ in series])
    for i, x in enumerate(xs):
        ws.append([x] + [s[i] for _, s in series])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def add_chart(doc, b: Block, e: Optional[Entry], width_cm: float) -> bool:
    """The chart as a Word chart in its own centred paragraph. A chart with
    no run, or nothing to plot, prints nothing (as an empty picture)."""
    if e is None:
        return False
    xml = chart_xml(b, e)
    if xml is None:
        return False
    package = doc.part.package
    chart = Part(package.next_partname("/word/charts/chart%d.xml"), CT_CHART, xml.encode("utf-8"), package)
    book = Part(package.next_partname("/word/embeddings/Microsoft_Excel_Worksheet%d.xlsx"), CT_XLSX,
                workbook(b, e), package)
    chart.relate_to(book, RT.PACKAGE)   # the chart's rId1, named in chart_xml
    rid = doc.part.relate_to(chart, RT.CHART)

    cx = int(Cm(width_cm))
    cy = int(Cm(width_cm * ASPECT))
    n = sum(1 for _ in doc.element.body.iter(f"{{{NS_WP}}}docPr")) + 1000
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run()._r.append(parse_xml(
        f'<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'xmlns:wp="{NS_WP}" xmlns:a="{NS_A}" xmlns:c="{NS_C}" xmlns:r="{NS_R}">'
        f'<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
        f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{n}" name="Chart {n}"/>'
        f'<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="{NS_C}"><c:chart r:id="{rid}"/>'
        f'</a:graphicData></a:graphic></wp:inline></w:drawing>'))
    return True


