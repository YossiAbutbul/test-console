"""Refuse requests that a web page on another site made from the operator's browser.

The API binds to localhost, but that does not stop a page open in the same
browser from reaching it: the browser sends the request, and the routes key the
DUT, move the trombone and drive the RF switch. CORS used to allow `*`, so even
a preflighted JSON POST went through. Dropping CORS alone is not enough either:
a "simple" request (a form POST, or a bodiless one like `/motor/stop`) is sent
without a preflight, and the route runs whether or not the page may read the
answer.

So the check is on the `Origin` header itself. Browsers send it on every
cross-origin request and on same-origin POSTs; it is absent from curl, the
tests, and same-origin GETs, all of which pass. Allowed: the origin the request
is addressed to (the bundled SPA, the desktop window) and the Vite dev server,
whose proxy forwards the page's own `Origin`.

Pure ASGI rather than `BaseHTTPMiddleware`, so it also covers WebSockets and
does not buffer the streaming routes (BLE scan stream, chat).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

#: The Vite dev server (frontend/vite.config.ts `server.port`).
DEV_ORIGINS = frozenset({
    "http://localhost:5173",
    "http://127.0.0.1:5173",
})

#: Hosts that mean "this machine". Same-origin is judged on the port too.
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers") or ():
        if k == name:
            return v.decode("latin-1")
    return None


def origin_allowed(origin: str | None, host: str | None) -> bool:
    """Whether a request carrying `Origin: origin`, sent to `Host: host`, may run."""
    if origin is None:
        return True  # not a browser's cross-origin request
    if origin in DEV_ORIGINS:
        return True
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False  # "null" (sandboxed iframe, file://) and the like
    if host is None:
        return False
    if parts.netloc == host:
        return True  # same origin
    # localhost and 127.0.0.1 name the same server; a page served on one may
    # call the other, as long as the port is the API's own.
    want = urlsplit(f"//{host}")
    return (
        parts.hostname in _LOCAL_HOSTS
        and want.hostname in _LOCAL_HOSTS
        and parts.port == want.port
    )


class OriginGuard:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket") and not origin_allowed(
            _header(scope, b"origin"), _header(scope, b"host")
        ):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = b'{"detail":"cross-origin request refused"}'
            await send({
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
