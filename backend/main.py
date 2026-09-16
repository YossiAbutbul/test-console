"""FastAPI application entry point.

Owns three things and delegates everything else to the routers in `api/`:
logging setup, the SPA fallback that serves the built React app, and the
lifespan hook that drops the BLE link on shutdown.
"""

# The DLL search path must be registered before any module that loads a vendor
# DLL is imported, so this import stays first and must not be reordered.
from .hw import dll_setup  # noqa: F401  (import for side effect)

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from uvicorn.logging import AccessFormatter, DefaultFormatter

from . import capabilities, paths
from .api import (
    ble_router, chat_router, device_router, instruments_router,
    load_pull_router, motor_router, servo_router, test_router,
)
from .api.instruments import close_all as instruments_close_all
from .ble import manager as ble_manager
from .motor import manager as motor_manager
from .servo import manager as servo_manager

# Resolved through `paths` rather than from __file__: frozen into the desktop
# bundle there is no repo above this module, and the built SPA sits beside the
# executable instead.
FRONTEND_DIST = paths.frontend_dist()
SPA_INDEX = FRONTEND_DIST / "index.html"

_LOG_FMT = "%(asctime)s %(levelprefix)s %(name)s: %(message)s"
_ACCESS_FMT = '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
_DATEFMT = "%H:%M:%S"

# Paths the SPA fallback must not swallow.
_API_PREFIXES = (
    "/ble", "/chat", "/device", "/instruments", "/motor", "/servo", "/test", "/health",
    "/capabilities", "/assets", "/docs", "/redoc", "/openapi.json",
)


def _install(name: str, formatter: logging.Formatter) -> None:
    """Replace a logger's handlers with one that uses uvicorn's formatting."""
    logger = logging.getLogger(name)
    logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False
    logger.setLevel(logging.INFO)


class _PollNoiseFilter(logging.Filter):
    """Drop access-log lines for the endpoints the UI polls every 500 ms."""

    QUIET_PATHS = (
        "/ble/status", "/motor/status", "/servo/status", "/test/status",
        "/chat/status",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(f'"GET {p} ' in msg for p in self.QUIET_PATHS)


def _setup_logging() -> None:
    default = DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True)
    _install("", default)
    logging.getLogger().setLevel(logging.INFO)
    _install("uvicorn", default)
    _install("uvicorn.error", default)
    _install("uvicorn.access", AccessFormatter(_ACCESS_FMT, datefmt=_DATEFMT, use_colors=True))
    logging.getLogger("uvicorn.access").addFilter(_PollNoiseFilter())


_setup_logging()


async def _release_hardware() -> None:
    """Hand every device back before the process exits.

    Anything still held when the process dies can refuse the next connect: the
    BLE stack keeps a stale link, an instrument keeps its session, a COM port
    stays claimed. That is what makes a backend restart turn into a round of
    unplugging things.

    Each step is independent — one device failing to release must not strand
    the rest — and the whole thing is best effort, because the alternative to a
    failed close is not a working close, it is no close at all.
    """
    # Thunks, not coroutines: built eagerly, a step that is never reached
    # would be an un-awaited coroutine warning at exit, and it should read as
    # "nothing has started yet".
    steps: tuple[tuple[str, Callable[[], Awaitable[Any]]], ...] = (
        # BLE first: it is the slowest and the one the OS will not clean up on
        # its own, so it should not be the step that runs out of shutdown time.
        ("BLE", ble_manager.disconnect),
        ("instruments", instruments_close_all),
        ("servo", lambda: asyncio.to_thread(servo_manager.disconnect)),
        ("motor", lambda: asyncio.to_thread(motor_manager.disconnect)),
    )
    for label, start in steps:
        try:
            await start()
        except Exception as e:
            logging.getLogger(__name__).warning(
                "releasing %s failed: %s: %s", label, type(e).__name__, e
            )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    # Only runs on a *graceful* stop — Ctrl-C, SIGTERM, uvicorn's own reload.
    # A force-kill skips it entirely and leaves the devices in exactly the
    # state this exists to prevent, which is why the docs say to stop the
    # server rather than kill it.
    await _release_hardware()


app = FastAPI(title="Test Console Backend", version="0.1.0", lifespan=lifespan)

# The API is bound to localhost and consumed by the bundled SPA (and by the
# Vite dev server on another port), so origin checks add nothing here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ble_router)
app.include_router(chat_router)
app.include_router(device_router)
app.include_router(instruments_router)
app.include_router(load_pull_router)
app.include_router(motor_router)
app.include_router(servo_router)
app.include_router(test_router)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/capabilities")
async def get_capabilities() -> dict[str, Any]:
    """What this build can drive, asked once by the UI at startup.

    Exists so the DUT-only desktop bundle can grey out the rig pages up front.
    Without it the first sign that a page cannot work is a 501 from the connect
    call, which lands after the operator has already set the test up.
    """
    available, missing = capabilities.instruments()
    return {"instruments": available, "missing": missing}


def _spa_index() -> FileResponse:
    """index.html, marked to be revalidated on every load.

    Without a Cache-Control header the browser picks its own freshness window
    from Last-Modified and serves index.html from cache inside it. After a
    rebuild that cached copy still names the previous bundle's hashed JS, so
    the page kept showing the old UI until a hard refresh. `no-cache` still
    lets the browser keep the file; it only has to ask first, and an unchanged
    build answers 304.
    """
    return FileResponse(SPA_INDEX, headers={"Cache-Control": "no-cache"})


class _HashedAssets(StaticFiles):
    """/assets, cached for good.

    Vite puts a content hash in every filename there, so a changed file is a
    new URL and a cached one can never be stale. That is what makes it safe
    for index.html alone to be revalidated.
    """

    async def get_response(self, path: str, scope: Any) -> Any:
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


@app.get("/")
async def index() -> FileResponse:
    return _spa_index()


@app.get("/favicon.svg")
async def favicon() -> FileResponse:
    """Serve the tab icon.

    Needs a route of its own. Only /assets is mounted, so without this the SPA
    fallback below answers with index.html and the browser gets HTML where it
    asked for an image -- which is why the tab has been blank under the bundled
    build while looking fine under the Vite dev server, which serves public/
    itself. Registered above the catch-all, which is what gives it priority.
    """
    return FileResponse(FRONTEND_DIST / "favicon.svg")


if FRONTEND_DIST.is_dir():
    app.mount("/assets", _HashedAssets(directory=FRONTEND_DIST / "assets"), name="spa-assets")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request) -> FileResponse:
    """Serve index.html for any non-API GET so the client router can route it."""
    path = "/" + full_path
    if any(path == prefix or path.startswith(prefix + "/") for prefix in _API_PREFIXES):
        raise HTTPException(status_code=404)
    return _spa_index()
