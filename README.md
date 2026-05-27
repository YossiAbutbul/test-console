# Test Console

FastAPI backend + React/Vite frontend for BLE-driven PA mode testing with VISA
RF instruments, an Arcus trombone motor, and an Arduino RF switch.

See [`docs/architecture.md`](docs/architecture.md) for the structural overview
and conventions used across the codebase.

## Prerequisites

- Python 3.11+
- Node.js 20+
- Git (the `rf-instruments` and `dmx-j-sa` deps install from GitHub)
- VISA backend for instruments (`pyvisa-py` ships with deps; NI-VISA optional
  if you have a Keysight install)
- Windows 10/11 with Bluetooth for BLE
- Bundled DLLs in `backend/hw/dlls/<device>/` (already in-repo)

## Setup

From the repo root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd frontend
npm install
cd ..
```

## Run — dev

Two terminals.

**Backend** (live reload on `.py` edits):

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload --reload-dir backend --timeout-graceful-shutdown 3 --port 8000
```

Why the flags:

- `--reload --reload-dir backend` watches only Python sources, ignoring
  `frontend/` and `node_modules/`.
- `--timeout-graceful-shutdown 3` keeps Ctrl+C snappy; without it uvicorn
  waits indefinitely for in-flight streaming responses.

API at `http://localhost:8000`. Health: `GET /health`. Docs: `/docs`.

**Frontend** (Vite HMR):

```powershell
cd frontend
npm run dev
```

Dev server at `http://localhost:5173`. Vite proxies `/ble`, `/device`,
`/instruments`, `/motor`, `/servo`, `/test`, `/health` to the backend on
`:8000`.

## Run — production

Build the SPA once, then serve it directly from FastAPI (one terminal, no
proxy):

```powershell
cd frontend
npm run build
cd ..
python -m uvicorn backend.main:app --port 8000
```

The backend serves `frontend/dist` at `/`.

## Layout

```
backend/                FastAPI app, drivers, instrument adapters
  api/                  HTTP routers (one file per resource)
  ble/ motor/ servo/    Per-device drivers
  hw/                   RF-instrument adapters + bundled DLLs
  protocol/             DUT Cat-M2 framing
  main.py test_runner.py device.py excel.py

frontend/               React + Vite + MUI SPA
  src/
    api/                Typed fetch clients
    components/         App-wide widgets (Sidebar, modals, ...)
    context/            React providers (Connection, Instruments, ...)
    hooks/ store/       Reusable hooks + persistence
    tests/<id>/         One folder per test page (Page + module)
    types/

docs/                   Architecture guide + design notes
requirements.txt        Python deps
```

## Tips

- Hard refresh in the browser (Ctrl+F5) clears the per-page localStorage
  snapshots if a stale layout sticks.
- `--reload` on the backend wipes hardware sessions on every save; drop the
  flag for stable long-running connections.
- `/docs` (Swagger UI) is the fastest way to poke an endpoint without going
  through the React app.
