"""Gemini-backed assistant for reading measurement results.

Three pieces, kept apart so the expensive one is the only one that needs a
network: `limiter` decides whether a question may be asked at all, `context`
turns tables into the cheapest text that still answers questions, and `gemini`
makes the one call.
"""

from . import config
from .context import Table, compact_table, digest_upload, join_blocks, parse_upload
from .gemini import Answer, NotConfigured, UpstreamError, ask
from .limiter import Quota, QuotaExceeded, RateLimiter

#: Process-wide, because the free tier is process-wide.
limiter = RateLimiter(
    config.RPM_LIMIT, config.RPD_LIMIT, config.QUOTA_FILE, tpm=config.TPM_LIMIT,
)

__all__ = [
    "Answer", "NotConfigured", "Quota", "QuotaExceeded", "RateLimiter", "Table",
    "UpstreamError", "ask", "compact_table", "config", "digest_upload",
    "join_blocks", "limiter", "parse_upload",
]
