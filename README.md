# Test Console

FastAPI backend + React/Vite frontend for BLE-driven PA mode testing with VISA
RF instruments, an Arcus trombone motor, and an Arduino RF switch.

See [`docs/architecture.md`](docs/architecture.md) for the structural overview
and conventions used across the codebase.

---

## What to install on a new PC

Work through these in order. Everything is Windows-only — the DLLs, the VISA
stack and the BLE adapter all assume Windows 10/11.

### 1. Applications

| # | Install | Why | Verified version |
|---|---------|-----|------------------|
| 1 | **Python 3.12** (3.11+ works) — tick *Add python.exe to PATH* | Backend runtime | 3.12 |
| 2 | **Node.js 20+ LTS** (ships npm) | Frontend build + dev server | Node 26.5.1 / npm 11.17.0 |
| 3 | **Git** | Two Python deps install straight from GitHub | — |
| 4 | **Keysight IO Libraries Suite** | **Required** — the VISA runtime and USB instrument driver | 2026 (21.3.293) |

Keysight IO Libraries is not optional on this rig. It is what provides:

- `visa32.dll` / `visa64.dll` in `C:\Windows\System32` — the library pyvisa
  actually loads;
- `ktvisa32.dll` / `agvisa32.dll` — the Keysight VISA implementation behind the
  IVI shim;
- `ausbtmc.sys` + the `Usbtmc` service — the **USBTMC kernel driver** that binds
  Keysight/Agilent USB instruments (`VID_0957`);
- Keysight Connection Expert, which is the fastest way to confirm an instrument
  is reachable independently of this app.

`pyvisa-py` is in `requirements.txt` as a pure-Python fallback, but the USB
instruments here are driven through Keysight's VISA. Do not rely on `pyvisa-py`
for them.

### 2. Drivers

| Device | Driver | Action needed |
|---|---|---|
| Keysight/Agilent USB instruments (N6705B DC analyzer, network analyzer, spectrum analyzer) | `ausbtmc.sys` (USBTMC) | Installed automatically with IO Libraries |
| Arcus DMX-J-SA trombone motor | Silicon Labs `SiUSBXp` | DLL bundled in-repo, no installer |
| Mini-Circuits power sensor | `mcl_pm_NET45.dll` (.NET 4.5) | DLL bundled in-repo; .NET Framework 4.x ships with Windows |
| Arduino RF switch (servo) | USB-serial (CH340 / FTDI / native USB CDC, depends on the board) | Install only if the board shows up as an unknown device |
| BLE / DUT | Windows built-in Bluetooth stack | None |

### 3. DLLs — nothing to copy by hand

The native DLLs live in the repo under `backend/hw/dlls/` and are registered at
startup by [`backend/hw/dll_setup.py`](backend/hw/dll_setup.py), which calls
`os.add_dll_directory()` per subfolder and sets `MCL_PM_DLL_DIR`:

```
backend/hw/dlls/
  motor/          PerformaxCom.dll, SiUSBXp.dll     (Arcus DMX-J-SA)
  power_sensor/   mcl_pm_NET45.dll                  (Mini-Circuits PM)
```

The only DLLs you install yourself are the VISA ones, and those come from the
Keysight installer in step 1.

### 4. Python modules

All pinned in [`requirements.txt`](requirements.txt):

- **Web** — `fastapi`, `uvicorn[standard]`, `pydantic`
- **Instruments** — `pyvisa`, `pyvisa-py`, `pyserial`
- **BLE** — `bleak`
- **Reports** — `openpyxl`
- **From GitHub (needs Git on PATH)** —
  `rf-instruments` (provides `dc_power_analyzer`, `power_sensor`,
  `network_analyzer`) and `dmx-j-sa` (Arcus motor)
- **Transitive but explicit** — `pythonnet` (loads the Mini-Circuits .NET DLL)
  and `numpy` (imported at module level by `network_analyzer`). `rf-instruments`
  declares no dependencies of its own, which is why these two are pinned here.

### 5. Node modules

