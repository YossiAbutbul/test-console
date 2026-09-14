"""The Gemini call itself.

Deliberately stdlib-only. Adding httpx for one POST would mean a pip install on
the rig PC, and the rest of this repo's setup story is "clone and run"; a
blocking urllib call handed to a worker thread does the same job. There is no
streaming for the same reason: one request, one answer, one charge against the
quota, which is also what makes the limiter's accounting exact.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from . import config
from .limiter import QuotaExceeded

log = logging.getLogger(__name__)

#: Appended to the prompt, chosen by CHAT_ANSWER_STYLE. "minimal" is the
#: default because an answer about a measurement is usually one fact: it is
#: read between runs with the rig live, and every extra paragraph is output
#: tokens off the same free-tier budget.
ANSWER_STYLES = {
    "minimal": (
        "Answer in one or two sentences. State the finding and stop. No "
        "preamble, no summary of what you were given, no offer to do more. "
        'Where several points genuinely need separating, at most four "- " '
        "lines, each one short. Do not explain your reasoning unless the "
        "answer is that something is wrong, in which case give the one "
        "observation that says so."
    ),
    "detailed": (
        "Answer in a few sentences or a short list, and give the reasoning "
        "behind a finding where it would let the operator check it against "
        "the bench."
    ),
}

BASE_PROMPT = """\
You are the assistant built into an RF test console. The operator runs power, \
modulation, LTE, load-pull and sweep measurements against a device under test \
using a signal generator, spectrum analyser, VNA, power sensor, DC power \
analyser, a trombone line and an RF switch.

You are given measurement tables as context. Read them as exactly what they \
are and nothing more:

- Every number you state must come from the context. If the context does not \
  contain it, say so instead of estimating.
- Row samples are marked when they are samples. Do not describe a sampled \
  table as complete, and prefer the per-column summary for anything about the \
  whole set.
- Blank cells mean the value was not measured or the point failed; they are \
  not zeros.
- dBm, dB, mA/A, MHz/Hz, ohms and mm appear in column names. Keep the units \
  the column gives and never silently convert.

Lead with the finding, not with a restatement of the question.

Write plain prose. No headings, no tables, and no markdown emphasis around \
figures: write "30.5 dBm", never "**30.5 dBm**". Where a list reads better \
than a sentence, use lines opening with "- ".

Do not use dashes as punctuation. No em dashes, and no "--" standing in for \
one. Use a comma, a full stop, or brackets.

No LaTeX or maths notation of any kind: no $ or $$ delimiters, no backslash \
commands such as frac or text, no braced subscripts like V_{DC}. Write a \
formula the way it would be typed into a spreadsheet, as \
"PAE = (Pout - Pin) / (Vdc * Idc)", naming the quantities with the column \
names the data actually uses.

