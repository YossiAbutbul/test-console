"""Product reports: kept on disk per product, entries summarised from their
Verdict column, exported as a Word document that opens and says what ran."""
from __future__ import annotations

import asyncio
import io
import zipfile

import pytest
from docx import Document
from docx.oxml.ns import qn
from fastapi import HTTPException

from backend.api import reports as api
from backend.reports import store as store_mod
from backend.reports.models import EntryDut, EntryIn, ProductIn, ProductPatch
from backend.reports.store import ReportStore, summarize


@pytest.fixture()
def store(tmp_path, monkeypatch):
    s = ReportStore(tmp_path / "reports")
    monkeypatch.setattr(store_mod, "store", s)
    monkeypatch.setattr(api, "store", s)
    return s


def run(coro):
    return asyncio.run(coro)


def cw_entry(verdicts=("pass", "fail", "")) -> EntryIn:
    return EntryIn(
        test="tx-cw-automation", title="LoRa CW automation", note="after rework",
        operator="Noy", dut=EntryDut(mac="80E127FAA9F9", name="Sonata2IL", nickname="Bench 3"),
        settings=[("Settle", "400 ms")],
        columns=["Freq [MHz]", "Set [dBm]", "Measured [dBm]", "Verdict"],
        rows=[[902.3, 14, 13.9, v] for v in verdicts],
    )


def test_summary_counts_the_verdict_column():
    s = summarize(["A", "Verdict"], [[1, "pass"], [2, "Fail"], [3, ""], [4, None]])
    assert (s.points, s.passed, s.failed, s.result) == (4, 1, 1, "Fail")
    assert summarize(["A"], [[1], [2]]).result == "-"          # nothing judged
    assert summarize(["Verdict"], [["pass"]]).result == "Pass"


def test_a_product_keeps_its_entries_on_disk(store):
    prod = run(api.create_report(ProductIn(name="  Sonata 2 IL rev B ")))
    assert prod.name == "Sonata 2 IL rev B"
    e1 = run(api.add_entry(prod.id, cw_entry()))
    e2 = run(api.add_entry(prod.id, cw_entry(("pass",))))
    assert e1.summary.failed == 1 and e2.summary.result == "Pass"

    # A fresh store over the same folder reads the same report back.
    again = ReportStore(store.root).get(prod.id)
    assert [e.id for e in again.entries] == [e1.id, e2.id]
    assert again.entries[0].dut.nickname == "Bench 3"

    listed = run(api.list_reports())
    assert [(p.name, p.entry_count, p.units) for p in listed] == [("Sonata 2 IL rev B", 2, 1)]


