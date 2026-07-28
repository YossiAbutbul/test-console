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
  N6705 DC power analyzer, Keysight E5061B network analyzer, and a generic
  spectrum analyzer (session only — no measurement routes yet).
- A **Trombone motor** (Arcus DMX-J-SA, USB) for load-pull positioning.
- An **Arduino-controlled RF switch** servo over serial.

Each test page composes some subset of: send DUT command → wait → measure
on the connected instruments → record/export.

---

## Repo layout

```
backend/
  main.py                FastAPI app, logging filters, SPA fallback, lifespan
  device.py              DUT command surface (PaMode, LoraPower, LoraCw, ...)
  errors.py              DriverUnavailable — shared by drivers and the API

  sweep/                 Mode-sweep domain (served by /test/*)
    models.py              SweepConfig / ResultRow / RunStatus / RunState
    runner.py              the engine + the `runner` singleton
    export.py              openpyxl workbook builder

  api/                   HTTP routers, one file per resource
    errors.py             handle_driver_errors — exception → status mapping
    ble.py                /ble/*      — scan, connect, status, scan-stream
    device.py             /device/*   — single-shot DUT commands
    instruments/          /instruments/*
      __init__.py           aggregator + /status, /measure
      power_sensor.py       Mini-Circuits routes + driver
      dc_analyzer.py        Keysight DC routes + /supply control
      spectrum.py           generic VISA SA (connect/disconnect only)
      network_analyzer.py   E5061B routes incl. host-side markers
      _state.py             process-wide holder of open sessions
      _common.py            shared schemas + list_visa_resources_idn
    motor.py              /motor/*    — Arcus trombone
    servo.py              /servo/*    — Arduino RF switch
    test.py               /test/*     — sweep run/cancel/status/export

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

  tests/                  pytest suite (frame, command encoding, sweep)

frontend/
  src/
    main.tsx              QueryClient + provider chain + root render
    App.tsx               Top bar + sidebar + log drawer + TestArea
    theme.ts              MUI palette + component overrides per theme mode

    api/                  Typed fetch clients, one file per backend resource
      client.ts             http<T> helper (status-aware error)
      ble.ts device.ts tests.ts instruments.ts
      motor.ts servo.ts networkAnalyzer.ts

    lib/                  Framework-free helpers
      format.ts             fmt / fmtHz / fmtMhz / num — all value formatting
      download.ts           CSV serialisation + browser download
      numericList.ts        range() and parseRangeSpec() for sweep inputs
      async.ts              sleep

    ui/                   Shared UI kit — pages compose from these
      tokens.ts             sizes, type scale, layout constants
      Section.tsx           Section (titled block) + Card
      PageBody.tsx          standard content container below PageHeader
      Readout.tsx           Eyebrow / Readout / StatusChip / StatusDot / MonoText
      controls.tsx          ConnectButton / RunControls / SendStopControls /
                            PathLossChip / FrameDump
      index.ts              the import surface — `from '../../ui'`

    components/           App-level widgets (not generic enough for ui/)
      ConnectionPanel.tsx  Top BLE/device-type/path-loss inputs
      InstrumentsModal.tsx Connect every instrument from one screen
      LabeledField.tsx     Standard label-above-input field with history
      LogPanel.tsx         Right-side log drawer
      MeasurementCard.tsx  Power + current display, polls /instruments/measure
      Sidebar.tsx          Protocol tree + Instruments shortcut + Settings
      PageHeader.tsx       Section breadcrumb + action slot per page
      ValidationAdornment.tsx  Inline field-validation tooltip
      SearchBar.tsx StatusBadge.tsx TopProgress.tsx ProgressRow.tsx
      NicknameModal.tsx

    context/              React providers — each owns one slice of state
      ConnectionContext   useConnection — BLE status (React Query 10 s poll)
      InstrumentsContext  Split: useInstrumentsActions (stable) +
                          useInstrumentsState (changes on poll) +
                          useInstrumentsModal + useInstrumentValue(id)
      LogContext          append-only log w/ sessionStorage + source filter
      NotifyContext       toasts + the centred completion modal
      NicknamesContext    MAC → friendly name map
      PathLossContext     global path-loss dB applied to measurements
      ThemeModeContext    dark / mid / light / system

    hooks/
      useFieldHistory.ts  Last-N values per key (localStorage)

    store/                Persistence / page-level snapshots
      keys.ts               STORAGE_KEYS enum (only place to add new keys)
      persistent.ts         typed localStorage helper + usePersistedState
      makePageStore.ts      factory — use this for a new page snapshot
      powerPageStore.ts     TX-Power page snapshot (tab + automation rows)
      loadPullPageStore.ts  Load Pull page snapshot
      index.ts              re-exports

    tests/                One folder per test page
      registry.ts           list registered in Sidebar
      types.ts              TestModule shape
      engine/               shared run machinery
        runSequence.ts        driver for browser-side sweeps
        useRunReporter.ts     useRunReporter / useActionReporter
        useBackendRun.ts      lifecycle reporting for backend-side sweeps
      power/                Power: Manual + Automation tabs (CSV export)
      modulated/ cwDebug/   one-shot DUT command pages
      powerSweep/           Mode Sweep — backend-driven, xlsx export
      loadPull/             Load Pull test (trombone sweep + Smith chart)
      trombone/             Arcus motor manual control
      switch/               Arduino RF switch
      networkAnalyzer/      E5061B S11 + markers

    types/models.ts       Shared TypeScript shapes for backend payloads

docs/                     This guide (and any future notes)
pyproject.toml            pytest config (testpaths = backend/tests)
requirements.txt          Python deps. rf-instruments + dmx-j-sa come from
                          GitHub.
README.md
```

