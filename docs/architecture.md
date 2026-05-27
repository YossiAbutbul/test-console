# Test Console — Architecture Guide

> **Read this first when starting a new session.** It documents how the app
> is structured and the conventions decisions were made under, so you don't
> have to re-discover them from the diff. Keep this file current when you
> restructure the repo.

---

## What the app does

A single-operator desk tool that drives:

- A **DUT** (Device Under Test) over **BLE** using a Cat-M2 framed
  protocol — sends commands like "TX Power", "Modulated", "CW Debug",
  "Mode Sweep", and reads back status bytes.
- **RF instruments** over VISA — Mini-Circuits power sensor, Keysight
  N6705 DC power analyzer, Keysight E5061B network analyzer.
- A **Trombone motor** (Arcus DMX-J-SA, USB) for load-pull positioning.
- An **Arduino-controlled RF switch** servo over serial.

Each test page composes some subset of: send DUT command → wait → measure
on the connected instruments → record/export.

---

## Repo layout

```
backend/
  main.py                FastAPI app, logging filters, SPA fallback
  test_runner.py         Mode-sweep orchestration (used by /test/*)
  device.py              High-level DUT helpers (PaMode, LoraPower, ...)
  excel.py               openpyxl workbook builder for sweep export

  api/                   HTTP routers, one file per resource
    ble.py                /ble/*      — scan, connect, status, scan-stream
    device.py             /device/*   — single-shot DUT commands
    instruments/          /instruments/*
      __init__.py           aggregator + /status, /measure
      power_sensor.py       Mini-Circuits routes
      dc_analyzer.py        Keysight DC routes + /supply control
      spectrum.py           generic VISA SA (placeholder model)
      network_analyzer.py   E5061B routes incl. host-side markers
      _state.py             process-wide holder of open sessions
      _common.py            shared schemas + list_visa_resources_idn
    motor.py              /motor/*    — Arcus trombone
    servo.py              /servo/*    — Arduino RF switch
    test.py               /test/*     — mode-sweep run/cancel/export

  ble/
    manager.py            bleak wrapper, GAP-name heartbeat, scan/connect
    models.py             pydantic shapes

  protocol/               DUT Cat-M2 framing — opcode, length, payload
    frame.py              encode/decode helpers
    transport.py          BLE characteristic write+notify glue

  motor/manager.py        Arcus DLL wrapper + soft limits
  servo/manager.py        pyserial Arduino driver

  hw/                     Hardware adapter layer (RF instruments)
    base.py                 abstract PowerMeter / CurrentMeter ABCs
    adapters.py             MiniCircuitsPowerMeter, KeysightDCPowerAnalyzer
    dll_setup.py            add_dll_directory bootstrap for bundled DLLs
    dlls/<device>/*.dll     vendor DLLs the wrappers expect

frontend/
  src/
    main.tsx              QueryClient + provider chain + root render
    App.tsx               Top bar + sidebar + log drawer + TestArea
    theme.ts              MUI palette per theme mode

    api/                  Typed fetch clients, one file per backend resource
      client.ts             http<T> helper (status-aware error)
      ble.ts device.ts tests.ts instruments.ts
      motor.ts servo.ts networkAnalyzer.ts

    components/           App-level reusable widgets
      ConnectionPanel.tsx  Top BLE/device-type/path-loss inputs
      InstrumentsModal.tsx Connect every instrument from one screen
      LabeledField.tsx     Standard label-above-input field with history
      LogPanel.tsx         Right-side log drawer
      MeasurementCard.tsx  Power + current display, polls /instruments/measure
      Sidebar.tsx          Protocol tree + Instruments shortcut + Settings
      PageHeader.tsx       Section breadcrumb + action slot per page
      SearchBar.tsx StatusBadge.tsx TopProgress.tsx ProgressRow.tsx
      NicknameModal.tsx

    context/              React providers — each owns one slice of state
      ConnectionContext   useConnection — BLE status (React Query 10 s poll)
      InstrumentsContext  Split: useInstrumentsActions (stable) +
                          useInstrumentsState (changes on poll) +
                          useInstrumentsModal + useInstrumentValue(id)
      LogContext          append-only log w/ sessionStorage + source filter
      NotifyContext       toast notifications (success/info/warning/error)
      NicknamesContext    MAC → friendly name map
      PathLossContext     global path-loss dB applied to measurements
      ThemeModeContext    dark / mid / light / system

    hooks/
      useFieldHistory.ts  Last-N values per key (localStorage)

    store/                Persistence / page-level snapshots
      keys.ts               STORAGE_KEYS enum (only place to add new keys)
      persistent.ts         typed localStorage helper + usePersistedState
      powerPageStore.ts     TX-Power page snapshot (tab + automation rows)
                            ⇒ add a sibling per page that needs persistence
      index.ts              re-exports

    tests/                One folder per test page
      registry.ts           list registered in Sidebar
      types.ts              TestModule shape
      power/                Power: Manual + Automation tabs (CSV export)
      modulated/ cwDebug/ powerSweep/      LoRa pages
      loadPull/             Trombone motor control
      switch/               Arduino RF switch
      networkAnalyzer/      E5061B S11 + markers

    types/models.ts       Shared TypeScript shapes for backend payloads

docs/                     This guide (and any future notes)
requirements.txt          Python deps. rf-instruments + dmx-j-sa come from
                          GitHub.
README.md
```

