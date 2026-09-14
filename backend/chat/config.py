"""Where the assistant's settings come from.

Everything is read from the environment at import time except the API key,
which is re-read on every call so the operator can drop a key file in and use
it without restarting the backend (backend changes need a restart, a key does
not).

The free tier is a *shared* budget: one key, one project, so every operator
pointing a browser at this backend spends from the same pot. That is why the
limits live here and are enforced centrally rather than per client.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

#: Fallback for the key when GEMINI_API_KEY is not in the environment.
#: Git-ignored; one line, the key and nothing else.
KEY_FILE = REPO_ROOT / ".gemini_key"

#: Where the day/minute counters survive a restart. Without this a backend
#: bounce would hand back a full day's quota, which is exactly the overage the
#: limiter exists to prevent.
QUOTA_FILE = REPO_ROOT / ".chat-quota.json"

API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# The real free-tier ceilings for gemini-3.6-flash, read off the AI Studio
# dashboard (ai.dev/rate-limit) rather than guessed: 5 requests per minute,
# 20 per day, 250k input tokens per minute. Each default sits just under its
# ceiling, because a counter is only useful if it refuses before Google does.
#
# They were 8/min and 200/day, which was worse than no limiter at all: the
# panel offered "185 questions left today" while Google had already stopped
# answering at 20. Read the dashboard before changing them, and read it again
# after changing model, since the ceilings differ per model.
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
RPM_LIMIT = int(os.getenv("CHAT_RPM_LIMIT", "4"))
RPD_LIMIT = int(os.getenv("CHAT_RPD_LIMIT", "18"))

#: Tokens per rolling minute. Well clear of the request ceilings in practice
#: (a day's worth of questions is about 20k tokens against a 250k allowance),
#: so this is a backstop for one enormous table rather than the limit that
#: bites. Counted after the fact, from what Gemini reports it charged.
TPM_LIMIT = int(os.getenv("CHAT_TPM_LIMIT", "200000"))

#: How much scratchpad the model gets. Thinking tokens are billed like output
#: and count against the per-minute token ceiling, so this stays at the floor:
#: the questions asked here are "read this table and tell me what it says".
#:
#: Gemini 3 took the old `thinkingBudget` away (it answers 400 to it) and
#: replaced it with a level, and LOW really is the floor: a trivial question
#: still spends ~60 thought tokens. Set this empty to send no preference at
#: all, or HIGH if an answer needs the room.
THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "LOW").strip().upper()

#: "minimal" (one or two sentences) or "detailed". See ANSWER_STYLES.
ANSWER_STYLE = os.getenv("CHAT_ANSWER_STYLE", "minimal").strip().lower()

MAX_OUTPUT_TOKENS = int(os.getenv("CHAT_MAX_OUTPUT_TOKENS", "1200"))
TEMPERATURE = float(os.getenv("CHAT_TEMPERATURE", "0.2"))
REQUEST_TIMEOUT_S = float(os.getenv("CHAT_TIMEOUT_S", "60"))

# Character budgets for what gets sent as context. Characters rather than
# tokens because we have no tokenizer here and ~4 chars/token is close enough
# for a ceiling. Tables are compacted (see context.py) before these bite.
MAX_CONTEXT_CHARS = int(os.getenv("CHAT_MAX_CONTEXT_CHARS", "24000"))
MAX_BLOCK_CHARS = int(os.getenv("CHAT_MAX_BLOCK_CHARS", "12000"))
#: Turns of history kept. Each one is re-sent on every request, so this is the
#: single biggest lever on tokens-per-question.
MAX_HISTORY_TURNS = int(os.getenv("CHAT_MAX_HISTORY_TURNS", "8"))

#: Upload ceiling for an attached workbook, before parsing.
MAX_UPLOAD_BYTES = int(os.getenv("CHAT_MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))


def api_key() -> str | None:
    """The key, from the environment or the key file. None when unconfigured."""
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if key:
        return key
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return key or None
