# 7. Troubleshooting & reference

[← 6. Component pages](06-component-pages.md) · [Contents](README.md)

- [7.1 Symptoms and fixes](#71-symptoms-and-fixes)
- [7.2 Error status codes](#72-error-status-codes)
- [7.3 Constants shared across the stack](#73-constants-shared-across-the-stack)
- [7.4 Export formats at a glance](#74-export-formats-at-a-glance)
- [7.5 Known discrepancies](#75-known-discrepancies)
- [7.6 Glossary](#76-glossary)

---

## 7.1 Symptoms and fixes

### Instruments

| Symptom | Cause and fix |
|---|---|
| **An instrument is missing from the list** | Work down the stack. (1) Is it in Device Manager? `Get-PnpDevice -PresentOnly \| ? InstanceId -like 'USB\VID_0957*'` for Keysight. (2) If it is absent altogether, the problem is power, cable or port; a missing driver still shows a yellow-bang device. (3) If it is present but not in VISA, re-run the check in [1.5](01-installation-and-configuration.md#15-verifying-the-install). (4) Only if VISA sees it and the app does not, suspect the app. |
| **N6705B never enumerates** | It only brings up USB at power-on. Connect the USB cable, switch it off at the rear, wait 30 s, and switch it on. |
| **Connect fails with the default N6705B address** | The built-in default has a placeholder serial. Press re-scan (↻) in the Instruments panel to get the real resource string. |
| **`VI_ERROR_LIBRARY_NFOUND`** | The backend is running with `--reload`, or under a bare `python`. Restart it with `.venv\Scripts\python.exe` and no reload. A stale worker can keep port 8000: `Get-NetTCPConnection -LocalPort 8000 -State Listen`. |
| **"…is not responding to a previous command"** | A call is stuck on that instrument's queue. Disconnect and reconnect that instrument; there is no need to restart the server. |
| **Motor: Code 28 in Device Manager** | The Arcus kernel driver is missing. Run the unpacked `PerformaxUSBInstaller_x64.exe` (step 3 in [1.2](01-installation-and-configuration.md#arcus-motor-driver-two-steps)). Reinstalling the Python package will not help. |
| **No COM port for the Arduino** | The FTDI VCP driver is missing (FT232R under *Other devices*). |
| **"PermissionError 13" on the switch** | Windows is still holding the port. Unplug and replug the Arduino. |
| **Signal generator: no reply** | If CTS and DSR are both low, it is the cable (it must be null-modem) or the instrument is off. Otherwise, check the baud rate under Utilities → System → RS232. |

### DUT and tests

| Symptom | Cause and fix |
|---|---|
| **Connect is greyed out** | The MAC is not in the current scan. Press **Scan** first, and check the **Device type** filter. |
| **TX page is faded and won't respond** | The DUT is not connected, or its command channel failed to start. Reconnect. |
| **"No signal at the power sensor"** | Check the RF path. Check that the DUT is actually transmitting (look at **Last frame**). Increase **Settle**. |
| **A low-power point reads high** | Settle is too short; it must be at least 400 ms. |
| **DUT stops answering mid-sweep** | The DUT needs 1.5 s after a StopTest. The backend enforces this; if it still happens, disconnect, power-cycle the DUT, and reconnect. |
| **LTE: "modem on rejected"** | The page thought the modem was off, but it was on. Turn the key **off**, then **on**. |
| **LTE: the channel did not change** | A START sent during a live test is silently dropped. Press **Stop**, then Send again. |
| **Measured power is off by a fixed amount** | The path loss is wrong or uncalibrated at that frequency (the chip is amber). Add a table point for that frequency. |
| **Load Pull: Run is disabled** | Read the **Before running** notice. It usually means the path is not confirmed, or Zero/End are not captured. |
| **Load Pull: motor refuses to jog** | It is at a soft limit ("already at max/min soft limit"). Clear Zero or End to go further. |
| **Mode Sweep results vanished** | They are held in backend memory and are lost on a backend restart. Export after every run. |
| **A route answers 404/405/422 after a code update** | The backend is stale. Restart it. |

### Setup

| Symptom | Cause and fix |
|---|---|
| **`pip install`: `[Errno 9] Bad file descriptor`** | The Documents folder is redirected (OneDrive or a network share). Clone to `C:\dev\test-console`, or install with `uv`. |
| **Assistant tab missing** | `CHAT_ENABLED` is not set, or the backend was not restarted after setting it. |
| **Assistant: "No API key on this machine"** | Set `GEMINI_API_KEY`, or create a `.gemini_key` file (see [3.9](03-using-the-console.md#39-assistant)). |

## 7.2 Error status codes

Backend errors reach the UI as HTTP status codes:

| Code | Meaning | Typical cause |
|---|---|---|
| 400 | Bad request | A value outside what the driver accepts |
| 409 | Hardware in the wrong state | Not connected, already running, instrument busy, DUT rejected the command |
| 422 | Validation failed | A field out of range, e.g. Settle below 400 or LTE power above 23 |
| 501 | Driver unavailable | Vendor package not installed (DUT-only build) |
| 504 | Timed out | The instrument or DUT did not answer |
| 500 | Unexpected | See the backend console |

## 7.3 Constants shared across the stack

Each of these values is defined once on the backend and once on the frontend,
and the two must agree.

| Constant | Value | Backend | Frontend |
|---|---|---|---|
| Minimum / default settle | **400 ms** | `backend/sweep/models.py` | `frontend/src/lib/settle.ts` |
| Mode Sweep ranges | Power 1–22, PA DC 1–4, HP Max 1–7 | `backend/sweep/models.py` | `tests/powerSweep/PowerSweepPage.tsx` |
| Path loss | *DUT = reading + loss*; exact-frequency match ±0.001 MHz | `SweepConfig.path_loss_db` | `lib/pathLoss.ts`, `PathLossContext` |
| No-signal threshold | −100 dBm | `api/instruments/__init__.py` | `tests/powerMeter/PowerMeterPage.tsx` |
| Best-settings under-range | −50 dBm | `sweep/export.py` | `tests/powerSweep/bestSettings.ts` |
| LTE maximum power | 23 dBm | `device/lte.py` | LTE pages |
| LTE bandwidth → RB | 1.4/3/5/10/15/20 MHz → 6/15/25/50/75/100; MCS 0–28 | `device/lte.py` | `tests/lteModulated/signal.ts` |
| Discovery timeout | 12 s backend, 20 s frontend (the frontend's must be the longer) | `api/instruments/_common.py` | `context/InstrumentsContext.tsx` |
| Signal generator baud | 9600 | `api/instruments/signal_generator.py` | `api/signalGenerator.ts` |
| Trombone scale | 400 pulses/mm; 3,200 pulses/rev | `motor/manager.py` | `tests/loadPull` |

## 7.4 Export formats at a glance

| Page | Format | File name | Import? |
|---|---|---|---|
| LoRa CW automation | CSV | `<MAC>-<UTC ts>.csv` / `tx-cw-automation-<ts>.csv` | yes (replaces the table) |
| LoRa Modulated automation | CSV | `<MAC>-<ts>.csv` / `lora-modulated-automation-<ts>.csv` | yes |
| LTE CW automation | CSV | `<MAC>-<ts>.csv` / `lte-cw-automation-<ts>.csv` | yes |
| LTE Modulated automation | CSV | `<MAC>-<ts>.csv` / `lte-modulated-automation-<ts>.csv` | yes |
| Mode Sweep | xlsx: All, Run, one sheet per dBm level | `pa_modes_YYYYMMDD_HHMMSS.xlsx` | yes (view only) |
| Load Pull | xlsx: All, Run, one sheet per frequency | `load_pull_YYYYMMDD_HHMMSS.xlsx` | yes (.xlsx or older .csv) |
| Results graph | PNG | `<MAC>-<power\|current>-<ts>.png` | — |
| Smith chart | PNG to the clipboard | — | — |
| Log | TXT | `log-<ts>.txt` | — |

## 7.5 Known discrepancies

These are places where the code and the documentation, or the UI, disagree.
Each one is described as the code behaves today.

1. **Assistant limits:** the repo README lists 8/min and 200/day. The code
   defaults are **4/min and 18/day**.
2. **Load Pull setup drawing** labels the equipment N5224B / N6705C / MT986A,
   with an FSW26 on the coupler. The app drives an E5061B, an N6705B and an
   Arcus DMX-J-SA, and measures power with the Mini-Circuits sensor.
3. **Load Pull's empty table** says "Import a previous CSV", but Export
   writes xlsx only. Import accepts both.
4. **DC analyzer channel:** the connect route defaults to 1; the UI and the
   Mode Sweep default to 3.
5. **The signal generator's Instruments-panel placeholder** shows a VISA
   string, but its address is a COM port.
6. **The signal generator** is not released on a graceful backend shutdown.
   Its COM port is freed when the process exits.
7. **Export file names** from the CW and Modulated pages (LoRa and LTE) are
   identical when a MAC is known, so rename them to keep track.

## 7.6 Glossary

| Term | Meaning |
|---|---|
| **DUT** | Device under test: the meter being measured |
| **PA** | Power amplifier |
| **CW** | Continuous wave: an unmodulated carrier |
| **Path loss** | dB between the DUT and the sensor, added to readings |
| **Settle** | How long the PA stays keyed before a reading is taken |
| **PA Mode** | Off / On / Auto selection of the PA |
| **PA Duty Cycle, HP Max** | Radio PA registers swept by Mode Sweep and set by Debug |
| **EARFCN** | LTE channel number; maps to one uplink frequency |
| **RB / MCS** | LTE resource blocks / modulation and coding scheme |
| **Trombone** | Motorised variable-length line; rotates the load's phase |
| **Soft limits** | Zero–End travel range enforced by the backend |
| **S11 / S21** | Reflection / transmission, measured by the VNA |
| **VSWR** | (1 + \|Γ\|) / (1 − \|Γ\|) |
| **Preflight** | Connecting the needed instruments before a Send or Run |

## 7.7 Regenerating this manual

The manual is built from text sources, so it stays in step with the
application:

| Path | Holds |
|---|---|
| `docs/manual/source/*.md` | The text of each chapter |
| `docs/manual/img/` | Screenshots and rendered diagrams |
| `docs/manual/tools/` | The scripts below |

With the backend (:8000) and `npm run dev` (:5173) running, install the
tooling once into a temporary folder:

```
npm i --no-save --prefix %TEMP%\pw playwright-core docx marked
set NODE_PATH=%TEMP%\pw\node_modules
```

Then run:

```
node docs\manual\tools\capture-screenshots.cjs
node docs\manual\tools\render-diagrams.cjs
node docs\manual\tools\build-docx.cjs
```

1. `capture-screenshots.cjs` re-takes every screenshot in the Light theme,
   using the installed Google Chrome. It only switches tabs and opens dialogs,
   and refuses to click anything outside its allow-list, so it never
   transmits, moves the trombone, or drives the switch.
2. `render-diagrams.cjs` turns the setup diagrams in chapter 2 into images.
3. `build-docx.cjs` assembles `Test-Console-User-Manual.docx`. When Microsoft
   Word is installed, it also fills in the table of contents and exports a
   PDF.