Everything is in `frontend/package.json` — React 19, MUI 6, TanStack Query,
React Router, Recharts, Vite 8, Vitest. Installed by `npm install`.

---

## Setup

### Scripted

[`scripts/setup-new-pc.ps1`](scripts/setup-new-pc.ps1) does the environment
report, clone, dependency install (via `uv`) and VISA verification in one pass,
transcribing everything to a log:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-new-pc.ps1
```

It defaults to cloning into `C:\dev\test-console` rather than `Documents` on
purpose — see Troubleshooting.

### Manual

From the repo root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd frontend
npm install
cd ..
```

---

## Verify the install

Run this before touching any code. It confirms pyvisa bound the **Keysight**
VISA library and that the instruments enumerate:

```powershell
.\.venv\Scripts\python.exe -c "import pyvisa; rm = pyvisa.ResourceManager(); print(rm.visalib); print(rm.list_resources())"
```

Expected shape — note the path must be the real VISA library, not pyvisa-py:

```
Visa Library at C:\Windows\system32\visa32.dll
('USB0::0x0957::0x0F07::MY50000200::0::INSTR',)
```

Then confirm the wrappers import:

```powershell
.\.venv\Scripts\python.exe -c "import dc_power_analyzer, power_sensor, network_analyzer; print('wrappers ok')"
```

---

## Run — dev

Two terminals.

**Backend** — this is the form to use whenever instruments are attached:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --timeout-graceful-shutdown 3 --port 8000
```

Call the venv's interpreter by path rather than activating and running
`python`: a bare `python` takes whichever one is first on `PATH`, and the
system install has neither the wrappers nor `uvicorn`.

`--timeout-graceful-shutdown 3` keeps Ctrl+C snappy; without it uvicorn waits
indefinitely for in-flight streaming responses.

API at `http://localhost:8000`. Health: `GET /health`. Docs: `/docs`.

### Live reload, and why it is not the default

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --reload-dir backend --timeout-graceful-shutdown 3 --port 8000
```

`--reload` restarts on `.py` edits — `--reload-dir backend` keeps it off
`frontend/` and `node_modules/` — but **instrument calls can fail under it**,
with:

```
VisaIOError: VI_ERROR_LIBRARY_NFOUND (-1073807202):
A code library required by VISA could not be located or loaded.
```

Reload does not serve requests from the process you started. It spawns a
worker, and that worker comes up under the *base* interpreter rather than the
venv:

```
reloader  →  .venv\Scripts\python.exe                    (what you launched)
worker    →  ...\Programs\Python\Python312\python.exe     (what serves)
```

Python code still imports, because the venv's packages are passed to the
worker. The DLL search path is not, so `visa32.dll` loads and then fails to
find the vendor library behind it. Whether it survives depends on the `PATH`
the worker inherits, which is why this can work from one terminal and not
another.

Use reload for routes, schemas and anything that does not touch hardware.
Switch back to the command above for the rig — or run it from VS Code, where
`.vscode/launch.json` offers both as separate configurations.

**Frontend** (Vite HMR):

```powershell
cd frontend
npm run dev
```

Dev server at `http://localhost:5173`. Vite proxies `/ble`, `/device`,
`/instruments`, `/motor`, `/servo`, `/test`, `/health` to the backend on
`:8000`, so open the app on **5173**, not 8000, while developing.

**Tests.** Frontend tests need nothing extra:

```powershell
cd frontend
npm test
```

Backend tests need `pytest`, which is **not** pinned in `requirements.txt` —
install it into the venv on a new machine:

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
```

```powershell
.\.venv\Scripts\python.exe -m pytest
```

## Run — production

Build the SPA once, then serve it directly from FastAPI (one terminal, no
proxy):

```powershell
cd frontend
npm run build
cd ..
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

The backend serves `frontend/dist` at `/`.

---

## Troubleshooting

**An instrument is missing from the app's list.** Work down the stack — do not
start by reinstalling Python packages.

