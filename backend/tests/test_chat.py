"""The two halves of the assistant that can be wrong without anyone noticing.

Neither test talks to Gemini. What is worth pinning is the spend guard (a
limiter that quietly hands back a fresh allowance after a restart is how a free
key turns into a bill) and the table compaction, because a digest that drops or
reshapes a number would have the model reporting a measurement nobody made.
"""
from __future__ import annotations

import io
import json
import time

import pytest

from backend.chat import config, context as ctx
from backend.chat import gemini
from backend.chat.limiter import QuotaExceeded, RateLimiter, _pacific_day


# -- limiter -------------------------------------------------------------

def test_minute_limit_refuses_the_request_after_the_allowance(tmp_path):
    lim = RateLimiter(rpm=3, rpd=100, state_path=tmp_path / "q.json")
    for _ in range(3):
        lim.take()
    with pytest.raises(QuotaExceeded) as exc:
        lim.take()
    assert exc.value.scope == "minute"
    assert 0 < exc.value.retry_after_s <= 60


def test_day_limit_outranks_the_minute_limit(tmp_path):
    lim = RateLimiter(rpm=10, rpd=2, state_path=tmp_path / "q.json")
    lim.take()
    lim.take()
    with pytest.raises(QuotaExceeded) as exc:
        lim.take()
    assert exc.value.scope == "day"
    # Hours, not seconds: nothing frees up until the day rolls over.
    assert exc.value.retry_after_s > 60


def test_both_windows_survive_a_restart(tmp_path):
    """The failure this guards: bounce the backend, get the quota back.

    The minute window used to be dropped on the grounds that it is only 60 s of
    allowance. On this rig the backend is restarted constantly, so what that
    actually bought was a counter announcing a full minute's budget that Google
    then refused: confidently wrong, which is worse than absent.
    """
    path = tmp_path / "q.json"
    first = RateLimiter(rpm=10, rpd=5, state_path=path)
    first.take()
    first.take()

    second = RateLimiter(rpm=10, rpd=5, state_path=path)
    assert second.snapshot().day_used == 2
    assert second.snapshot().day_remaining == 3
    assert second.snapshot().minute_used == 2


def test_a_stale_minute_window_is_not_restored(tmp_path):
    """A backend that was down for an hour starts the minute fresh."""
    path = tmp_path / "q.json"
    path.write_text(json.dumps({
        "day": _pacific_day(time.time()),
        "day_used": 3,
        "recent": [time.time() - 3600, time.time() - 120],
        "tokens": [[time.time() - 3600, 5000]],
    }))
    lim = RateLimiter(rpm=10, rpd=50, state_path=path, tpm=1000)
    assert lim.snapshot().minute_used == 0
    assert lim.snapshot().tokens_minute == 0
    assert lim.snapshot().day_used == 3, "the day is a different window"


def test_a_quota_file_from_an_older_build_still_loads(tmp_path):
    """One without the minute windows in it. The day counts still matter."""
    path = tmp_path / "q.json"
    path.write_text(json.dumps({"day": _pacific_day(time.time()), "day_used": 4}))
    lim = RateLimiter(rpm=10, rpd=50, state_path=path, tpm=1000)
    assert lim.snapshot().day_used == 4
    assert lim.snapshot().minute_used == 0


def test_a_refused_call_is_not_charged(tmp_path):
    lim = RateLimiter(rpm=10, rpd=5, state_path=tmp_path / "q.json")
    lim.take()
    lim.refund()
    assert lim.snapshot().day_used == 0
    assert json.loads((tmp_path / "q.json").read_text())["day_used"] == 0


def test_an_upstream_429_parks_every_caller(tmp_path):
    lim = RateLimiter(rpm=10, rpd=50, state_path=tmp_path / "q.json")
    lim.block(30.0)
    with pytest.raises(QuotaExceeded) as exc:
        lim.take()
    assert exc.value.scope == "upstream"
    assert lim.snapshot().day_used == 0, "a parked call must not be charged"


def test_a_corrupt_quota_file_does_not_stop_the_chat(tmp_path):
    path = tmp_path / "q.json"
    path.write_text("{ not json")
    lim = RateLimiter(rpm=2, rpd=5, state_path=path)
    assert lim.snapshot().day_used == 0
    lim.take()


def test_tokens_are_charged_after_the_answer_not_before(tmp_path):
    """What a question costs is only known once it has been answered."""
    lim = RateLimiter(rpm=10, rpd=50, state_path=tmp_path / "q.json", tpm=1000)
    lim.take()
    assert lim.snapshot().tokens_minute == 0, "taking a slot spends no tokens"
    lim.spend_tokens(400)
    q = lim.snapshot()
    assert q.tokens_minute == 400
    assert q.tokens_remaining_minute == 600
    assert q.tokens_day == 400


def test_overshooting_the_token_ceiling_stops_the_next_question(tmp_path):
    lim = RateLimiter(rpm=10, rpd=50, state_path=tmp_path / "q.json", tpm=1000)
    lim.take()
    # One wide table can cost more than the whole minute's budget. It is not
    # refused, since it already happened, but the next one waits.
    lim.spend_tokens(1500)
    with pytest.raises(QuotaExceeded) as exc:
        lim.take()
    assert exc.value.scope == "tokens"
    assert 0 < exc.value.retry_after_s <= 60


def test_no_token_ceiling_means_no_token_refusals(tmp_path):
    lim = RateLimiter(rpm=10, rpd=50, state_path=tmp_path / "q.json", tpm=0)
    lim.take()
    lim.spend_tokens(10_000_000)
    lim.take()  # must not raise