def test_entries_reorder_and_delete(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    ids = [run(api.add_entry(pid, cw_entry())).id for _ in range(3)]
    # A stale list naming only one entry cannot drop the others.
    out = run(api.reorder_entries(pid, api.EntryOrder(ids=[ids[2]])))
    assert [e.id for e in out.entries] == [ids[2], ids[0], ids[1]]
    out = run(api.delete_entry(pid, ids[0]))
    assert [e.id for e in out.entries] == [ids[2], ids[1]]
    with pytest.raises(HTTPException) as ex:
        run(api.delete_entry(pid, ids[0]))
    assert ex.value.status_code == 404


def test_rename_and_delete_a_product(store):
    pid = run(api.create_report(ProductIn(name="Old"))).id
    assert run(api.update_report(pid, ProductPatch(name="New", notes="EVT"))).notes == "EVT"
    run(api.delete_report(pid))
    with pytest.raises(HTTPException):
        run(api.get_report(pid))


def test_ids_that_are_not_ours_are_not_found(store):
    for bad in ("../secrets", "ZZZ", ""):
        with pytest.raises(HTTPException) as ex:
            run(api.get_report(bad))
        assert ex.value.status_code == 404


def test_the_word_export_opens_and_carries_every_entry(store):
    pid = run(api.create_report(ProductIn(name="Sonata 2 IL rev B", notes="EVT build"))).id
    run(api.add_entry(pid, cw_entry()))
    run(api.add_entry(pid, cw_entry(("pass", "pass"))))
    resp = run(api.export_docx(pid))
    assert resp.media_type == api.DOCX_MEDIA_TYPE
    assert 'filename="Sonata-2-IL-rev-B_report_' in resp.headers["content-disposition"]

    doc = Document(io.BytesIO(resp.body))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Sonata 2 IL rev B" in text and "EVT build" in text
    assert "1. LoRa CW automation" in text and "2. LoRa CW automation" in text
    assert "after rework" in text
    # The lab's layout: cover, test parameters and unit IDs, the summary,
    # then each run with its settings and results.
    def table(first: str):
        return next(t for t in doc.tables if t.rows[0].cells[0].text == first)
    params = next(t for t in doc.tables if t.rows[0].cells[0].text == "Parameter"
                  and t.rows[1].cells[0].text == "Frequency")
    assert [c.text for c in params.rows[0].cells] == ["Parameter", "Value"]
    units = next(t for t in doc.tables if len(t.rows) > 1 and t.rows[1].cells[0].text == "Unit IDs")
    assert units.rows[1].cells[1].text == "Bench 3 (80E127FAA9F9)"
    summary = table("#")
    assert [c.text for c in summary.rows[0].cells][:3] == ["#", "Test", "Unit"]
    assert summary.rows[1].cells[7].text == "Fail" and summary.rows[2].cells[7].text == "Pass"
    results = table("Freq [MHz]")
    assert [c.text for c in results.rows[0].cells] == ["Freq [MHz]", "Set [dBm]", "Measured [dBm]", "Verdict"]
    assert results.rows[2].cells[3].text == "Fail"


def test_an_empty_report_still_exports(store):
    pid = run(api.create_report(ProductIn(name="Empty"))).id
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    assert any("No runs have been added" in p.text for p in doc.paragraphs)


# --- layout and templates ----------------------------------------------------

from backend.reports.models import ApplyTemplate, Block, BlocksIn, TemplateIn  # noqa: E402


def test_a_new_report_has_the_labs_layout(store):
    prod = run(api.create_report(ProductIn(name="P")))
    heads = [b.text for b in prod.blocks if b.type == "heading"]
    assert heads[:5] == ["Test Setup:", "Scope of Testing", "Test Parameters:", "Measurement Parameters:", "Unit IDs:"]
    types = [b.type for b in prod.blocks]
    assert types[0] == "cover" and {"params", "units", "summary", "all_entries"} <= set(types)


def test_a_layout_without_all_runs_gets_each_new_run_as_a_block(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    run(api.set_blocks(pid, BlocksIn(blocks=[Block(id="c", type="cover")])))
    e = run(api.add_entry(pid, cw_entry()))
    blocks = run(api.get_report(pid)).blocks
    assert [(b.type, b.entry_id) for b in blocks] == [("cover", None), ("entry", e.id)]
    # Removing the run removes its block too.
    out = run(api.delete_entry(pid, e.id))
    assert [b.type for b in out.blocks] == ["cover"]


def test_blocks_for_runs_that_are_gone_are_dropped(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    out = run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="a", type="heading", text="RF"), Block(id="b", type="entry", entry_id="nope")])))
    assert [b.id for b in out.blocks] == ["a"]


