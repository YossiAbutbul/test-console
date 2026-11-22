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
tests, and same-origin GETs, all of which pass.

Allowed: any page served from this machine (localhost, 127.0.0.1, ::1, any
port). That covers the bundled SPA, the desktop window and the Vite dev
server, whose proxy forwards the page's own `Origin` -- on whatever port it
got: pinning 5173 refused every call the day 5173 was taken and Vite moved to
5174. Software already running on this machine is not the threat; a page from
the internet is, and its `Origin` names its own site even when DNS rebinding
points that name at 127.0.0.1.

The `Host` must name this machine too. A rebound page is same-origin with the
API (both `evil.example:8000`), so its GETs carry no `Origin` at all; the
`Host` header is what still gives it away. The API only listens on loopback,
so a legitimate request never arrives under another name.

Pure ASGI rather than `BaseHTTPMiddleware`, so it also covers WebSockets and
does not buffer the streaming routes (BLE scan stream, chat).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

#: Hosts that mean "this machine".
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

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
    # urlsplit drops the [] of [::1], so both compare against the bare name.
    if host is not None and urlsplit(f"//{host}").hostname not in _LOCAL_HOSTS:
        return False  # reached under another name: DNS rebinding
    if origin is None:
        return True  # not a browser's cross-origin request
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False  # "null" (sandboxed iframe, file://) and the like
    return parts.hostname in _LOCAL_HOSTS


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
