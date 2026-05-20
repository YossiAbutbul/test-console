import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import ble_router, device_router, test_router
from .ble import manager as ble_manager

STATIC_DIR = Path(__file__).parent / "static"

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


# Root logger: colored DefaultFormatter (uses %(levelprefix)s = colored "INFO:")
_install("", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
logging.getLogger().setLevel(logging.INFO)

# Uvicorn loggers — same format, colored
_install("uvicorn", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
_install("uvicorn.error", DefaultFormatter(_LOG_FMT, datefmt=_DATEFMT, use_colors=True))
_install("uvicorn.access", AccessFormatter(_ACCESS_FMT, datefmt=_DATEFMT, use_colors=True))

app = FastAPI(title="PA Modes Test Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ble_router)
app.include_router(device_router)
app.include_router(test_router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("shutdown")
async def _shutdown() -> None:
    await ble_manager.disconnect()