Flag anything that looks like a measurement fault (a point far off its \
neighbours, a rail that did not move, a current that did not follow power) as \
something to check rather than as a result.
"""


def system_prompt() -> str:
    """The prompt as configured, read per call so the style can change without
    a restart once the setting itself has been re-read."""
    style = ANSWER_STYLES.get(config.ANSWER_STYLE, ANSWER_STYLES["minimal"])
    return f"{BASE_PROMPT}\n{style}\n"


@dataclass
class Answer:
    text: str
    prompt_tokens: int
    output_tokens: int
    total_tokens: int
    model: str


class NotConfigured(Exception):
    """No API key on this machine."""


class UpstreamError(Exception):
    """Gemini answered, but not with an answer."""


def _endpoint(model: str, key: str) -> urllib.request.Request:
    url = f"{config.API_BASE}/models/{model}:generateContent"
    req = urllib.request.Request(url, method="POST")
    # The key goes in a header, never the query string: URLs end up in access
    # logs and in uvicorn's console, and this one is a credential.
    req.add_header("x-goog-api-key", key)
    req.add_header("Content-Type", "application/json")
    return req


def _body(history: list[dict[str, str]], prompt: str) -> dict[str, Any]:
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user",
         "parts": [{"text": m["content"]}]}
        for m in history
    ]
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    body: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system_prompt()}]},
        "contents": contents,
        "generationConfig": {
            "temperature": config.TEMPERATURE,
            "maxOutputTokens": config.MAX_OUTPUT_TOKENS,
        },
    }
    # Thinking tokens are charged like output and count against the per-minute
    # token ceiling, which on the free tier is the limit that bites first on a
    # long table, hence the floor by default. The field is `thinkingLevel`,
    # not the `thinkingBudget` the 2.x models took: Gemini 3 answers a flat
    # "400 invalid argument" to the old spelling, with nothing naming the field.
    if config.THINKING_LEVEL:
        body["generationConfig"]["thinkingConfig"] = {
            "thinkingLevel": config.THINKING_LEVEL,
        }
    return body


def _extract(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        fb = (payload.get("promptFeedback") or {}).get("blockReason")
        raise UpstreamError(f"Gemini returned no answer ({fb or 'no candidates'}).")
    cand = candidates[0]
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if text:
        return text
    reason = cand.get("finishReason") or "unknown"
    if reason == "MAX_TOKENS":
        # The model thinks before it writes and thinking cannot be switched
        # off, so this is an answer that was cut mid-write, or one whose
        # scratchpad ate the whole allowance before a word of it was written.
        raise UpstreamError(
            "The answer hit the output limit before any text came back. Ask for "
            "something narrower, or raise CHAT_MAX_OUTPUT_TOKENS."
        )
    raise UpstreamError(f"Gemini returned an empty answer ({reason}).")


#: Codes worth trying again unchanged: the model was busy, not the request
#: wrong. 503 is "this model is currently experiencing high demand", which
#: clears in seconds and should never have reached the operator as a failure.
RETRY_CODES = (500, 502, 503, 504)
RETRY_BACKOFF_S = (1.0, 3.0)

#: Margin on top of the delay Google names, for clock skew between here and
#: there. The delay counts down in real time and a refused attempt does not
#: push it out, so it is worth honouring rather than rounding up to a flat
#: minute. It is only a hint, though: when the ceiling reached is the daily
#: one, waiting the named seconds changes nothing and the next call is refused
#: again. The local day counter is what should stop us first.
UPSTREAM_MARGIN_S = 2.0

#: Boilerplate Google appends to every quota message. Useful once; noise in a
#: chat panel that is 300 px wide.
_NOISE = re.compile(
    r"\s*(For more information on this error, head to:|To monitor your current "
    r"usage, head to:)\s*\S+",
)


def _trim(detail: str) -> str:
    """The part of an API error worth putting in front of the operator."""
    return _NOISE.sub("", detail or "").strip()


def _retry_after(detail: str, body: dict[str, Any] | None) -> float:
    """How long Google says to wait, in seconds.

    It says so twice (a RetryInfo entry in `error.details`, and in prose at the
    end of the message) and neither is always present. Falling back to a flat
    minute would park the panel for 60 s when the real wait was 14.
    """
    for item in ((body or {}).get("error", {}).get("details") or []):
        delay = str(item.get("retryDelay", ""))
        m = re.fullmatch(r"([\d.]+)s", delay)
        if m:
            return float(m.group(1))
    m = re.search(r"retry in ([\d.]+)\s*s", detail or "", re.I)
    if m:
        return float(m.group(1))
    return 60.0


def _call(req: urllib.request.Request, data: bytes) -> dict[str, Any]:
    for attempt in range(len(RETRY_BACKOFF_S) + 1):
        try:
            with urllib.request.urlopen(req, data, timeout=config.REQUEST_TIMEOUT_S) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail, body = "", None
            try:
                body = json.loads(exc.read().decode("utf-8"))
                detail = body.get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001 - the error body is best-effort
                pass
            if exc.code == 429:
                # Our own counters sit below the published ceiling, so a 429
                # means the ceiling moved, or something else is spending the
                # same key. The delay Google names is when a slot frees, so
                # park every caller for exactly that: it counts down in real
                # time and a refused attempt does not extend it. What makes it
                # grow is another caller on the same key, which no amount of
                # waiting here can fix.
                wait = _retry_after(detail, body) + UPSTREAM_MARGIN_S
                # The message names a number but not the period it belongs
                # to, and it is usually the daily one: a "limit: 20" here was
                # read as per-minute for a while, which made the panel look
                # broken rather than out of budget for the day.
                ceiling = re.search(r"limit:\s*(\d+)", detail or "")
                where = f" (its ceiling for {config.MODEL} is {ceiling.group(1)})" if ceiling else ""
                raise QuotaExceeded(
                    "upstream", wait,
                    f"Gemini's own free-tier limit was hit{where}. Waiting "
                    f"{int(wait + 0.5)} s. If that is the daily ceiling it will "
                    "not clear until midnight Pacific, whatever the wait says. "
                    "This is Google's counter, not the one above, so anything "
                    "else using the same key spends from it too.",
                ) from exc
            if exc.code in (401, 403):
                raise NotConfigured(
                    "Gemini rejected the API key" + (f": {_trim(detail)}" if detail else ".")
                ) from exc
            if exc.code in RETRY_CODES:
                # The model is busy, not the request wrong. One charge against
                # the quota covers all the tries: Google does not bill a 503.
                if attempt < len(RETRY_BACKOFF_S):
                    log.info("gemini %s, retrying in %ss", exc.code, RETRY_BACKOFF_S[attempt])
                    time.sleep(RETRY_BACKOFF_S[attempt])
                    continue
                raise UpstreamError(
                    f"Gemini is busy (HTTP {exc.code}). Tried "
                    f"{len(RETRY_BACKOFF_S) + 1} times over "
                    f"{int(sum(RETRY_BACKOFF_S))} s. Ask again in a moment."
                ) from exc
            raise UpstreamError(
                f"Gemini returned HTTP {exc.code}: {_trim(detail) or exc.reason}"
            ) from exc
        except urllib.error.URLError as exc:
            raise UpstreamError(f"Could not reach Gemini: {exc.reason}") from exc

    # Unreachable: the loop either returns, retries, or raises.
    raise UpstreamError("Gemini did not answer.")


def ask(history: list[dict[str, str]], prompt: str) -> Answer:
    """Blocking. Call it from a worker thread."""
    key = config.api_key()
    if not key:
        raise NotConfigured(
            "No Gemini API key. Set GEMINI_API_KEY in the environment, or put the "
            f"key in {config.KEY_FILE.name} at the repo root."
        )
    model = config.MODEL
    payload = _call(_endpoint(model, key), json.dumps(_body(history, prompt)).encode("utf-8"))
    usage = payload.get("usageMetadata") or {}
    return Answer(
        text=_extract(payload),
        prompt_tokens=int(usage.get("promptTokenCount", 0)),
        output_tokens=int(usage.get("candidatesTokenCount", 0)),
        total_tokens=int(usage.get("totalTokenCount", 0)),
        model=model,
    )