---

## Conventions

### Backend

- **One HTTP file per resource** in `backend/api/`. Resource files do
  pydantic schemas + thin route handlers; all real work happens in a
  sibling driver module (`backend/ble/`, `backend/motor/`,
  `backend/servo/`, `backend/hw/`).
- **Process-wide sessions** for hardware live in module-level state objects
  (`_state.py` for instruments, `state` in motor/servo). Connect mutates,
  status reads from it. Heartbeats / background tasks **must not**
  force-disconnect — the user's connection survives until they explicitly
  disconnect or the backend process restarts.
- **DLL bootstrap** (`hw/dll_setup.py`) must be the very first import in
  `main.py` so the Windows loader can find `mcl_pm_NET45.dll`,
  `PerformaxCom.dll`, etc. before any instrument wrapper module loads.
- **VISA discovery probes** open each resource with a short timeout and
  read `*IDN?`. They **skip** resources already held by our own session
  (tracked via `*_resource` fields on `_state`) — re-opening corrupts the
  live handle with `VI_ERROR_INV_JOB_ID`.
- **Routes named after subsystems**: `/ble`, `/device`, `/instruments`,
  `/motor`, `/servo`, `/test`. Add a new file in `backend/api/` and a
  router include in `backend/main.py`.

### Frontend

- **Pages eagerly mounted** in `App.tsx` and toggled with `display:none`,
  so sidebar navigation is a CSS swap. Pages may use `useQuery` with
  `enabled: connected` so background polling is quiet.
- **One file per test page** under `src/tests/<id>/`. Each exports a
  `module.ts` describing the test (id, label, protocol, group, Page
  component) and gets registered in `src/tests/registry.ts`.
- **Persisted page state goes in a `*PageStore.ts`** under `src/store/`.
  Use `storage.get/set` from `persistent.ts` and add the key to
  `STORAGE_KEYS` in `keys.ts`. Debounce writes (300 ms) and flush on
  `beforeunload` for high-frequency mutations.
- **Granular context hooks**: `InstrumentsContext` is split so a
  component that only needs callbacks doesn't re-render when the
  instruments map updates. Same pattern when adding new contexts that
  poll.
- **Toasts**: `useNotify().success/info/warning/error(msg, {title?,
  autoHideMs?})`. Info/success auto-clear with a countdown bar;
  warning/error are sticky.
- **Path-loss is global**: `usePathLoss().pathLossDb` is added to every
  measured dBm in the UI. Backend never sees it.

### Communication shape

- DUT BLE: `[opcode:2][len:2 LE][payload]`. Status byte is `payload[0]`.
- Servo: ASCII, 9600 8N1, newline-terminated. `*IDN?` returns SCPI-style
  comma string.
- VISA instruments: SCPI as usual. `*IDN?` used for discovery labels.
- VNA markers: stored host-side and interpolated from the swept S11
  array; the on-screen markers are written via raw SCPI as a courtesy.

### React Query defaults

- `staleTime: 30 s`, `gcTime: 5 min`, `retry: 1`,
  `refetchOnWindowFocus: false`. Set in `main.tsx`. Pages override
  `refetchInterval` per query when they want polling.

---

## Running

See `README.md` for the dev + production commands.

## Adding a new test page (quick recipe)

1. Make `frontend/src/tests/<slug>/<Slug>Page.tsx` and a sibling
   `module.ts`.
2. Register in `frontend/src/tests/registry.ts`.
3. If it needs hardware not yet wired:
   - Add a backend driver under `backend/<slug>/` (or extend `hw/`).
   - Add a router under `backend/api/<slug>.py` and include it in
     `backend/api/__init__.py` + `backend/main.py`.
   - Add a vite proxy entry in `frontend/vite.config.ts`.
   - Add a typed client under `frontend/src/api/`.
4. If the page should persist state across nav, add `<slug>PageStore.ts`
   under `frontend/src/store/` following `powerPageStore.ts`.
5. If it logs, add the source to `LogSource` in
   `frontend/src/context/LogContext.tsx`.
