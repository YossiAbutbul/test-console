"""The assistant stays off until it is switched on.

Hiding the panel is not enough on its own. The routes stay mounted whatever the
UI does, so a switch that only dressed the window would still spend quota for
anything that called /chat/ask directly.

The routes are called as functions rather than over HTTP: FastAPI's TestClient
needs httpx, which this backend does not otherwise require, and nothing here
depends on the HTTP layer.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from backend.api import chat as routes
from backend.chat import config


def test_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("CHAT_ENABLED", raising=False)
    assert config.enabled() is False
    for value in ("1", "true", "yes", "on", "ON"):
        monkeypatch.setenv("CHAT_ENABLED", value)
        assert config.enabled() is True, value
    for value in ("", "0", "false", "no", "maybe"):
        monkeypatch.setenv("CHAT_ENABLED", value)
        assert config.enabled() is False, value


def test_status_reports_the_switch(monkeypatch):
    monkeypatch.delenv("CHAT_ENABLED", raising=False)
    assert routes.status().enabled is False
    monkeypatch.setenv("CHAT_ENABLED", "1")
    assert routes.status().enabled is True


def test_asking_while_off_is_refused_and_costs_no_quota(monkeypatch):
    monkeypatch.delenv("CHAT_ENABLED", raising=False)
    before = routes.status().quota.day_remaining

    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.ask(routes.AskRequest(question="anything")))
    assert exc.value.status_code == 503
    assert "switched off" in exc.value.detail

    assert routes.status().quota.day_remaining == before


def test_attaching_while_off_is_refused(monkeypatch):
    monkeypatch.delenv("CHAT_ENABLED", raising=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.attach(
            routes.AttachRequest(filename="run.csv", content_b64="YQ=="),
        ))
    assert exc.value.status_code == 503
