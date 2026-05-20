# Plan: Migrate PA Modes Test Console to React + Vite

> Living implementation guide. Keep open while building. Update as steps complete.

## Context

Current console lives in [backend/static/index.html](../backend/static/index.html) — single vanilla-JS file (~600 lines) with 4 sections: Scan/Connect, LoRa CW Debug, Sweep Test, Log. Served by FastAPI static mount.

Goals:
1. Rewrite as React + Vite + TypeScript + MUI app — better UX, componentized, easier to evolve.
2. Lay out repo root so future test types (unspecified for now — user will define later) can be added as self-contained modules without restructuring.
3. Keep FastAPI backend untouched; talk to it via existing REST endpoints (`/ble/*`, `/device/*`, `/test/*`).

Outcome: `frontend/` sibling to `backend/`. Dev = Vite on :5173 proxying API to FastAPI on :8000. Production = `npm run build` → FastAPI serves `dist/`.

## Repo Layout After Change

```
PA Modes - Power and CC/
├── backend/                          # unchanged
│   ├── api/ ble/ instruments/ protocol/
│   ├── main.py                       # add prod-build static mount (see step 6)
│   └── static/index.html             # DELETE after parity reached
├── frontend/
│   ├── package.json
│   ├── vite.config.ts                # proxy /ble /device /test → :8000
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                   # MUI theme, layout shell, tab router
│       ├── api/
│       │   ├── client.ts             # fetch wrapper, base URL, error handling
│       │   ├── ble.ts                # scan/connect/disconnect/status
│       │   ├── device.ts             # lora-cw/stop
│       │   └── tests.ts              # run/status/cancel/export (generic)
│       ├── types/
│       │   └── models.ts             # TS mirrors of Pydantic models
│       ├── hooks/
│       │   ├── useBleStatus.ts       # TanStack Query, polls /ble/status
│       │   └── useTestRun.ts         # TanStack Query, polls /test/status while running
│       ├── context/
│       │   └── ConnectionContext.tsx # selected device, connection state shared across tests
│       ├── components/               # shared UI
│       │   ├── ConnectionPanel.tsx   # scan + table + connect — top of every test page
│       │   ├── LogPanel.tsx          # global rolling log
│       │   ├── StatusBadge.tsx
│       │   └── ProgressRow.tsx       # progress bar + last_row display
│       ├── tests/                    # one folder per test module — extension point
│       │   ├── registry.ts           # TestModule[] — drives tab nav
│       │   ├── types.ts              # TestModule interface (see below)
│       │   ├── cwDebug/
│       │   │   ├── CwDebugPage.tsx
│       │   │   ├── module.ts
│       │   │   └── types.ts
│       │   └── powerSweep/
│       │       ├── PowerSweepPage.tsx
│       │       ├── module.ts
│       │       └── types.ts
│       └── theme.ts                  # MUI theme (dark/light)
├── docs/
│   └── frontend-migration-plan.md    # this file
├── package-lock.json
└── requirements.txt
```

## TestModule Extension Pattern

`frontend/src/tests/types.ts`:

```ts
export interface TestModule {
  id: string;                  // route key, e.g. "power-sweep"
  label: string;               // tab label
  icon?: React.ReactNode;      // MUI icon
  Page: React.ComponentType;   // the test UI
  requiresConnection: boolean; // gates rendering on BLE connected
}
```

Adding a new test = create `src/tests/<name>/`, export a `TestModule`, import into `registry.ts`. No core changes.

`App.tsx` reads registry → builds MUI `<Tabs>` + routes via `react-router-dom` (deep-linkable URLs like `/tests/power-sweep`).

## Step-by-Step Implementation

- [ ] **1. Scaffold Vite app** in `frontend/`:
  ```
  npm create vite@latest frontend -- --template react-ts
  ```
  Install: `@mui/material @emotion/react @emotion/styled @mui/icons-material @tanstack/react-query react-router-dom`.

- [ ] **2. Vite proxy** (`frontend/vite.config.ts`) — proxy `/ble`, `/device`, `/test` → `http://localhost:8000`.

- [ ] **3. API layer** (`src/api/`) — typed fetch wrappers. Mirror Pydantic models in `src/types/models.ts` (ScannedDevice, ConnectionStatus, LoraCwRequest, StartRequest, SweepConfig, RunStatus, ResultRow, CommandResponse).

