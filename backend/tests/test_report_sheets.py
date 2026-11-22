"""A report as sheets: one per test type, runs of one type in one table, the
unit and the run's settings as columns, and the same sheets in the workbook."""
from __future__ import annotations

import asyncio
import io

import pytest
from openpyxl import load_workbook

from backend.api import reports as api
from backend.reports import store as store_mod
from backend.reports.models import EntryDut, EntryIn, ProductIn
from backend.reports.sheets import RUN_COLUMNS, build_sheets
from backend.reports.store import ReportStore


@pytest.fixture()
def store(tmp_path, monkeypatch):
    s = ReportStore(tmp_path / "reports")
    monkeypatch.setattr(store_mod, "store", s)
    monkeypatch.setattr(api, "store", s)
    return s


def run(coro):
    return asyncio.run(coro)


def cw(mac="80E127FAA9F9", nick="Bench 3", stage="span 1 MHz", verdicts=("pass", "fail")) -> EntryIn:
    return EntryIn(
        test="tx-cw-automation", title="LoRa CW automation", operator="Noy",
        dut=EntryDut(mac=mac, nickname=nick), settings=[("Settle", "400 ms"), ("Stage 1", stage)],
        columns=["Freq [MHz]", "Set [dBm]", "Measured [dBm]", "Verdict"],
        rows=[[902.3 + i, 14, 13.9, v] for i, v in enumerate(verdicts)],
    )


def lte() -> EntryIn:
    return EntryIn(
        test="lte-cw-automation", title="LTE CW automation", dut=EntryDut(mac="AABBCCDDEEFF"),
        columns=["EARFCN", "Set [dBm]", "Measured [dBm]", "Verdict"], rows=[[18900, 23, 22.6, "pass"]],
    )


def report(store, *entries: EntryIn) -> str:
    pid = run(api.create_report(ProductIn(name="Sonata 2 IL rev B"))).id
    for e in entries:
        run(api.add_entry(pid, e))
    return pid


def test_one_sheet_per_test_type_in_first_seen_order(store):
    pid = report(store, cw(), lte(), cw(mac="112233445566", nick="Bench 4", stage="span 2 MHz"))
    rs = build_sheets(store.get(pid))
    assert [s.name for s in rs.sheets] == ["LoRa CW", "LTE CW"]
    lora, lte_ = rs.sheets
    # Both LoRa runs share one table: two runs x two points.
    assert len(lora.rows) == 4 and len(lte_.rows) == 1
    assert lora.columns == RUN_COLUMNS + ["Stage 1", "Freq [MHz]", "Set [dBm]", "Measured [dBm]", "Verdict"]


def test_the_mac_unit_run_and_settings_tell_rows_apart(store):
    pid = report(store, cw(), lte(), cw(mac="112233445566", nick="Bench 4", stage="span 2 MHz"))
    lora = build_sheets(store.get(pid)).sheets[0]
    col = {c: i for i, c in enumerate(lora.columns)}
    first, last = lora.rows[0], lora.rows[-1]
    assert (first[col["MAC"]], first[col["Unit"]], first[col["Run"]], first[col["Stage 1"]]) == \
        ("80E127FAA9F9", "Bench 3", 1, "span 1 MHz")
    # Run numbers count across the whole report, as the Summary does.
    assert (last[col["MAC"]], last[col["Unit"]], last[col["Run"]], last[col["Stage 1"]]) == \
        ("112233445566", "Bench 4", 3, "span 2 MHz")
    assert last[col["Verdict"]] == "fail" and last[col["Freq [MHz]"]] == pytest.approx(903.3)


def test_operator_and_settle_are_left_out(store):
    rs = build_sheets(store.get(report(store, cw())))
    for cols in (rs.sheets[0].columns, rs.summary_columns):
        assert "Operator" not in cols and "Settle" not in cols
    assert "Operators" not in dict(rs.facts)