1. Is it in Device Manager? A Keysight USB instrument appears as *USB Test and
   Measurement Device (IVI)*. Check from PowerShell:

   ```powershell
   Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB\VID_0957*'
   ```

2. **Nothing at all in Device Manager** means the problem is *below* the driver
   layer — power, cable or port. A missing driver still leaves a yellow-bang
   device visible. Reinstalling software will not help.
3. Device present but VISA shows nothing → re-run the verify command above and
   check `rm.visalib` is the Keysight DLL.
4. VISA sees it but the app does not → then it is worth looking at the code.

**The N6705B DC Power Analyzer enumerates only at boot.** It brings up its
USBTMC interface only if the USB cable is already connected when it powers on.
Hot-plugging into a running instrument produces no enumeration whatsoever.
Connect USB first, then power-cycle the instrument at the rear switch (off,
30 s, on) and let it fully boot.

**Connect fails with an empty address field.** The `dc_power_analyzer` wrapper's
built-in default is a placeholder serial (`MY00000000`) that will not match a
real unit. Always hit **Discover** first — it auto-fills the true resource
string, which carries an extra interface field the default lacks:

```
USB0::0x0957::0x0F07::MY50000200::0::INSTR
```

**`VI_ERROR_LIBRARY_NFOUND` — "a code library required by VISA could not be
located or loaded".** pyvisa found `visa32.dll` but not the vendor library
behind it, which means the process serving the request is not the one you
started. Two causes, in order of likelihood:

1. The backend is running with `--reload`. Its worker comes up under the base
   interpreter, without the venv's DLL search path — see
   [Live reload](#live-reload-and-why-it-is-not-the-default). Restart without
   the flag.
2. It was launched with a bare `python`, which resolved to the system install.
   Call `.\.venv\Scripts\python.exe` by path.

Confirm which interpreter is actually serving, rather than which one you
launched — with `--reload` they differ:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
```

A stale worker can outlive its reloader and keep port 8000, so a restart alone
may leave the broken process serving. If the port is held by a PID that no
longer exists, kill the surviving child:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

**`pip install` fails with `[Errno 9] Bad file descriptor`.** Seen on a machine
whose `Documents` folder was redirected (OneDrive Known Folder Move, or a
policy-pushed network share) — the redirection drops file handles mid-install.
Clone to a plain local path such as `C:\dev\test-console`, or install with
[`uv`](https://docs.astral.sh/uv/), which never runs pip's install code path:

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
```

**Instrument marked busy after a failed read.** Each instrument runs on its own
single-thread executor with a 25 s timeout
([`backend/api/instruments/_bus.py`](backend/api/instruments/_bus.py)). A call
that outlives the timeout leaves the thread running; disconnect and reconnect
that instrument rather than restarting the server.

---

## Layout

```
backend/                FastAPI app, drivers, instrument adapters
  api/                  HTTP routers (one file per resource)
    instruments/        Per-instrument routes + shared VISA discovery
  ble/ motor/ servo/    Per-device drivers
  hw/                   RF-instrument adapters + bundled DLLs
  protocol/             DUT Cat-M2 framing
  sweep/ tests/
  main.py device.py errors.py

frontend/               React + Vite + MUI SPA
  src/
    api/                Typed fetch clients
    components/         App-wide widgets (Sidebar, modals, ...)
    context/            React providers (Connection, Instruments, ...)
    hooks/ store/       Reusable hooks + persistence
    tests/<id>/         One folder per test page (Page + module)
    types/

docs/                   Architecture guide + design notes
scripts/                setup-new-pc.ps1
requirements.txt        Python deps
```

## Tips

- Hard refresh in the browser (Ctrl+F5) clears the per-page localStorage
  snapshots if a stale layout sticks.
- `--reload` on the backend wipes hardware sessions on every save; drop the
  flag for stable long-running connections.
- `/docs` (Swagger UI) is the fastest way to poke an endpoint without going
  through the React app.
- Keysight Connection Expert is the tie-breaker when you cannot tell whether a
  VISA problem is yours or the instrument's.
