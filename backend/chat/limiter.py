"""The spend guard in front of Gemini.

One shared key means one shared quota, so this counts requests for the whole
backend rather than per caller. Two windows are tracked:

* a rolling 60 s window, which is what the per-minute limit is actually
  measured against (a fixed clock minute would let 2x through across a
  boundary);
* a calendar day, which Google resets at midnight Pacific.

Tokens are tracked over the same two windows. They cannot be charged up front
(what a question costs is only known once Gemini answers) so the token ceiling
is enforced on the *next* question rather than this one: spend over the line and
the following request waits for the window to clear. That is the right way round
for a free tier, where the penalty for one long question is a pause and the
penalty for ignoring the ceiling is a refused key.

Both windows are written to disk after every request. A restart mid-day must
not hand back a fresh allowance, which is the one failure mode that can walk
into a paid overage without anyone noticing, and a restart mid-minute must not
either, or the counter shows a full minute's budget that Google will refuse.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger(__name__)

#: Google resets the daily request count at midnight Pacific. Pacific is
#: UTC-8 in winter and UTC-7 in summer, and zoneinfo has no tz database to read
#: on Windows, so the offset is fixed at -8. During DST that makes our day roll
#: over an hour *after* Google's, which spends less than the allowance rather
#: than more, which is the right way round to be wrong.
_PACIFIC = timezone(timedelta(hours=-8))


class QuotaExceeded(Exception):
    """Raised instead of calling Gemini when the local budget is spent."""

    def __init__(self, scope: str, retry_after_s: float, message: str) -> None:
        super().__init__(message)
        self.scope = scope           # "minute" | "day" | "upstream"
        self.retry_after_s = retry_after_s


@dataclass
class Quota:
    """What is left, for the UI's counter."""
    minute_limit: int
    minute_used: int
    day_limit: int
    day_used: int
    token_limit_minute: int
    tokens_minute: int
    tokens_day: int
    retry_after_s: float
    day_resets_in_s: float
    #: True when it is Google refusing, not our own budget. The two are
    #: different counters and only one of them is ours to reason about.
    blocked_upstream: bool = False

    @property
    def minute_remaining(self) -> int:
        return max(0, self.minute_limit - self.minute_used)

    @property
    def day_remaining(self) -> int:
        return max(0, self.day_limit - self.day_used)

    @property
    def tokens_remaining_minute(self) -> int:
        return max(0, self.token_limit_minute - self.tokens_minute)


def _pacific_day(ts: float) -> str:
    return datetime.fromtimestamp(ts, _PACIFIC).strftime("%Y-%m-%d")


def _next_pacific_midnight(ts: float) -> float:
    now = datetime.fromtimestamp(ts, _PACIFIC)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.timestamp()