def test_the_mac_column_is_there_for_a_single_unit_too(store):
    pid = report(store, cw())
    assert build_sheets(store.get(pid)).sheets[0].columns[0] == "MAC"


def test_runs_with_different_columns_share_a_table_by_name(store):
    other = cw()
    other.columns = ["Freq [MHz]", "Measured [dBm]", "CC [mA]", "Verdict"]
    other.rows = [[915.0, 13.1, 110, "pass"]]
    other.settings = [("Tone", "auto")]
    pid = report(store, cw(verdicts=("pass",)), other)
    s = build_sheets(store.get(pid)).sheets[0]
    assert s.columns[len(RUN_COLUMNS):] == \
        ["Stage 1", "Tone", "Freq [MHz]", "Set [dBm]", "Measured [dBm]", "Verdict", "CC [mA]"]
    col = {c: i for i, c in enumerate(s.columns)}
    a, b = s.rows
    assert (a[col["Tone"]], a[col["CC [mA]"]]) == ("", None)        # not measured on that run
    assert (b[col["Stage 1"]], b[col["Set [dBm]"]], b[col["CC [mA]"]]) == ("", None, 110)


def test_a_result_named_like_a_run_column_keeps_both(store):
    e = cw(verdicts=("pass",))
    e.columns = ["Run", "Verdict"]
    e.rows = [[7, "pass"]]
    s = build_sheets(store.get(report(store, e))).sheets[0]
    assert "Run (result)" in s.columns
    assert s.rows[0][s.columns.index("Run")] == 1 and s.rows[0][s.columns.index("Run (result)")] == 7


def test_an_unknown_test_is_named_by_its_title_and_names_stay_valid(store):
    e = lte()
    e.test, e.title = "rx-sens", "RX sensitivity [beta]: long title that goes on and on"
    pid = report(store, e)
    name = build_sheets(store.get(pid)).sheets[0].name
    assert len(name) <= 31 and not set(name) & set("[]:*?/\\")


def test_the_summary_lists_every_run_with_its_sheet_and_result(store):
    pid = report(store, cw(), lte())
    rs = build_sheets(store.get(pid))
    assert [r[1] for r in rs.summary_rows] == ["LoRa CW", "LTE CW"]
    assert [r[-1] for r in rs.summary_rows] == ["Fail", "Pass"]
    facts = dict(rs.facts)
    assert facts["Units"] == "80E127FAA9F9, AABBCCDDEEFF" and facts["Runs"] == "2"


def test_an_empty_report_has_no_test_sheets(store):
    rs = build_sheets(store.get(report(store)))
    assert rs.sheets == [] and rs.summary_rows == []


def test_the_workbook_holds_the_same_sheets(store):
    pid = report(store, cw(), lte(), cw(mac="112233445566"))
    resp = run(api.export_xlsx(pid))
    assert resp.media_type == api.XLSX_MEDIA_TYPE
    assert 'filename="Sonata-2-IL-rev-B_report_' in resp.headers["content-disposition"]
    assert resp.headers["content-disposition"].endswith('.xlsx"')
    wb = load_workbook(io.BytesIO(resp.body))
    assert wb.sheetnames == ["Summary", "LoRa CW", "LTE CW"]
    rs = build_sheets(store.get(pid))
    ws = wb["LoRa CW"]
    got = [list(r) for r in ws.iter_rows(values_only=True)]
    assert got[0] == rs.sheets[0].columns
    assert [[("" if v is None else v) for v in r] for r in got[1:]] == \
        [[("" if v is None else v) for v in r] for r in rs.sheets[0].rows]
    assert ws.freeze_panes == "B2" and ws.auto_filter.ref == "A1:I5"
    summary = [r for r in wb["Summary"].iter_rows(values_only=True)]
    assert summary[0][0] == "Sonata 2 IL rev B — test report"
    assert any(r[:2] == ("Run", "Test") for r in summary)
