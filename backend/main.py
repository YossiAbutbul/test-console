import logging
from pathlib import Path

from . import dll_setup  # noqa: F401 — must import before instrument wrappers
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import ble_router, device_router, instruments_router, motor_router, test_router
from .ble import manager as ble_manager

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

from uvicorn.logging import AccessFormatter, DefaultFormatter

_LOG_FMT = "%(asctime)s %(levelprefix)s %(name)s: %(message)s"
_ACCESS_FMT = '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
_DATEFMT = "%H:%M:%S"


def _install(name: str, formatter: logging.Formatter) -> None:
    lg = logging.getLogger(name)
    lg.handlers.clear()
    h = logging.StreamHandler()
    h.setFormatter(formatter)
    lg.addHandler(h)
    lg.propagate = False
    lg.setLevel(logging.INFO)


# Suppress chatty poll endpoints from the access log
class _PollNoiseFilter(logging.Filter):
    QUIET_PATHS = ("/ble/status", "/motor/status", "/test/status")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(f'"GET {p} ' in msg for p in self.QUIET_PATHS)


_install("", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
logging.getLogger().setLevel(logging.INFO)
_install("uvicorn", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
_install("uvicorn.error", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
_install("uvicorn.access", AccessFormatter(_ACCESS_FMT, datefmt=_DATEFMT, use_colors=True))
logging.getLogger("uvicorn.access").addFilter(_PollNoiseFilter())

app = FastAPI(title="Test Console Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ble_router)
app.include_router(device_router)
app.include_router(instruments_router)
app.include_router(motor_router)
app.include_router(test_router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


# Serve the React SPA in production (after `npm run build` in frontend/).
SPA_INDEX = FRONTEND_DIST / "index.html"


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(SPA_INDEX)


if FRONTEND_DIST.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="spa-assets",
    )


_API_PREFIXES = (
    "/ble", "/device", "/instruments", "/motor", "/test", "/health",
    "/assets", "/docs", "/redoc", "/openapi.json",
)


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request) -> FileResponse:
    """SPA fallback: any non-API GET returns index.html so the React router can handle it."""
    p = "/" + full_path
    if any(p == pref or p.startswith(pref + "/") for pref in _API_PREFIXES):
        raise HTTPException(status_code=404)
    return FileResponse(SPA_INDEX)


@app.on_event("shutdown")
async def _shutdown() -> None:
    await ble_manager.disconnect()