---

## Conventions

### Backend

- **One HTTP file per resource** in `backend/api/`. Route handlers stay thin:
  pydantic schemas plus a call into a driver. For BLE, motor, servo and the
  sweep, the driver is a sibling package (`backend/ble/`, `backend/motor/`,
  `backend/servo/`, `backend/sweep/`, `backend/hw/`).
  **Known exception:** the instrument drivers still live inside
  `backend/api/instruments/*` rather than a separate driver package. Extracting
  them is the main outstanding structural cleanup.
- **Errors**: drivers raise plain exceptions — `ValueError` for a bad request,
  `RuntimeError` for wrong hardware state, `DriverUnavailable`
  (`backend/errors.py`) when the vendor library is missing. Routes wrap driver
  calls in `handle_driver_errors("<operation>")` from `api/errors.py`, which
  owns the exception → status mapping (400 / 409 / 501 / 504 / 500). Do not
  raise `HTTPException` below the route layer.
- **Blocking calls go through `asyncio.to_thread`.** VISA, pyserial and DLL
  calls block; running them inline stalls every other request, including the
  status polls the UI depends on.
- **Process-wide sessions** for hardware live in module-level state objects
  (`_state.py` for instruments, `state` in motor/servo). Connect mutates,
  status reads from it. Heartbeats / background tasks **must not**
  force-disconnect — the user's connection survives until they explicitly
  disconnect or the backend process restarts.
  **The sweep is the deliberate exception**: `/test/run` opens its *own*
  power-sensor and DC-analyzer sessions (`api/test.py`) and the runner closes
  them when the sweep ends, so a run is reproducible regardless of what is
  connected by hand.
- **DLL bootstrap** (`hw/dll_setup.py`) is imported at the top of `main.py`,
  before anything that loads a vendor DLL, so the Windows loader can find
  `mcl_pm_NET45.dll`, `PerformaxCom.dll`, etc. Do not reorder that import.
- **VISA discovery probes** open each resource with a short timeout and
  read `*IDN?`. They **skip** resources already held by our own session
  (tracked via `*_resource` fields on `_state`) — re-opening corrupts the
  live handle with `VI_ERROR_INV_JOB_ID`.
- **Routes named after subsystems**: `/ble`, `/device`, `/instruments`,
  `/motor`, `/servo`, `/test`. Adding one means a new file in `backend/api/`,
  a re-export in `backend/api/__init__.py`, and an include in `backend/main.py`.

### Frontend

- **Pages eagerly mounted** in `App.tsx` and toggled with `display:none`,
  so sidebar navigation is a CSS swap. Pages may use `useQuery` with
  `enabled: connected` so background polling is quiet.
- **One file per test page** under `src/tests/<id>/`. Each exports a
  `module.ts` describing the test (id, label, protocol, group, Page
  component) and gets registered in `src/tests/registry.ts`.