def test_a_template_keeps_the_layout_without_its_runs(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    t = run(api.save_template(TemplateIn(name="Lab standard", blocks=[
        Block(id="1", type="cover"), Block(id="2", type="heading", text="TX"),
        Block(id="3", type="entry", entry_id=e.id), Block(id="4", type="entry", entry_id=e.id),
        Block(id="5", type="page_break")])))
    # The runs became one "All runs" block, where the first of them was.
    assert [b.type for b in t.blocks] == ["cover", "heading", "all_entries", "page_break"]
    assert [x.name for x in run(api.list_templates())] == ["Lab standard"]

    made = run(api.create_report(ProductIn(name="Q", template_id=t.id)))
    assert [b.type for b in made.blocks] == [b.type for b in t.blocks]
    assert {b.id for b in made.blocks}.isdisjoint({b.id for b in t.blocks})

    applied = run(api.apply_template(pid, ApplyTemplate(template_id=t.id)))
    assert [b.type for b in applied.blocks] == [b.type for b in t.blocks]
    run(api.delete_template(t.id))
    assert run(api.list_templates()) == []


def test_the_word_export_follows_the_layout(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    a = run(api.add_entry(pid, cw_entry()))
    b = run(api.add_entry(pid, cw_entry(("pass",))))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="h", type="heading", text="Transmitter"),
        Block(id="t", type="text", text="First paragraph.\n\nSecond paragraph."),
        Block(id="eb", type="entry", entry_id=b.id, show_note=False),
        Block(id="s", type="summary"),
        Block(id="rest", type="all_entries"),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    text = [p.text for p in doc.paragraphs if p.text]
    assert text[:3] == ["Transmitter", "First paragraph.", "Second paragraph."]
    # b is placed first, so it is run 1; a comes after through "All runs".
    assert text.index(f"1. {b.title}") < text.index(f"2. {a.title}")
    assert "after rework" in text                     # a's note, shown
    assert text.count("after rework") == 1            # b's, hidden by its block
    assert not any(p.text == "Notes" for p in doc.paragraphs)   # no cover block


# --- pictures and labels -----------------------------------------------------

import base64  # noqa: E402

# A 2x2 red PNG.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==")


class _Req:
    def __init__(self, body: bytes, ctype: str):
        self._b, self.headers = body, {"content-type": ctype}

    async def body(self):
        return self._b


def test_a_picture_is_kept_served_and_printed_with_its_caption(store):
    iid = run(api.upload_image(_Req(PNG, "image/png")))["id"]
    served = run(api.get_image(iid))
    assert str(served.path).endswith(f"{iid}.png")

    pid = run(api.create_report(ProductIn(name="P"))).id
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="i", type="image", image_id=iid, width=50, text="The test bench"),
        Block(id="gone", type="image", image_id="0123456789abcdef"),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    # A missing picture prints nothing rather than a placeholder.
    assert len(doc.inline_shapes) == 1
    assert abs(doc.inline_shapes[0].width.cm - 7.96) < 0.05          # half the 15.92 cm text width
    assert "The test bench" in [p.text for p in doc.paragraphs]


def test_a_picture_word_cannot_embed_is_refused(store):
    for body, ctype in ((PNG, "image/webp"), (b"", "image/png"), (PNG, "")):
        with pytest.raises(HTTPException) as ex:
            run(api.upload_image(_Req(body, ctype)))
        assert ex.value.status_code == 415
    with pytest.raises(HTTPException):
        run(api.get_image("../x"))


def test_labels_replace_the_fixed_words(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="c", type="cover", labels={"subtitle": "Qualification report", "tested_by": "Y. Abutbul"}),
        Block(id="s", type="summary", labels={"title": "Overview"}),
        Block(id="e", type="entry", entry_id=e.id, labels={"title": "Output power, 902-928 MHz", "results": "Measurements"}),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    text = [p.text for p in doc.paragraphs]
    assert "Qualification report" in text and "Overview" in text and "Measurements" in text
    assert "1. Output power, 902-928 MHz" in text
    assert "Tested By: Y. Abutbul" in text


