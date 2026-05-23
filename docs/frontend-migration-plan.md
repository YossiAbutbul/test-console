# Test Console — Project Notes

> Living doc. Read this first when starting a new session — it captures the current state and decisions so you don't have to re-discover them.

## What this is

RF Test Console for CATM2-family devices. BLE-connected device runs LoRa CW + parametric sweep tests; bench instruments (Mini-Circuits power meter, Keysight DC power analyzer) measure tx power and current draw. Backend = FastAPI; frontend = React+Vite SPA.

## Repo layout

```
test-console/
├── backend/                     # FastAPI app
│   ├── api/                     # ble.py · device.py · test.py
│   ├── ble/                     # manager.py (Bleak wrapper) · models.py
│   ├── instruments/             # base.py · real.py · mock.py
│   ├── protocol/                # frame.py · transport.py
│   ├── device.py                # Device commands (lora_cw, stop)
│   ├── test_runner.py           # async sweep runner
│   ├── excel.py                 # xlsx export
│   ├── main.py                  # app entry: routers + SPA mount + SPA fallback
│   └── static/index.html        # legacy single-file console (still served as fallback)
├── frontend/                    # React 19 + Vite 7 + TS + MUI v6
│   └── src/
│       ├── api/                 # typed fetch wrappers (client/ble/device/tests)
│       ├── components/          # ConnectionPanel · LogPanel · ProgressRow · StatusBadge
│       ├── context/             # ConnectionContext · LogContext
│       ├── tests/               # test modules — extension point
│       │   ├── registry.ts      # TestModule[] drives Tabs + Sidebar
│       │   ├── types.ts         # TestModule interface
│       │   ├── cwDebug/         # CW Debug page
│       │   └── powerSweep/      # Power Sweep page
│       ├── theme.ts             # MUI light theme (slate primary, hairline borders)
│       ├── types/models.ts      # TS mirrors of Pydantic
│       ├── App.tsx              # shell: AppBar + Sidebar + sticky ConnectionPanel + Tabs + Log drawer
│       └── main.tsx             # QueryClient + ThemeProvider + Providers
├── docs/frontend-migration-plan.md   # this file
├── requirements.txt
└── .gitignore                   # ignores .claude/, node_modules/, dist/, *.xlsx, etc.
```

## Running it

Two terminals:

```
# 1) backend — make sure venv has bleak + deps from requirements.txt
uvicorn backend.main:app --reload --reload-dir backend

# 2) frontend — Vite dev with proxy to :8000
cd frontend
npm run dev
```

Open `http://localhost:5173`. Vite proxy (`vite.config.ts`) forwards `^/ble(/|$)`, `^/device(/|$)`, `^/test(/|$)`, `^/health$` → `localhost:8000`. The regex prefixes matter — earlier a plain `/test` proxy collided with the React route `/tests/...`. Don't loosen them.

Production: `cd frontend && npm run build` → `frontend/dist/`. FastAPI auto-serves `dist/` when present; SPA fallback returns `index.html` for any non-API GET.

## Backend API surface

| Method | Path                       | Purpose |
|--------|----------------------------|---------|
| GET    | `/ble/scan?duration=N`     | Blocking scan, returns full list |
| GET    | `/ble/scan/stream?...`     | **SSE** — streams `event: device` per ad, `event: done` at end |
| POST   | `/ble/connect`             | `{address, timeout}` → ConnectionStatus |
| POST   | `/ble/disconnect`          | — |
| GET    | `/ble/status`              | ConnectionStatus |
| POST   | `/device/lora-cw`          | `{freq_hz, power_dbm, pa_duty_cycle, hp_max}` |
| POST   | `/device/stop`             | Stop active test |
| POST   | `/test/run`                | Start parametric sweep |
| POST   | `/test/cancel`             | Cancel running sweep |
| GET    | `/test/status`             | RunStatus (state, completed/total, last_row) |
| GET    | `/test/results`            | All collected rows |
| GET    | `/test/export`             | xlsx blob |

Validation ranges (`backend/test_runner.py`): HP 0–7, PA duty 0–4, power 1–22 dBm. Frontend UI clamps to 1–7 / 1–4 / 1–22 (deliberate — start from 1).

## Frontend architecture decisions