- **Compose pages from `src/ui/`, not from raw `sx`.** `Section`, `PageBody`,
  `Readout`, `StatusChip`, `ConnectButton`, `RunControls` exist so that
  headings, spacing and control sizes stay identical across pages. Reach for a
  literal only for something genuinely page-specific — and if you write the
  same literal twice, it belongs in `ui/tokens.ts`.
- **Formatting lives in `src/lib/format.ts`.** Do not add a local `fmt`; the
  precision drift between pages is exactly what that module fixed. Use
  `fmtMhz` in table columns and `fmtHz` in prose.
- **Persisted page state goes in a `*PageStore.ts`** under `src/store/`, built
  with `makePageStore.ts`. Add the key to `STORAGE_KEYS` in `keys.ts`.
  Debounce writes (300 ms) and flush on `beforeunload`.
- **Granular context hooks**: `InstrumentsContext` is split so a
  component that only needs callbacks doesn't re-render when the
  instruments map updates. Same pattern when adding new contexts that
  poll.
- **Notifications**: `useNotify().success/info/warning/error(msg, {title?,
  autoHideMs?})` for toasts — info/success auto-clear with a countdown bar,
  warning/error are sticky. `useNotify().complete({severity, title, message})`
  raises the centred modal, reserved for end-of-run outcomes.
- **Path-loss is global**: `usePathLoss().pathLossDb` is added to every
  measured dBm. Browser-side sweeps add it themselves; the Mode Sweep passes
  it to the backend as `SweepConfig.path_loss_db` because the loop runs there.

### Run lifecycle

Every test reports itself the same way, so the two kinds of test are
indistinguishable to the user:

| | loop runs in | announces via |
|---|---|---|
| Load Pull, TX Power automation | browser | `runSequence`, which calls the reporter |
| Mode Sweep | backend | `useBackendRun`, watching the polled state |
| Trombone / Switch moves, VNA sweep | instrument | `useActionReporter` on the mutation |

`useRunReporter(name, source, unit)` produces the vocabulary: a log line plus a
"started" toast on start, and a log line plus a completion **modal** on finish
(success), stop (warning) or failure (error). The TX-group pages (Power,
Modulated, Debug) are one-shot commands and deliberately stay log-only.

### Communication shape

- DUT BLE: `[opcode:2][len:2 LE][payload]`. Status byte is `payload[0]`.
  Encoding is pinned by `backend/tests/test_device_encoding.py`.
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

## Testing

- **Backend**: `python -m pytest` from the repo root. `pyproject.toml` pins
  `testpaths = backend/tests` so pytest never tries to collect a production
  module whose name happens to start with `test`. Coverage is the pure-logic
  core: frame pack/parse, DUT command encoding, sweep validation and export.
  Hardware drivers are not covered — they need the instruments.
- **Frontend**: `npm test` (vitest) in `frontend/`. Covers `lib/numericList`
  and the Load Pull plan/Smith-chart maths.
- **Types**: `npx tsc -b --noEmit` in `frontend/`.

---

## Running

See `README.md` for the dev + production commands.

## Adding a new test page (quick recipe)

1. Make `frontend/src/tests/<slug>/<Slug>Page.tsx` and a sibling
   `module.ts`. Build the page out of `src/ui/` primitives.
2. Register in `frontend/src/tests/registry.ts`.
3. If it runs a sweep, drive it with `runSequence` (browser-side) or
   `useBackendRun` (backend-side) and give it a `useRunReporter`, so it
   announces start and completion like every other test.
4. If it needs hardware not yet wired:
   - Add a backend driver under `backend/<slug>/` (or extend `hw/`).
   - Add a router under `backend/api/<slug>.py`, wrap driver calls in
     `handle_driver_errors`, and include it in `backend/api/__init__.py` +
     `backend/main.py`.
   - Add a vite proxy entry in `frontend/vite.config.ts`.
   - Add a typed client under `frontend/src/api/`.
5. If the page should persist state across nav, add `<slug>PageStore.ts`
   under `frontend/src/store/` using `makePageStore.ts`.
6. If it logs, add the source to `LogSource` in
   `frontend/src/context/LogContext.tsx`.
