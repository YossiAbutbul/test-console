"""The built UI must reach the browser without a hard refresh.

index.html used to go out with no Cache-Control, so the browser served its
cached copy -- naming the previous build's JS -- after every rebuild. These pin
the two halves of the fix: the page revalidates, the hashed assets never do.

Called as functions, not over HTTP, for the reason in test_chat_switch.py.
"""
from __future__ import annotations

import asyncio

import pytest

from backend import main

pytestmark = pytest.mark.skipif(
    not main.SPA_INDEX.is_file(), reason="frontend/dist not built"
)


def test_index_is_revalidated():
    assert asyncio.run(main.index()).headers["cache-control"] == "no-cache"


def test_client_routes_are_revalidated_too():
    """A reload on /lora/cw lands on the fallback, not on `/`."""
    r = asyncio.run(main.spa_fallback("lora/cw", None))
    assert r.headers["cache-control"] == "no-cache"


def test_hashed_assets_are_cached_for_good():
    assets = main.FRONTEND_DIST / "assets"
    name = next(p.name for p in assets.iterdir() if p.is_file())
    app = main._HashedAssets(directory=assets)
    scope = {"type": "http", "method": "GET", "headers": []}
    r = asyncio.run(app.get_response(name, scope))
    assert r.status_code == 200
    assert "immutable" in r.headers["cache-control"]