def test_the_style_puts_the_logo_on_the_cover_and_in_the_header(store):
    iid = run(api.upload_image(_Req(PNG, "image/png")))["id"]
    run(api.set_style(api.ReportStyle(logo_image_id=iid)))
    assert run(api.get_style()).logo_image_id == iid
    pid = run(api.create_report(ProductIn(name="Sonata Allegro"))).id
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    sec = doc.sections[0]
    assert round(sec.page_width.cm, 1) == 21.0 and round(sec.left_margin.cm, 2) == 2.54
    assert sec.different_first_page_header_footer
    header_pics = sec.header._element.xpath(".//pic:pic")
    assert len(header_pics) == 1 and len(doc.inline_shapes) == 1      # cover logo in the body
    with pytest.raises(HTTPException):
        run(api.set_style(api.ReportStyle(logo_image_id="0123456789abcdef")))


def test_every_printed_value_can_be_reworded(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="c", type="cover", labels={"title": "Sonata Allegro"}),
        Block(id="u", type="units", labels={"units": "13609837\n13610987"}),
        Block(id="s", type="summary", labels={"sum:0:1": "CW output power", "sum_h:2": "Board"}),
        Block(id="e", type="entry", entry_id=e.id, labels={
            "meta": "Bench 3, 08.11.2026", "result_detail": "3 of 3 points measured",
            "note": "Reworded note", "set:0:1": "500 ms", "res:2:2": "13.0", "res_h:0": "Frequency [MHz]",
        }),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    text = [p.text for p in doc.paragraphs]
    assert "Sonata Allegro" in text and "Bench 3, 08.11.2026" in text and "Reworded note" in text
    assert any(t.endswith("3 of 3 points measured") for t in text)
    cells = [c.text for t in doc.tables for row in t.rows for c in row.cells]
    for v in ("13609837\n13610987", "CW output power", "Board", "500 ms", "13.0", "Frequency [MHz]"):
        assert v in cells, v


def test_a_resized_block_prints_at_its_width(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="t", type="text", text="Narrow paragraph", width=50),
        Block(id="p", type="params", rows=[["Frequency", "915 MHz"]], width=50),
        Block(id="w", type="params", rows=[["Power", "14 dBm"]]),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    para = next(p for p in doc.paragraphs if p.text == "Narrow paragraph")
    assert abs(para.paragraph_format.right_indent.cm - 7.96) < 0.05      # half of 15.92 cm
    narrow, full = doc.tables[0], doc.tables[1]
    assert abs(narrow.rows[0].cells[0].width.cm - 3.45) < 0.05            # 6.9 cm at 50 %
    assert abs(full.rows[0].cells[0].width.cm - 6.9) < 0.05


def test_a_chart_is_a_word_chart_of_the_runs_numbers(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="c", type="chart", entry_id=e.id, x=0, ys=[2, 1], kind="line", width=80,
              text="Power vs frequency"),
        Block(id="b", type="chart", entry_id=e.id, x=0, ys=[2], kind="bar"),
        Block(id="n", type="chart"),   # no run: prints nothing
    ])))
    raw = run(api.export_docx(pid)).body
    doc = Document(io.BytesIO(raw))
    assert len(doc.inline_shapes) == 2
    assert abs(doc.inline_shapes[0].width.cm - 15.92 * 0.8) < 0.05
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = z.namelist()
        charts = sorted(n for n in names if n.startswith("word/charts/chart"))
        assert len(charts) == 2
        assert sum(n.startswith("word/embeddings/") and n.endswith(".xlsx") for n in names) == 2
        xy = z.read(charts[0]).decode()
        bar = z.read(charts[1]).decode()
    # Line over frequency: an XY chart, both series, the title, the numbers.
    assert "<c:scatterChart>" in xy and "Power vs frequency" in xy
    assert "Measured [dBm]" in xy and "Set [dBm]" in xy and "<c:v>902.3</c:v>" in xy
    assert "<c:barChart>" in bar and "<c:autoTitleDeleted val=\"1\"/>" in bar
    # The title is the chart's own; it is not printed again under it.
    assert not any("Power vs frequency" in p.text for p in doc.paragraphs)

    t = run(api.save_template(TemplateIn(name="T", blocks=run(api.get_report(pid)).blocks)))
    chart = next(b for b in t.blocks if b.type == "chart")
    assert chart.entry_id is None and chart.ys == [2, 1]

    out = run(api.delete_entry(pid, e.id))
    chart = next(b for b in out.blocks if b.type == "chart")
    assert chart.entry_id is None


