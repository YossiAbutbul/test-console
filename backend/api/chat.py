"""Routes for the assistant panel: quota, attachments, questions.

The browser never talks to Gemini directly. Everything goes through here so
that the API key stays on this machine and so that one counter sees every
question: the free tier is a per-key budget, and a per-browser limit would only
divide it, not cap it.

Uploads arrive base64 in a JSON body rather than as multipart form data:
FastAPI needs python-multipart for `UploadFile`, and nothing else in this
backend has ever needed it.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..chat import (
    NotConfigured, QuotaExceeded, Table, UpstreamError, ask as gemini_ask,
    compact_table, config, digest_upload, join_blocks, limiter,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class Message(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ContextBlock(BaseModel):
    """One thing the assistant may look at.

    Either a table (the page's live results, sent as records) or ready-made
    text (the digest of an attached workbook, which this backend produced
    earlier and the browser handed back rather than re-uploading).
    """
    title: str
    rows: list[dict] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    text: str | None = None


class AskRequest(BaseModel):
    question: str
    history: list[Message] = Field(default_factory=list)
    context: list[ContextBlock] = Field(default_factory=list)


class QuotaOut(BaseModel):
    minute_limit: int
    minute_remaining: int
    day_limit: int
    day_remaining: int
    #: 0 when no per-minute token ceiling is configured.
    token_limit_minute: int
    tokens_minute: int
    tokens_remaining_minute: int
    tokens_day: int
    retry_after_s: float
    day_resets_in_s: float
    #: True when the wait is Google's, not ours.
    blocked_upstream: bool


class AskResponse(BaseModel):
    reply: str
    model: str
    prompt_tokens: int
    output_tokens: int
    quota: QuotaOut


class StatusResponse(BaseModel):
    #: False when CHAT_ENABLED is not set. The panel hides itself entirely.
    enabled: bool
    configured: bool
    model: str
    quota: QuotaOut


class AttachRequest(BaseModel):
    filename: str
    #: base64, no data: prefix.
    content_b64: str


class AttachResponse(BaseModel):
    filename: str
    digest: str
    chars: int


def _quota_out() -> QuotaOut:
    q = limiter.snapshot()
    return QuotaOut(
        minute_limit=q.minute_limit,
        minute_remaining=q.minute_remaining,
        day_limit=q.day_limit,
        day_remaining=q.day_remaining,
        token_limit_minute=q.token_limit_minute,
        tokens_minute=q.tokens_minute,
        tokens_remaining_minute=q.tokens_remaining_minute,
        tokens_day=q.tokens_day,
        retry_after_s=round(q.retry_after_s, 1),
        day_resets_in_s=round(q.day_resets_in_s, 1),
        blocked_upstream=q.blocked_upstream,
    )


def _block_text(block: ContextBlock) -> str:
    if block.text:
        return block.text[:config.MAX_BLOCK_CHARS]
    if not block.rows:
        return ""
    table = Table(name=block.title, rows=block.rows, columns=block.columns)
    return compact_table(table, budget=config.MAX_BLOCK_CHARS)


def _build_prompt(req: AskRequest) -> str:
    blocks = [t for t in (_block_text(b) for b in req.context) if t]
    if not blocks:
        return req.question
    body = join_blocks(blocks, budget=config.MAX_CONTEXT_CHARS)
    return f"CONTEXT\n{body}\n\nQUESTION\n{req.question}"


@router.get("/status", response_model=StatusResponse)
def status() -> StatusResponse:
    return StatusResponse(
        enabled=config.enabled(),
        configured=config.api_key() is not None,
        model=config.MODEL,
        quota=_quota_out(),
    )


@router.post("/attach", response_model=AttachResponse)
async def attach(req: AttachRequest) -> AttachResponse:
    """Parse a workbook or CSV into the compact text the model will read.

    Done here, once, rather than in the browser: the digest that comes back is
    what gets re-sent with every follow-up question, so it is worth spending
    the parse to make it small. Costs no quota, since nothing is sent to Gemini.
    """
    if not config.enabled():
        raise HTTPException(status_code=503, detail="The assistant is switched off.")
    try:
        data = base64.b64decode(req.content_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Malformed upload: {exc}") from exc
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{req.filename} is {len(data) // (1024 * 1024)} MB; the limit is "
                   f"{config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    try:
        digest = await asyncio.to_thread(
            digest_upload, data, req.filename, budget=config.MAX_BLOCK_CHARS,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - openpyxl raises a zoo of these
        log.exception("could not parse %s", req.filename)
        raise HTTPException(
            status_code=400, detail=f"Could not read {req.filename}: {exc}",
        ) from exc
    return AttachResponse(filename=req.filename, digest=digest, chars=len(digest))


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest) -> AskResponse:
    if not config.enabled():
        raise HTTPException(
            status_code=503,
            detail="The assistant is switched off. Set CHAT_ENABLED=1 and restart "
                   "the backend to use it.",
        )
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Ask something first.")

    prompt = _build_prompt(req)
    # Oldest turns go first: the context block travels with the current
    # question, so a trimmed history costs nothing but the model's memory of
    # what was already said.
    history = [
        {"role": m.role, "content": m.content}
        for m in req.history[-config.MAX_HISTORY_TURNS * 2:]
    ]

    try:
        limiter.take()
    except QuotaExceeded as exc:
        raise HTTPException(
            status_code=429, detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.retry_after_s)))},
        ) from exc

    try:
        answer = await asyncio.to_thread(gemini_ask, history, prompt)
    except QuotaExceeded as exc:
        # Google refused it, so the charge we just took was never spent.
        limiter.refund()
        limiter.block(exc.retry_after_s)
        raise HTTPException(
            status_code=429, detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.retry_after_s)))},
        ) from exc
    except NotConfigured as exc:
        limiter.refund()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except UpstreamError as exc:
        limiter.refund()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Charged after the fact: what a question costs is only known once it has
    # been answered. The ceiling it counts against is enforced on the next one.
    limiter.spend_tokens(answer.total_tokens)

    return AskResponse(
        reply=answer.text,
        model=answer.model,
        prompt_tokens=answer.prompt_tokens,
        output_tokens=answer.output_tokens,
        quota=_quota_out(),
    )
