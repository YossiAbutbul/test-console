"""What the assistant does when Gemini answers with something other than an answer.

All of it is about one question: which failures should the operator ever see?
A model that is briefly busy should not reach the panel at all, and a refusal
that carries its own retry time should be honoured rather than rounded up to a
flat minute of dead panel.
"""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

from backend.chat import gemini
from backend.chat.limiter import QuotaExceeded


def _http_error(code: int, message: str = "", details: list | None = None):
    body = {"error": {"message": message}}
    if details is not None:
        body["error"]["details"] = details
    return urllib.error.HTTPError(
        "https://example/api", code, "err", {},
        io.BytesIO(json.dumps(body).encode("utf-8")),
    )


def _ok_response(text: str = "fine"):
    payload = {
        "candidates": [{"content": {"parts": [{"text": text}]}}],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2, "totalTokenCount": 12},
    }

    class _Res(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return _Res(json.dumps(payload).encode("utf-8"))


@pytest.fixture
def no_sleep(monkeypatch):
    """Retries are real seconds; the test should not spend them."""
    slept: list[float] = []
    monkeypatch.setattr(gemini.time, "sleep", slept.append)
    return slept


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setattr(gemini.config, "api_key", lambda: "test-key")


def test_a_busy_model_is_retried_rather_than_shown_to_the_operator(monkeypatch, no_sleep):
    """503 is "this model is currently experiencing high demand". It clears in
    seconds, and it was reaching the panel as a failed question."""
    calls = []

    def fake(req, data, timeout):  # noqa: ARG001
        calls.append(1)
        if len(calls) < 3:
            raise _http_error(503, "The model is overloaded.")
        return _ok_response("recovered")

    monkeypatch.setattr(gemini.urllib.request, "urlopen", fake)
    answer = gemini.ask([], "question")
    assert answer.text == "recovered"
    assert len(calls) == 3
    assert no_sleep == [1.0, 3.0], "backs off between tries instead of hammering"


def test_a_model_busy_throughout_says_so_plainly(monkeypatch, no_sleep):
    monkeypatch.setattr(
        gemini.urllib.request, "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(_http_error(503, "overloaded")),
    )
    with pytest.raises(gemini.UpstreamError, match="busy"):
        gemini.ask([], "question")


def test_a_bad_request_is_not_retried(monkeypatch, no_sleep):
    """400 means the request itself is wrong. Sending it twice more wastes
    four seconds to arrive at the same answer."""
    calls = []

    def fake(req, data, timeout):  # noqa: ARG001
        calls.append(1)
        raise _http_error(400, "Invalid argument")

    monkeypatch.setattr(gemini.urllib.request, "urlopen", fake)
    with pytest.raises(gemini.UpstreamError):
        gemini.ask([], "question")
    assert len(calls) == 1
    assert no_sleep == []


def test_google_s_own_retry_time_is_honoured(monkeypatch, no_sleep):
    monkeypatch.setattr(
        gemini.urllib.request, "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            _http_error(429, "Quota exceeded for metric: x, limit: 20. Please retry in 13.7s."),
        ),
    )
    with pytest.raises(QuotaExceeded) as exc:
        gemini.ask([], "question")
    # Not the 60 s fallback, and not rounded up "to be safe": the stated delay
    # is a real countdown to a free slot, and parking the panel for a minute
    # when the wait was fourteen seconds reads as a broken chat.
    assert 15 < exc.value.retry_after_s < 16, "13.7 s plus the skew margin"
    # The message must not claim a period Google did not name: the
    # ceiling it reports is usually the daily one.
    assert "ceiling" in str(exc.value)
    assert "per minute" not in str(exc.value)


def test_a_retry_delay_in_the_error_details_is_used_too(monkeypatch, no_sleep):
    monkeypatch.setattr(
        gemini.urllib.request, "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            _http_error(429, "Quota exceeded.", details=[{"retryDelay": "8s"}]),
        ),
    )
    with pytest.raises(QuotaExceeded) as exc:
        gemini.ask([], "question")
    assert exc.value.retry_after_s == 8.0 + gemini.UPSTREAM_MARGIN_S


def test_no_dashes_are_used_as_punctuation_in_what_the_panel_shows(monkeypatch, no_sleep):
    """The panel is read at a bench, not in a document. A stray "--" in an
    error message is the sort of thing that gets copied into a report."""
    monkeypatch.setattr(
        gemini.urllib.request, "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            _http_error(429, "Quota exceeded, limit: 20. Please retry in 5s."),
        ),
    )
    with pytest.raises(QuotaExceeded) as exc:
        gemini.ask([], "question")
    assert "--" not in str(exc.value)
    assert chr(8212) not in str(exc.value), "em dash"


def test_the_url_boilerplate_is_stripped_from_what_the_panel_shows():
    noisy = (
        "You exceeded your current quota. For more information on this error, head "
        "to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your "
        "current usage, head to: https://ai.dev/rate-limit. Please retry in 5s."
    )
    trimmed = gemini._trim(noisy)
    assert "http" not in trimmed
    assert "You exceeded your current quota." in trimmed


def test_a_rejected_key_is_reported_as_configuration_not_as_a_failed_question(monkeypatch, no_sleep):
    monkeypatch.setattr(
        gemini.urllib.request, "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(_http_error(403, "API key not valid")),
    )
    with pytest.raises(gemini.NotConfigured, match="rejected the API key"):
        gemini.ask([], "question")