def test_chart_axes_step_as_the_page_does():
    from backend.reports.chart_docx import nice_ticks
    assert nice_ticks(12.6, 14.1) == [12.5, 13, 13.5, 14, 14.5]
    assert nice_ticks(0, 100) == [0, 20, 40, 60, 80, 100]


def test_formatted_words_print_bold_and_coloured(store):
    from backend.reports.rich import plain, spans
    v = 'Plain <b>bold</b> <span style="color:#C00000">red <b>both</b></span> &lt; 30'
    assert plain(v) == "Plain bold red both < 30"
    assert [(s.text, s.bold, s.color) for s in spans(v)] == [
        ("Plain ", None, None), ("bold", True, None), (" ", None, None),
        ("red ", None, "C00000"), ("both", True, "C00000"), (" < 30", None, None)]
    # Text saved before formatting existed reads as written.
    assert plain("< 30 ppm & more") == "< 30 ppm & more"

    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="t", type="text", text='One <b>two</b>\n\n<span style="color:#00B050">three</span>'),
        Block(id="h", type="heading", text='<span style="font-weight:400">Light</span> heading'),
        Block(id="iu", type="text", text='<i>slanted</i> <u>lined</u> <b><i><u>all</u></i></b>'),
        Block(id="e", type="entry", entry_id=e.id, labels={"res:0:2": '<b>13.9</b>'}),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))
    one = next(p for p in doc.paragraphs if p.text == "One two")
    assert [r.bold for r in one.runs] == [False, True]
    three = next(p for p in doc.paragraphs if p.text == "three")
    assert str(three.runs[0].font.color.rgb) == "00B050"
    head = next(p for p in doc.paragraphs if p.text == "Light heading")
    assert head.runs[0].bold is False and head.runs[1].bold is None
    iu = next(p for p in doc.paragraphs if p.text == "slanted lined all")
    assert [(r.text, r.italic, r.underline, r.bold) for r in iu.runs] == [
        ("slanted", True, None, False), (" ", False, None, False), ("lined", False, True, False),
        (" ", False, None, False), ("all", True, True, True)]
    cell = next(c for t in doc.tables for row in t.rows for c in row.cells if c.text == "13.9")
    assert cell.paragraphs[0].runs[0].bold is True


def test_a_filled_row_prints_its_fill(store):
    pid = run(api.create_report(ProductIn(name="P"))).id
    e = run(api.add_entry(pid, cw_entry()))
    run(api.set_blocks(pid, BlocksIn(blocks=[
        Block(id="e", type="entry", entry_id=e.id, show_settings=False,
              labels={"fill:res:0": "#FFF2CC", "fill:res_h": "#E2EFDA", "fill:res:1": "none"}),
        Block(id="p", type="params", rows=[["", ""], ["Power", "14 dBm"]], labels={"fill:par:1": "#D9E2F3"}),
    ])))
    doc = Document(io.BytesIO(run(api.export_docx(pid)).body))

    def fill(cell):
        shd = cell._tc.tcPr.find(qn("w:shd"))
        return None if shd is None else shd.get(qn("w:fill"))

    res, par = doc.tables
    assert fill(res.rows[0].cells[0]) == "E2EFDA"
    assert fill(res.rows[1].cells[3]) == "FFF2CC"
    assert fill(res.rows[2].cells[0]) is None         # "none": the failed row's shade taken off too
    assert fill(res.rows[3].cells[0]) is None         # the empty verdict row has none of its own
    # The empty first row is not printed; the fill went with its row.
    assert fill(par.rows[1].cells[0]) == "D9E2F3"
