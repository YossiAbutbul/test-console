"""Product reports: kept on disk per product, entries summarised from their
Verdict column. The sheets and the Excel export are test_report_sheets.py."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from backend.api import reports as api
from backend.reports import store as store_mod
from backend.reports.models import (
    ApplyTemplate, Block, BlocksIn, EntryDut, EntryIn, ProductIn, ProductPatch, TemplateIn,
)
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


# --- layout and templates: still stored, so a report keeps what it had ---

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


# --- pictures -----------------------------------------------------

import base64  # noqa: E402

# A 2x2 red PNG.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==")


class _Req:
    def __init__(self, body: bytes, ctype: str):
        self._b, self.headers = body, {"content-type": ctype}

    async def body(self):
        return self._b


def test_a_picture_that_is_not_an_image_is_refused(store):
    for body, ctype in ((PNG, "image/webp"), (b"", "image/png"), (PNG, "")):
        with pytest.raises(HTTPException) as ex:
            run(api.upload_image(_Req(body, ctype)))
        assert ex.value.status_code == 415
    with pytest.raises(HTTPException):
        run(api.get_image("../x"))