- [ ] **4. TanStack Query providers** in `main.tsx`; `ConnectionContext` in `App.tsx`.

- [ ] **5. Port two existing sections as test modules:**
  - `cwDebug/` ← current "LoRa CW Debug" section → POST `/device/lora-cw`, `/device/stop`.
  - `powerSweep/` ← current "Sweep Test" → POST `/test/run`, poll `/test/status` every 500 ms via TanStack Query `refetchInterval`, download `/test/export` blob.
  - Shared: `ConnectionPanel` (scan/connect) mounted in app shell; `LogPanel` collapsible drawer.

- [ ] **6. Production static mount** — in [backend/main.py](../backend/main.py), update static mount to serve `frontend/dist/` when present. SPA fallback: serve `index.html` on unknown GETs that aren't API routes.

- [ ] **7. Delete [backend/static/index.html](../backend/static/index.html)** after parity verified.

- [ ] **8. README / scripts:**
  - Root `requirements.txt` already exists. Add `frontend/package.json` scripts: `dev`, `build`, `preview`.
  - Document run: terminal 1 = `uvicorn backend.main:app --reload`, terminal 2 = `cd frontend && npm run dev`.

## Critical Files

- **CREATE**: everything under `frontend/`
- **MODIFY**: [backend/main.py](../backend/main.py) — static mount → `frontend/dist` with SPA fallback
- **DELETE** (after parity): [backend/static/index.html](../backend/static/index.html)
- **DO NOT TOUCH**: `backend/api/*`, `backend/ble/*`, `backend/instruments/*`, `backend/protocol/*`, `backend/test_runner.py`, `backend/device.py`, `backend/excel.py`

## Reuse / Existing Patterns

- API endpoints already complete — no backend changes needed for parity. Refs: [api/ble.py](../backend/api/ble.py), [api/device.py](../backend/api/device.py), [api/test.py](../backend/api/test.py).
- Polling pattern (`/test/status` every 500 ms) — port to TanStack Query `refetchInterval`.
- Range-syntax parser (`"1-7,9"` → `[1..7,9]`) from current [index.html](../backend/static/index.html) `parseList()` — port verbatim into `src/tests/powerSweep/parseList.ts`.

## API Surface (reference)

### BLE — `/ble`
| Method | Path | Body | Response |
|--------|------|------|----------|
| GET/POST | `/scan?duration=5` | `{duration}` | `ScannedDevice[]` |
| POST | `/connect` | `{address, timeout}` | `ConnectionStatus` |
| POST | `/disconnect` | — | `ConnectionStatus` |
| GET | `/status` | — | `ConnectionStatus` |
| GET | `/services` | — | `GattService[]` |

### Device — `/device`
| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/lora-cw` | `LoraCwRequest` | `CommandResponse` |
| POST | `/stop` | `StopRequest` | `CommandResponse` |

### Test — `/test`
| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/run` | `StartRequest` | `RunStatus` |
| POST | `/cancel` | — | `RunStatus` |
| GET | `/status` | — | `RunStatus` |
| GET | `/results` | — | `ResultRow[]` |
| GET | `/export` | — | xlsx blob |

## Verification

1. `uvicorn backend.main:app --reload` (:8000), `cd frontend && npm run dev` (:5173).
2. Open `http://localhost:5173`. Scan BLE → table populates. Connect → status badge green.
3. CW Debug tab → "Send CW" with default values → `tx_hex` / `rx_hex` shown, `ok=true`.
4. Power Sweep tab → run small sweep (e.g. power=1, duty=0, hp=0-1) → progress bar advances, `last_row` updates live, state transitions `running → done`.
5. "Export Excel" → downloads `.xlsx`; open and verify "All" sheet + per-power sheets.
6. Cancel mid-sweep → state `cancelled`, polling stops.
7. `cd frontend && npm run build` → `dist/` produced. Restart uvicorn → `http://localhost:8000/` serves built SPA, all flows work.
8. Add a dummy `TestModule` to `registry.ts` → new tab appears without other code changes (validates extension point).

## Out of Scope

- Real new test types — user will define later.
- Auth, multi-user, persistence beyond Excel export.
- Backend refactor.
