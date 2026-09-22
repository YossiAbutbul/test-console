# 1. Installation & configuration

[← Contents](README.md) · Next: [2. Hardware & connections →](02-hardware-and-connections.md)

- [1.1 What the PC needs](#11-what-the-pc-needs)
- [1.2 Drivers](#12-drivers)
- [1.3 Software dependencies](#13-software-dependencies)
- [1.4 Installing](#14-installing)
- [1.5 Verifying the install](#15-verifying-the-install)
- [1.6 Running the app](#16-running-the-app)
- [1.7 Environment variables](#17-environment-variables)
- [1.8 Launchers, scripts and IDE configs](#18-launchers-scripts-and-ide-configs)
- [1.9 The standalone (DUT-only) desktop build](#19-the-standalone-dut-only-desktop-build)
- [1.10 Where settings and files live](#110-where-settings-and-files-live)

---

## 1.1 What the PC needs

The app runs on **Windows 10/11 only**. The vendor DLLs, the VISA stack and
the BLE adapter all assume Windows.

| # | Install | Why | Verified version |
|---|---|---|---|
| 1 | **Python 3.12** (3.11+ works). Tick *Add python.exe to PATH*. | Runs the backend | 3.12.10 |
| 2 | **Node.js 20+ LTS** (includes npm) | Builds the frontend and runs the dev server | Node 26.5.1 / npm 11.17.0 |
| 3 | **Git** | Two Python packages install straight from GitHub | — |
| 4 | **Keysight IO Libraries Suite** | **Required.** Supplies the VISA runtime and the USB instrument driver. | 2026 (21.3.293) |
| 5 | **Arcus Drivers and Tools Installer** | **Required** for the trombone motor. Supplies its kernel driver. | 1.43 |
| — | Bluetooth adapter | Talks to the DUT | Windows built-in stack |

The Keysight suite provides:

- `visa32.dll` / `visa64.dll` in `System32`;
- the Keysight VISA implementation (`ktvisa32.dll`, `agvisa32.dll`);
- the **USBTMC kernel driver** (`ausbtmc.sys`) that binds Keysight USB
  instruments (vendor ID `0x0957`);
- Keysight Connection Expert, which is the quickest way to check an
  instrument is reachable independently of this app.

`pyvisa-py` is installed as a pure-Python fallback, but do not rely on it for
the USB instruments. They are driven through Keysight VISA.

## 1.2 Drivers

| Device | Driver | What you need to do |
|---|---|---|
| Keysight USB instruments (N6705B, E5061B) | `ausbtmc.sys` (USBTMC) | Nothing more; installed with IO Libraries |
| Arcus DMX-J-SA trombone motor | Performax USB (WinUSB-based) | **Two-step install**, below |
| Mini-Circuits power sensor | `mcl_pm_NET45.dll` (.NET 4.5) | Nothing; the DLL is bundled in the repo and .NET 4.x ships with Windows |
| Arduino RF switch | **FTDI VCP** (`ftdibus.sys`/`ftser2k.sys`) for the FT232R | Install if the board shows under *Other devices* |
| R&S SML03 signal generator | the driver for your USB-to-RS-232 adapter, if you use one | As supplied with the adapter |
| DUT | Windows Bluetooth | Nothing |

### Arcus motor driver (two steps)

The `dmx-j-sa` Python package ships `PerformaxCom.dll` and `SiUSBXp.dll`.
These are **user-mode** libraries only. They still need a kernel driver
underneath, which neither the repo nor Windows provides. Without it the motor
appears in Device Manager as `Arcus-USB` (`USB\VID_1589&PID_A101`) with
**Code 28**.

1. On the Arcus
   [DMX-J-SA-17 product page](https://arcus-technology.com/products/integrated-stepper-motors/nema-17-integrated-usb-stepper-basic/),
   open **Software** and download **Drivers and Tools Installer** (1.43).
2. Run it as administrator. **This step only unpacks files** to
   `C:\Program Files (x86)\Arcus Technology\Drivers, Libraries, Source\Performax USB v4.01\`.
3. Run the unpacked `PerformaxUSBInstaller_x64.exe` as administrator
   (`install.bat` in the same folder picks x64 or x86 for you). This is the
   step that actually binds the driver.
4. Replug the motor, then check that `Status` reads `OK`:

```powershell
Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB\VID_1589*' | Select-Object Status, FriendlyName, InstanceId
```

### FTDI driver for the RF switch

The Arduino board presents an **FT232R** (`USB\VID_0403&PID_6001`). Without
the VCP driver it never gets a COM port.

1. In Device Manager, right-click **FT232R USB UART** → *Update driver* →
   **Search automatically**.
2. If Windows Update is blocked, download the package from
   <https://ftdichip.com/drivers/vcp-drivers/>.
3. Check that a `USB Serial Port (COMn)` shows `Status: OK`:

```powershell
Get-PnpDevice -PresentOnly -Class Ports | Select-Object Status, FriendlyName
```

> Clone FT232R chips are refused by current FTDI drivers ("NON GENUINE DEVICE
> FOUND"). A board with a clone chip has to be replaced (a CH340-based board
> works); a different driver will not fix it.

### Bundled DLLs

These live in the repo and are registered at startup by
`backend/hw/dll_setup.py`. You never copy them by hand.

```
backend/hw/dlls/
  motor/          PerformaxCom.dll, SiUSBXp.dll   (Arcus DMX-J-SA)
  power_sensor/   mcl_pm_NET45.dll                (Mini-Circuits)
```

## 1.3 Software dependencies

### Python (`requirements.txt`)

These are minimum versions (`>=`), not exact pins. The "installed" column is
what the rig's `.venv` currently runs.

| Package | Minimum | Installed | Used for |
|---|---|---|---|
| fastapi | 0.110 | 0.140.13 | Web API |
| uvicorn[standard] | 0.27 | 0.52.0 | Web server |
| pydantic | 2.6 | 2.13.4 | Request validation |
| bleak | 0.22 | 3.0.2 | BLE to the DUT |
| openpyxl | 3.1 | 3.1.5 | Excel import and export |
| pyvisa | 1.16 | 1.16.2 | VISA instruments |
| pyvisa-py | 0.8 | 0.8.1 | Fallback VISA backend |
| pyserial | 3.5 | 3.5 | RF switch, signal generator |
| rf-instruments (git) | — | 0.2.0 | `power_sensor`, `dc_power_analyzer`, `network_analyzer` wrappers |
| dmx-j-sa (git) | — | 0.1.0 | Arcus motor wrapper |
| pythonnet | 3.0.3 | 3.1.0 | Loads the Mini-Circuits .NET DLL |
| numpy | 1.26 | 2.5.1 | Needed by `network_analyzer` |

`rf-instruments` declares no dependencies of its own, which is why
`pythonnet` and `numpy` are listed explicitly. **`pytest` is not listed.**
Install it separately to run the backend tests.

### Frontend (`frontend/package.json`)

React 19.2, MUI 6.5, TanStack Query 5, React Router 7, Recharts 2.15, Vite 8,
TypeScript 6, Vitest 3, ESLint 10. Everything is installed by `npm install`.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload on :5173 |
| `npm run build` | Type-check (`tsc -b`), then production build into `frontend/dist` |
| `npm test` | Vitest, run once |
| `npm run lint` | ESLint |

## 1.4 Installing

### Scripted (recommended on a new PC)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-new-pc.ps1
```

The script:

1. Logs everything to `setup-log.txt` next to the clone.
2. Checks Python, Documents-folder redirection, disk space, antivirus, the
   VISA DLLs, and Keysight USB devices.
3. Clones into `C:\dev\test-console` (or pulls if it is already there).
4. Installs `uv`, creates `.venv` with Python 3.12, and installs the
   requirements.
5. Checks that pyvisa loads and that the wrappers import.

It clones to `C:\dev` rather than `Documents` on purpose: a redirected
Documents folder (OneDrive, network share) makes `pip` fail with
`[Errno 9] Bad file descriptor`.

### Manual

```powershell
python -m venv .venv
```

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

```powershell
cd frontend; npm install
```

## 1.5 Verifying the install

Check that pyvisa is bound to **Keysight** VISA and that instruments are
listed:

```powershell
.\.venv\Scripts\python.exe -c "import pyvisa; rm = pyvisa.ResourceManager(); print(rm.visalib); print(rm.list_resources())"
```

Expected output (the library path must be `visa32.dll`, not pyvisa-py):

```
Visa Library at C:\Windows\system32\visa32.dll
('USB0::0x0957::0x0F07::MY50000200::0::INSTR', ...)
```

Then check that the wrappers import:

```powershell
.\.venv\Scripts\python.exe -c "import dc_power_analyzer, power_sensor, network_analyzer; print('wrappers ok')"
```

## 1.6 Running the app

### Every day: the launcher

Double-click **`Test Console.bat`** in the repo root. It:

1. installs `node_modules` if they are missing;
2. rebuilds the frontend if any source is newer than `frontend/dist`;
3. starts the backend on :8000;
4. opens the browser once `/health` answers.

Press Ctrl+C in its window for a clean shutdown, which releases BLE and every
instrument.

`Test Console (dev).bat` does the same but also runs Vite with hot reload on
:5173.

### Development: two terminals

Backend. Use this form whenever instruments are attached:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --timeout-graceful-shutdown 3 --port 8000
```

Frontend:

```powershell
cd frontend; npm run dev
```

Open **http://localhost:5173**. Vite proxies these backend paths to :8000:
`/ble`, `/capabilities`, `/chat`, `/device`, `/instruments`, `/motor`,
`/servo`, `/test`, `/health`. API documentation is at
`http://localhost:8000/docs`.

> **Do not use `--reload` with hardware attached.** The reload worker starts
> under the base interpreter instead of the venv. It loses the DLL search
> path, and VISA then fails with `VI_ERROR_LIBRARY_NFOUND`. For the same
> reason, always name the venv interpreter explicitly. A bare `python` picks
> up whichever interpreter is first on PATH.

> **Backend changes need a restart.** Without `--reload` nothing is picked up
> until the process restarts. A stale process is the usual explanation for a
> route answering 404/405/422.

### Production (one terminal, no proxy)

```powershell
cd frontend; npm run build
```

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

The backend serves the built UI at `http://localhost:8000/`. Assets are
cached for a year and `index.html` is never cached, so a rebuild shows up
without a hard refresh.

### Running the tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

```powershell
cd frontend; npx tsc -b; npm test; npx eslint src
```

## 1.7 Environment variables

All of these are read by the backend. The frontend reads none.

### General

| Variable | Default | Effect |
|---|---|---|
| `INSTRUMENTS_ENABLED` | unset | Unset: instruments are available if their packages import. `1`/`true`/`yes`/`on` forces them available; `0`/`false`/`no`/`off` forces the DUT-only view (see [1.9](#19-the-standalone-dut-only-desktop-build)). |
| `MCL_PM_DLL_DIR` | set automatically to `backend/hw/dlls/power_sensor` | Where the Mini-Circuits DLL is searched for first |
| `LOCALAPPDATA` / `APPDATA` | OS | Desktop build only: its data folder is `%LOCALAPPDATA%\TestConsole` |

### Assistant (optional)

The Assistant is **off by default**. Turn it on with `CHAT_ENABLED=1`, then
restart the backend. Setup is described in [3.9](03-using-the-console.md#39-assistant).

| Variable | Default | Effect |
|---|---|---|
| `CHAT_ENABLED` | off | Whether the Assistant tab and the `/chat` routes exist. Read on every request. |
| `GEMINI_API_KEY` | none | Google AI Studio key. If unset, the key is read from a `.gemini_key` file in the repo root. Read on every request. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model to ask |
| `CHAT_RPM_LIMIT` | **4** | Questions per rolling minute |
| `CHAT_RPD_LIMIT` | **18** | Questions per day (resets at midnight Pacific) |
| `CHAT_TPM_LIMIT` | 200000 | Tokens per rolling minute; 0 disables the limit |
| `GEMINI_THINKING_LEVEL` | `LOW` | `HIGH` for more reasoning; empty sends no preference |
| `CHAT_ANSWER_STYLE` | `minimal` | `minimal` answers in one or two sentences; `detailed` explains its reasoning |
| `CHAT_MAX_OUTPUT_TOKENS` | 1200 | Maximum answer length |
| `CHAT_TEMPERATURE` | 0.2 | Sampling temperature |
| `CHAT_TIMEOUT_S` | 60 | Request timeout |
| `CHAT_MAX_CONTEXT_CHARS` | 24000 | Limit on the results text sent with a question |
| `CHAT_MAX_BLOCK_CHARS` | 12000 | Limit per results block |
| `CHAT_MAX_HISTORY_TURNS` | 8 | Past turns re-sent with each question |
| `CHAT_MAX_UPLOAD_BYTES` | 12582912 (12 MiB) | Largest workbook you can attach |

Except for `CHAT_ENABLED` and the key, these variables are read once at
startup and need a backend restart to take effect.

> The repo README lists 8 per minute and 200 per day. Those figures are out
> of date. The code defaults are 4 and 18, which were lowered to match what
> the free tier actually allows.

## 1.8 Launchers, scripts and IDE configs

| File | Purpose |
|---|---|
| `Test Console.bat` | Runs `scripts\launch.ps1` (see [1.6](#16-running-the-app)) |
| `Test Console (dev).bat` | The same with `-Dev` (Vite hot reload) |
| `scripts/launch.ps1` | Options `-Dev`, `-NoBuild`, `-NoBrowser`, `-Port 8000`. Refuses to start if :8000 is held by something other than this backend, or :5173 is busy in dev mode. |
| `scripts/setup-new-pc.ps1` | New-PC install (see [1.4](#14-installing)). Options `-Dest`, `-RepoUrl`. |
| `scripts/build-app.ps1` | Desktop build. Options `-Zip`, `-NoFrontend`, `-NoVenv`. |
| `scripts/sml_probe.py` | Diagnoses the SML03 serial link: `python scripts\sml_probe.py COM6 COM7` tries every baud rate and handshake. **Do not point it at the Arduino's port**; opening that port resets the Arduino. |
| `.vscode/launch.json` | **Backend** (use this one with hardware), *Backend (reload — no hardware)*, *Frontend (vite)*, and a compound configuration that starts both |
| `.claude/launch.json` | *Frontend*: `npm run dev` on :5173 |

## 1.9 The standalone (DUT-only) desktop build

This is a self-contained Windows app for a PC with no rig: no Python, no Node,
no drivers. It drives the DUT over BLE. The rig pages are shown greyed out.

```bash
powershell -ExecutionPolicy Bypass -File scripts\build-app.ps1 -Zip
```

- Output is `dist\TestConsole\` (about 35 MB) and `dist\TestConsole.zip`.
- To use it, unzip anywhere and double-click `TestConsole.exe`. The browser
  opens on the console. Closing the console window stops the app.
- On first launch Windows SmartScreen warns about it. Click **More info →
  Run anyway**.
- The build deliberately leaves out pyvisa, the instrument wrappers, the
  motor wrapper, pythonnet, numpy and pyserial. The build script fails if
  pyvisa can be imported in the build venv.
- It uses port 8000 if free, otherwise a random free port.

To preview the greyed-out UI on the rig without building anything, set
`INSTRUMENTS_ENABLED=0` and restart the backend.

## 1.10 Where settings and files live

### In the browser

These settings live in the browser's localStorage, so they belong to that
browser profile on that PC.

| Key | Holds | Default |
|---|---|---|
| `app-theme-pref` | Theme: `dark` / `mid` / `light` / `system` | `mid` |
| `active-page-v1` | Last page opened | LoRa › TX › CW |
| `path-loss-db-v1` | Default path loss (dB) | 0 |
| `path-loss-table-v1` | Per-frequency path-loss table | empty |
| `device-type-v1` | BLE scan name filter | Sonata 2 IL |
| `mac-nicknames-v1` | MAC → nickname | empty |
| `dc-supply-voltage-v1` | DC supply voltage in Settings | 3.6 V |
| `dc-supply-enabled-v1` | DC supply switch. **Always reset to off on load.** | off |
| `log-panel-width-v1`, `dock-tab-v1` | Right-hand dock width and tab | 340 px, Log |
| `lte-bands-v1`, `lte-channel-unit-v1` | LTE bands in use, EARFCN/MHz | 2, 4, 12; EARFCN |
| `*-page-snapshot-v1/v2` | Each page's form values and automation results (CW, Modulated, LTE CW, LTE Modulated, Load Pull, Power Meter, Signal Generator) | — |

These live in sessionStorage, which survives a reload but is lost when the
tab closes: the **Log** (`log-entries-v1`) and the **Assistant conversation**
(`chat-messages-v1`).

**Not saved anywhere:**

- instrument addresses and the DC analyzer channel (discovery refills them);
- the scan duration and scan results;
- the RF-path confirmation on Load Pull;
- Mode Sweep form settings.

### On disk

| File | Written by |
|---|---|
| `.gemini_key` (repo root; `%LOCALAPPDATA%\TestConsole` in the desktop build) | You. It holds the Assistant key and is git-ignored. |
| `.chat-quota.json` | The backend: the Assistant's usage counters (git-ignored) |

The backend **writes no log files**; it logs to its console window. Exports
(CSV and xlsx) are never stored on the server. They download through the
browser, which shows a **Save As** dialog where it supports one.