- **State**: TanStack Query for server state, React Context for connection + log. No Redux/Zustand.
- **Polling**: removed all background intervals.
  - `/ble/status`: refetched only on mount + after connect/disconnect mutations.
  - `/test/status`: 500 ms while `state === 'running'`, otherwise off. Run mutation triggers immediate refetch.
- **Live scan**: `EventSource` against `/ble/scan/stream` in `api/ble.ts → scanStream()`. ConnectionPanel opens the MAC Address dropdown on Scan click and updates devices live; entries are deduped by address and sorted by RSSI.
- **TestModule extension**: add new test = create `src/tests/<name>/{Page.tsx, module.ts}`, export a `TestModule`, import into `registry.ts`. Registry drives the in-page `<Tabs>`. Sidebar currently shows a single "CW Debug" entry that scrolls to top (placeholder — extend later if more tests need sidebar nav).
- **Gating**: when no device connected, test pages still render (visible) but are wrapped in a `<fieldset disabled>` (HTML-native disable of all inputs/buttons) at 0.6 opacity.

## UI state (current)

- Light theme, slate primary `#0f172a`, hairline borders, soft popover shadows (Autocomplete/Menu/Popover).
- Layout: fixed AppBar ("Test Console" 22px) + persistent left Sidebar (brand + device status footer) + main column + persistent right Drawer (Log, default open, newest entries on top).
- ConnectionPanel: sticky under AppBar, present on every page.
  - Duration number input, Device-type Select (CAT-M 2 / Sonata 2 IL / Interpreter G2 / All), MAC Address Autocomplete (freeSolo, opens on Scan).
  - **Connect button enables only when `selectedAddr ∈ devices[]`** — must pick from scan, not free-type.
  - Single Connect/Disconnect toggle button (green/red).
  - All inputs disabled while connected.
- CW Debug: Frequency in **MHz** (converted to Hz on send). Single Send/Stop toggle button (green → red).
- Power Sweep:
  - Frequency MHz · Settle ms · live "Total steps" readout.
  - "Sweep ranges" / "Instruments" plain left-aligned subtitle headers (no `<Divider>` line).
  - Each sweep param has `From → To` number pair (Power 1–22, Duty 1–4, HP 1–7).
  - Cancel button shows spinner + "Cancelling…" and progress bar switches to amber indeterminate slide until backend confirms `cancelled`.
- ProgressRow: always rendered (`—` placeholders when no data). Custom `<Box>` bar (no MUI `LinearProgress` classes) with slate→blue gradient, slate-300 bg. Stat grid: Step / HP·Duty / P set / P meas / Current / Result.

## Gotchas / things already burned in

- **MUI version**: pinned `@mui/material@^6`. v9 had React 19 typing breakage (Stack/Typography required `component` prop). Don't upgrade without re-verifying.
- **Vite proxy regex**: must use `^/test(/|$)` not `/test` — otherwise the proxy swallows the SPA route `/tests/<id>` and returns a stale `dist/index.html`, which then 404s on its hashed asset.
- **Node engine warning**: project tested on Node 23 (Vite officially wants 20.19 / 22.13 / ≥24). Warnings are noisy but non-fatal.
- **CRLF**: Windows checkout, Git auto-converts on staging. Ignore the `LF will be replaced by CRLF` warnings.
- **`bleak` import error on uvicorn start** = wrong Python env (likely Anaconda base). Activate the venv with `pip install -r requirements.txt`.
- **`.claude/`** is gitignored — local Claude settings should not be committed.

## Recent commits (most recent first)

- `5a0e00a` — Stop background polling of BLE/test status
- `cb854cd` — Add .claude to .gitignore
- `482b455` — Add React+Vite frontend; add SSE live scan endpoint
- `da7c85f` — Add backend scaffold: FastAPI app, BLE manager, instruments, protocol

## Open / not yet done

- Legacy `backend/static/index.html` still in repo — delete after full parity verified against real hardware.
- No tests (unit / e2e) yet.
- Power Sweep `parseList.ts` no longer used (replaced by From/To inputs). Could delete.
- Sidebar has a single "CW Debug" entry that's basically a placeholder navigation. Re-add multiple sidebar entries if/when more test types arrive.
- `StatusBadge` component still exists but isn't mounted anywhere — remove or repurpose.