class RateLimiter:
    """Global request budget. Thread-safe; `take()` is all-or-nothing."""

    def __init__(self, rpm: int, rpd: int, state_path: Path, tpm: int = 0) -> None:
        self.rpm = rpm
        self.rpd = rpd
        self.tpm = tpm
        self._path = state_path
        self._lock = threading.Lock()
        self._recent: deque[float] = deque()   # timestamps inside the last 60 s
        self._tokens: deque[tuple[float, int]] = deque()  # (ts, tokens), last 60 s
        self._day = ""
        self._day_used = 0
        self._day_tokens = 0
        #: Set when Google itself answers 429. Until it passes we do not call
        #: again at all: hammering a refused quota is how a key gets a longer
        #: cool-off than the one it was given.
        self._blocked_until = 0.0
        self._load()

    # -- persistence ------------------------------------------------------
    def _load(self) -> None:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        self._day = str(data.get("day", ""))
        self._day_used = int(data.get("day_used", 0))
        self._day_tokens = int(data.get("day_tokens", 0))
        self._blocked_until = float(data.get("blocked_until", 0.0))
        try:
            self._recent = deque(float(t) for t in data.get("recent", []))
            self._tokens = deque(
                (float(ts), int(n)) for ts, n in data.get("tokens", [])
            )
        except (TypeError, ValueError):
            # A file from an older build, or a half-written one. The day counts
            # above are the ones worth salvaging; these rebuild in a minute.
            self._recent, self._tokens = deque(), deque()
        # Anything older than the window is dropped here, so a backend that was
        # down for an hour starts with an empty minute rather than a stale one.
        self._roll(time.time())

    def _save(self) -> None:
        payload = {
            "day": self._day,
            "day_used": self._day_used,
            "day_tokens": self._day_tokens,
            "blocked_until": self._blocked_until,
            # The minute windows are persisted too, at a cost of a few dozen
            # numbers. They were left out as "only 60 s of allowance", which
            # was wrong on this rig: the backend gets restarted constantly, and
            # every restart had the counter announce a full minute's budget it
            # did not have. A counter that is confidently wrong is worse than
            # no counter.
            "recent": list(self._recent),
            "tokens": [list(t) for t in self._tokens],
        }
        try:
            self._path.write_text(json.dumps(payload), encoding="utf-8")
        except OSError as exc:  # a read-only checkout should not kill the chat
            log.warning("could not persist chat quota: %s", exc)

    # -- accounting -------------------------------------------------------
    def _roll(self, now: float) -> None:
        today = _pacific_day(now)
        if today != self._day:
            self._day = today
            self._day_used = 0
            self._day_tokens = 0
        while self._recent and now - self._recent[0] >= 60.0:
            self._recent.popleft()
        while self._tokens and now - self._tokens[0][0] >= 60.0:
            self._tokens.popleft()

    def _snapshot(self, now: float) -> Quota:
        retry = 0.0
        if self._blocked_until > now:
            retry = self._blocked_until - now
        elif len(self._recent) >= self.rpm and self._recent:
            retry = 60.0 - (now - self._recent[0])
        elif self.tpm and self._minute_tokens() >= self.tpm and self._tokens:
            retry = 60.0 - (now - self._tokens[0][0])
        elif self._day_used >= self.rpd:
            retry = _next_pacific_midnight(now) - now
        return Quota(
            blocked_upstream=self._blocked_until > now,
            minute_limit=self.rpm,
            minute_used=len(self._recent),
            day_limit=self.rpd,
            day_used=self._day_used,
            token_limit_minute=self.tpm,
            tokens_minute=self._minute_tokens(),
            tokens_day=self._day_tokens,
            retry_after_s=max(0.0, retry),
            day_resets_in_s=max(0.0, _next_pacific_midnight(now) - now),
        )

    def _minute_tokens(self) -> int:
        return sum(n for _, n in self._tokens)

    def snapshot(self) -> Quota:
        with self._lock:
            now = time.time()
            self._roll(now)
            return self._snapshot(now)

    def take(self) -> Quota:
        """Charge one request, or raise QuotaExceeded without charging."""
        with self._lock:
            now = time.time()
            self._roll(now)
            if self._blocked_until > now:
                wait = self._blocked_until - now
                raise QuotaExceeded(
                    "upstream", wait,
                    f"Gemini refused the last request for quota. Waiting {int(wait)} s "
                    "before trying again.",
                )
            if self._day_used >= self.rpd:
                wait = _next_pacific_midnight(now) - now
                raise QuotaExceeded(
                    "day", wait,
                    f"Daily free-tier budget spent ({self._day_used}/{self.rpd} requests). "
                    f"It resets in {int(wait // 3600)} h {int(wait % 3600 // 60)} min.",
                )
            if self.tpm and self._minute_tokens() >= self.tpm:
                wait = 60.0 - (now - self._tokens[0][0])
                raise QuotaExceeded(
                    "tokens", wait,
                    f"Token budget for this minute is spent "
                    f"({self._minute_tokens():,}/{self.tpm:,}). Try again in "
                    f"{max(1, int(wait + 0.5))} s.",
                )
            if len(self._recent) >= self.rpm:
                wait = 60.0 - (now - self._recent[0])
                raise QuotaExceeded(
                    "minute", wait,
                    f"Per-minute limit reached ({self.rpm}/min). Try again in "
                    f"{max(1, int(wait + 0.5))} s.",
                )
            self._recent.append(now)
            self._day_used += 1
            self._save()
            return self._snapshot(now)

    def spend_tokens(self, tokens: int) -> None:
        """Record what an answer actually cost, once Gemini has said so."""
        if tokens <= 0:
            return
        with self._lock:
            now = time.time()
            self._roll(now)
            self._tokens.append((now, tokens))
            self._day_tokens += tokens
            self._save()

    def refund(self) -> None:
        """Give back a charge the call never actually spent (e.g. a timeout)."""
        with self._lock:
            if self._recent:
                self._recent.pop()
            self._day_used = max(0, self._day_used - 1)
            self._save()

    def block(self, seconds: float) -> None:
        """Park all calls after Google answered 429."""
        with self._lock:
            self._blocked_until = max(self._blocked_until, time.time() + seconds)
            self._save()
