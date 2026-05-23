# Test Console

FastAPI backend + React/Vite frontend for BLE-driven PA mode testing with VISA RF instruments.

## Prerequisites

- Python 3.11+
- Node.js 20+ (for the frontend)
- Git (the `rf-instruments` dep installs from GitHub)
- VISA backend for instruments (pyvisa-py ships; NI-VISA optional)
- Windows 10/11 with Bluetooth for BLE

## Backend

From repo root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --reload --port 8000
```

API at `http://localhost:8000`. Health check: `GET /health`. Docs: `/docs`.

## Frontend (dev)

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Dev server at `http://localhost:5173`. Vite proxies `/ble`, `/device`, `/test`, `/health` to backend on `:8000`.

## Production build

Build SPA, then serve it from FastAPI:

```powershell
cd frontend
npm run build
cd ..
python -m uvicorn backend.main:app --port 8000
```

Backend serves `frontend/dist` at `/`. Falls back to `backend/static/index.html` if no build present.

## Layout

- `backend/` — FastAPI app, BLE manager, instrument wrappers, test runner
- `frontend/` — React + Vite + MUI SPA
- `docs/` — design notes
- `requirements.txt` — Python deps