def test_the_day_token_total_survives_a_restart(tmp_path):
    path = tmp_path / "q.json"
    first = RateLimiter(rpm=10, rpd=50, state_path=path, tpm=1000)
    first.take()
    first.spend_tokens(750)

    second = RateLimiter(rpm=10, rpd=50, state_path=path, tpm=1000)
    assert second.snapshot().tokens_day == 750
    assert second.snapshot().tokens_minute == 750, 'the ceiling follows a restart'


# -- prompt --------------------------------------------------------------

def test_the_answer_style_is_configurable_and_defaults_to_minimal(monkeypatch):
    monkeypatch.setattr(config, "ANSWER_STYLE", "minimal")
    assert "one or two sentences" in gemini.system_prompt()

    monkeypatch.setattr(config, "ANSWER_STYLE", "detailed")
    assert "one or two sentences" not in gemini.system_prompt()
    assert "reasoning" in gemini.system_prompt()

    # A typo in the environment must not drop the style entirely: an
    # unbounded answer is the expensive failure, so it falls back to minimal.
    monkeypatch.setattr(config, "ANSWER_STYLE", "concise-ish")
    assert "one or two sentences" in gemini.system_prompt()


def test_the_prompt_carries_no_stray_control_characters():
    """A LaTeX command written into a plain Python string is not text.

    In a non-raw string "\frac" is a form feed followed by "rac", and
    "\text" is a tab followed by "ext", so an instruction meant to read
    "no backslash commands such as frac or text" reached the model as
    "no rac, no <tab>ext". chr() here rather than an escape, so the check
    cannot be broken by the same mistake it is guarding against.
    """
    prompt = gemini.system_prompt()
    assert chr(12) not in prompt, "a form feed: something wrote a backslash-f"
    assert chr(9) not in prompt, "a tab: something wrote a backslash-t"
    assert "no backslash" in prompt


# -- compaction ----------------------------------------------------------

def _rows(n=50):
    return [
        {"idx": i, "freq_hz": 868_000_000, "tx_power_dbm": -5 + i * 0.25,
         "current_a": None if i == 3 else 0.1 + i * 0.001, "note": ""}
        for i in range(n)
    ]


def test_a_constant_column_is_stated_once_not_per_row():
    out = ctx.compact_table(ctx.Table("Sweep", _rows()), budget=20_000)
    assert "freq_hz=868000000" in out
    assert out.count("868000000") == 1
    assert "\tfreq_hz" not in out and "freq_hz\t" not in out


def test_an_empty_column_is_dropped_entirely():
    out = ctx.compact_table(ctx.Table("Sweep", _rows()), budget=20_000)
    assert "note" not in out


def test_summary_reports_range_and_missing_points():
    out = ctx.compact_table(ctx.Table("Sweep", _rows()), budget=20_000)
    assert "tx_power_dbm: min=-5 max=7.25" in out
    assert "missing=1" in out, "a blank cell is a point that did not measure"


def test_rows_are_sampled_not_truncated_and_say_so():
    out = ctx.compact_table(ctx.Table("Sweep", _rows(400)), budget=20_000, max_rows=20)
    assert "sampled evenly" in out
    body = out.split("sampled evenly):\n")[1].strip().splitlines()
    first_data, last_data = body[1], body[-1]
    # The last row of a sweep is usually the interesting one, so it has to
    # survive sampling; cutting the tail off would hide it.
    assert first_data.startswith("0\t")
    assert last_data.startswith("399\t")


def test_a_tight_budget_still_leaves_whole_rows():
    out = ctx.compact_table(ctx.Table("Sweep", _rows(400)), budget=900)
    body = out.split("):\n")[1].strip().splitlines()
    width = len(body[0].split("\t"))
    assert all(len(line.split("\t")) == width for line in body[1:])


def test_numbers_keep_their_value_and_lose_their_noise():
    assert ctx.fmt(-12.340000000000001) == "-12.34"
    assert ctx.fmt(868000000) == "868000000"
    assert ctx.fmt(0.1 + 0.2) == "0.3"
    assert ctx.fmt(None) == ""
    assert ctx.fmt("  a  b ") == "a b"


def test_csv_attachment_becomes_a_table():
    data = b"freq_mhz,power_dbm\n868,-12.5\n868,-12.7\n"
    out = ctx.digest_upload(data, "run.csv", budget=5000)
    assert "run.csv" in out
    assert "freq_mhz=868" in out
    assert "-12.7" in out


def test_an_unknown_file_type_is_refused_by_name():
    with pytest.raises(ValueError, match="Unsupported file type"):
        ctx.parse_upload(b"\x00\x01", "capture.bin")


def test_every_sheet_of_a_workbook_is_read():
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Results"
    ws.append(["freq_mhz", "power_dbm"])
    ws.append([868.0, -12.5])
    meta = wb.create_sheet("Run")
    meta.append(["settle_ms", 400])
    buf = io.BytesIO()
    wb.save(buf)

    out = ctx.digest_upload(buf.getvalue(), "export.xlsx", budget=5000)
    assert "export.xlsx / Results" in out
    assert "export.xlsx / Run" in out
    assert "-12.5" in out


def test_context_blocks_stop_at_the_budget_rather_than_overflowing():
    joined = ctx.join_blocks(["a" * 600, "b" * 600, "c" * 600], budget=1000)
    assert "c" * 600 not in joined
    assert "omitted" in joined
