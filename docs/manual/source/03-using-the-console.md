# 3. Using the console

[← 2. Hardware](02-hardware-and-connections.md) · [Contents](README.md) · Next: [4. LoRa tests →](04-lora-tests.md)

- [3.1 Screen layout](#31-screen-layout)
- [3.2 Connecting the DUT](#32-connecting-the-dut)
- [3.3 Instruments panel](#33-instruments-panel)
- [3.4 Path loss](#34-path-loss)
- [3.5 Settings](#35-settings)
- [3.6 The measurement card](#36-the-measurement-card)
- [3.7 Preflight: instruments before a test](#37-preflight-instruments-before-a-test)
- [3.8 Log and notifications](#38-log-and-notifications)
- [3.9 Assistant](#39-assistant)
- [3.10 Search and keyboard shortcuts](#310-search-and-keyboard-shortcuts)
- [3.11 DUT-only builds](#311-dut-only-builds)

---

## 3.1 Screen layout

![The console](img/shell-overview.png)

| Area | What it holds |
|---|---|
| **Top bar** | The logo and title, the page search (**Ctrl+Shift+K**), and the dock tabs (**Log**, and **Assistant** when it is enabled). |
| **Sidebar** (left) | **Instruments**, then the page tree. Its footer shows the BLE status (**Connected** / **Disconnected**, plus the device name) and the **Settings** gear. |
| **Connection row** | Along the top of every page: path loss, scan duration, device type, MAC address, meter info, **Scan**, **Connect**. |
| **Page** | Breadcrumb (e.g. `LORA / TX`), title, the page's action buttons on the right, then its sections. |
| **Dock** (right) | Log or Assistant. Drag its left edge to resize it (240–720 px); close it with the X. |

![Sidebar with every folder open](img/sidebar-expanded.png)

**The page tree:**

- **LoRa › TX:** CW, Modulated, Debug, Mode Sweep.
- **LoRa › Other:** Load Pull Test.
- **LTE › TX:** CW, Modulated.
- **BLE:** *coming soon*.
- **Components:** Trombone, Switch, Network Analyzer, Power Meter, Signal
  Generator.

"Other" and Components start collapsed, except for the folder holding the
page you are on.

**Pages stay loaded.** Every page is loaded once at startup, and switching
pages only hides and shows them. So form values, results and a running
automation all survive navigation.

**DUT pages are dimmed until a unit is connected.** The TX pages (LoRa CW,
Modulated, Debug, Mode Sweep; LTE CW, Modulated) fade to 60 % and ignore
clicks until the DUT is connected **and** its command channel is ready. The
Components pages and Load Pull are never dimmed.

![A DUT page with no unit connected](img/dut-page-dimmed.png)

**On a narrow window** (under 1200 px), the sidebar and dock fold away.
Click the logo to show the menu; press **Esc** or click outside it to close
it again.

## 3.2 Connecting the DUT

| Field | Meaning |
|---|---|
| **Path loss (dB)** | Default path loss. The tune icon opens the per-frequency table (see [3.4](#34-path-loss)). |
| **Duration (sec)** | Scan length, 1–30 s, default 5. Not saved. |
| **Device type** | Name filter: **All**, **CAT-M 2**, **Sonata 2 IL** (default), **Interpreter G2**. Saved. |
| **MAC Address** | The device picker, with placeholder *"Pick from scan or type MAC"*. |
| **(i)** | **Meter information** (connected only). |
| **Scan / Stop** | Starts a BLE scan, or ends it early. |
| **Connect / Disconnect** | Connects to the chosen device, or disconnects. |

**Procedure**

1. Choose the **Device type**.
2. Press **Scan**. Devices appear as they are heard, strongest signal first,
   and the list opens by itself. The log shows `Scan started (5s)`.
3. Pick the unit. You can type to filter the list:
   - by MAC, **with or without colons** (`7054` finds `70:54:…`);
   - by advertised name;
   - by nickname.
4. Press **Connect**. The sidebar footer turns green with the device name,
   and the TX pages become usable.
5. When finished, press **Disconnect**. A deliberate disconnect is never
   auto-reconnected.

> **Connect is enabled only for a MAC that appeared in the current scan.**
> After a page reload, scan again first. Typing a MAC is not enough. If the
> backend is still connected when you reload, the field refills by itself.

**Next to the MAC field:**

- **Copy** copies the MAC *without* colons.
- **Edit nickname** (pencil) names a unit, e.g. "Lab unit #3".
  - The nickname appears as a coloured tag, and nicknamed units sort to the
    top of the picker.
  - The tag's colour is derived from the MAC, so it stays the same for that
    unit.
  - Nicknames are stored per browser.
- **Clear** empties the field.

### Meter information

**(i)** opens **Meter Information**. The unit is read fresh each time the
dialog opens.

| Row | Editable? |
|---|---|
| Connected To, Device ID, FW Version, MAC Address | no |
| **App Mode**, **Primary Channel**, **Secondary Channel** | yes |

**Update** is enabled only when you have changed something. It sends, in
order:

1. the channels (if you changed them);
2. the app mode (if you changed it);
3. save-and-reset (only if the channels changed and the unit accepted them).

The unit reboots after either change, so the BLE link drops and the dialog
closes. **Reconnect and re-read to confirm the change stuck.** The outcome
appears as a toast, for example "Channels set to X + Y" or "The unit refused
the channel change (status N)".

## 3.3 Instruments panel

Open it with **Instruments** at the top of the sidebar. The icon turns green
when any instrument is connected.

![Instruments panel](img/instruments-modal.png)

| Section | Instrument | What to enter |
|---|---|---|
| RF MEASUREMENT | Power sensor | Serial number (blank = first sensor found) |
| RF MEASUREMENT | Network analyzer (E5061B) | VISA resource |
| DC SUPPLY | DC analyzer (N6705B) | VISA resource and **Ch** (1–4, default 3) |
| SIGNAL SOURCE | Signal generator (R&S SML03) | COM port. The placeholder wrongly shows a VISA example; use the Signal Generator page to choose the baud rate. |
| SWITCHING | RF switch (Servo (Arduino)) | The USB-serial COM port, e.g. `COM4` |
| MOTION | RF trombone motor (Arcus DMX-J-SA) | Device (e.g. `jsa00`) |
| COMING SOON | Spectrum analyzer (FSW26), Configurable attenuator (50PA-847) | Disabled |

**How it works**

- **Opening the panel runs discovery** for every instrument that is not
  connected. Empty address fields are filled with the best match:
  - an IDN containing `N6705`, `E5061` or `FSW` for the VISA instruments;
  - otherwise the first result.

  Results that clearly belong to another model are hidden. Discovery gives up
  after 20 s, silently.
- **Re-scan** (↻) discovers that row again. Every entry in the dropdown shows
  its IDN, or *no IDN response*.
- **Connect** needs a non-empty address and waits up to 15 s. The status dot
  is green when connected, red on error, grey when disconnected.
- **Connect all (N)** / **Disconnect all (N)** works through the rows one at
  a time.
- **Connecting the RF switch here also moves it to VNA.** Connecting it from
  the Switch page does not.

**If a connection fails,** the row shows a title, a fix, and a **details**
link to the raw driver text:

| Title | Fix |
|---|---|
| No response | Check power and cable, then retry. |
| Not found at that address | Re-scan and pick it again. |
| Already in use | Another program or session holds it. Close it, or disconnect and retry. |
| Driver not installed | Install the vendor library and restart the backend. |
| Backend unreachable | Restart the backend. |
| Rejected by the instrument | Check the address and channel. |

**Connections live in the backend,** so they survive a page reload and are
shared between browser tabs. The status is polled every 5 s. **Addresses are
not saved**; opening the panel rediscovers them.

## 3.4 Path loss

Path loss is the total loss between the DUT and the power sensor. The app
**adds** it to every reading:

```
DUT power = sensor reading + path loss
```

- The **Path loss (dB)** field in the connection row is the **default**.
- The tune icon inside it opens the **per-frequency table**:

![Path loss table](img/path-loss-table.png)

**Rules**

- **Exact frequencies only.** A table entry applies only within ±0.001 MHz
  of its frequency, and there is **no interpolation**. Real cable loss is not
  linear, and guessing between points would hide a gap in the calibration.
- **Everything else uses the default** and is flagged **uncalibrated**:
  - in amber on the measurement card;
  - on the path-loss chip;
  - in a warning at the end of an automation run that lists the uncalibrated
    frequencies.
- **Editing the table:** two rows cannot share a frequency. Every filled-in
  row needs a positive frequency and a numeric loss; blank rows are ignored.
- **Scope:** the default and the table are saved per browser and apply to
  every page.
- **Load Pull and automation runs** look the loss up for each point.
  **Mode Sweep** uses one value, at its single frequency.

> **Calibrating a frequency.** Measure the path loss with a known source
> (see [2.4 D](02-hardware-and-connections.md#d-power-meter-and-signal-generator-bench-checks))
> or a network analyzer. Then add the frequency and loss to the table.

## 3.5 Settings

The gear in the sidebar footer opens **Settings**.

![Settings](img/settings.png)

### DC ANALYZER SUPPLY

- The switch turns the N6705B output on or off. The voltage box takes
  0–60 V (default **3.6**); a change applies on **Enter** or when you leave
  the box.
- The switch works only when the DC analyzer is connected. Otherwise the
  panel shows "Connect DC analyzer to apply."
- **It always shows off when the app loads,** and nothing is sent until you
  flip it. Opening Settings or connecting the analyzer never powers the DUT.

### THEME

- **Dark**, **Mid** (the default), **Light**, or **Match system**.
- Match system follows the operating system's setting, and only ever gives
  Light or Dark, never Mid.

## 3.6 The measurement card

This card appears on the manual TX pages (CW, Modulated, Debug, and their
LTE equivalents).

![Measurement card on LoRa CW](img/lora-cw-manual.png)

| Tile | Shows |
|---|---|
| **Target** | The requested power, in dBm |
| **Measured** | Sensor reading + path loss, in dBm, with mW underneath. Or *sensor off*, *not read yet*, *read failed*. |
| **Error** | Measured − Target. Green within ±1 dB, amber within ±2 dB, red beyond. After you change the power it shows *vs X dBm · read again*, because the error is always against the target that was in force **when the reading was taken**. |
| **Current** | mA, with the voltage underneath, or *DC off* |

**When readings happen**

- **After a Send:** the card reads by itself after a successful **Send**,
  400 ms later, provided an instrument it needs is connected.
- **Read** measures again. If nothing is connected, it connects the
  instruments first.

**Header labels**

- `incl. +X dB path loss`, with ` · uncalibrated` in amber when the default
  was used.
- How long the read took, in ms.

**Last frame**

Below the card, the collapsible **Last frame** section shows the raw request
and reply of the last command:

- `tx:` and `rx:` as hex;
- the reply's opcode and payload;
- `ok` and the status byte.

It is useful when the DUT refuses a command.

## 3.7 Preflight: instruments before a test

Pressing **Send** or **Run** first checks that the test's instruments are
connected. If they are, the test starts straight away. If not, the
**Connecting instruments** dialog connects each missing one in turn, with
15 s each and a countdown.

If any instrument still fails, the dialog becomes **Instruments not
connected** and offers:

| Button | Effect |
|---|---|
| **Open Instruments** | Cancels the test and opens the Instruments panel |
| **Cancel** | Cancels the test; the log shows "cancelled — instruments not ready" |
| **Run anyway** / **Send anyway** | Runs without them. Their columns stay blank. |

Pressing Send or Run again while the dialog is open does nothing.

## 3.8 Log and notifications

### Log

- **Format:** each line reads `[HH:MM:SS] [Source] message`, newest at the
  top. Errors are red and warnings amber.
- **Sources:** DUT, Power Sensor, DC Analyzer, Spectrum, Motor, Sweep,
  System, Automation, LoadPull, Switch, Servo, VNA, Signal Gen.
- **Download** saves `log-<timestamp>.txt`, oldest line first, in the form
  `[HH:MM:SS] LEVEL [Source] message`.
- **Clear** empties the log.
- **Retention:** the last 500 lines are kept. They survive a reload and are
  lost when the tab closes.
- **Filters:** there are none.

### Toasts

- Toasts appear in the bottom-right corner.
- **Success** and **info** toasts clear themselves after 6 s, with a
  countdown bar.
- **Warnings** and **errors** stay until you close them.
- Some are standing notices that stay while a condition lasts, such as
  **Before running** on Load Pull.

### Completion dialog

Automation runs, Mode Sweep and Load Pull announce the end of a run with a
centred dialog:

| Outcome | Dialog |
|---|---|
| Success | **<Test> complete**: "N points measured · Took hh:mm:ss" |
| Some points failed | **<Test> finished with errors**: "E of N points failed" |
| You stopped it | **<Test> stopped**: "Stopped after X of N points" |
| It failed | **<Test> failed**, with the reason |

Single commands on the TX pages (Send/Stop) only write to the log.

## 3.9 Assistant

The **Assistant** is an optional chat in the dock. It reads the results on
the page, or a workbook you attach, and answers questions such as *"where
does the power flatten out?"* or *"which points look wrong?"*. It runs on
Google Gemini's free tier. **Nothing is sent until you ask a question.**

### Turning it on

1. Get a key at <https://aistudio.google.com/apikey>. Keep the project on the
   **free tier**; do not enable billing.
2. Store the key in **one** of these places (the environment variable wins if
   both are set):

   ```powershell
   setx GEMINI_API_KEY "paste-the-key-here"
   ```

   or a one-line `.gemini_key` file in the repo root, which is git-ignored.
   **Never put the key in a source file or a commit.**
3. Set `CHAT_ENABLED=1` and restart the backend. The **Assistant** tab
   appears within a minute; no reload is needed.

### Using it

| Part | What it does |
|---|---|
| **Quota line** | Shows `left/limit today · left/limit this min`, plus a token bar. It turns amber when running low. While limited it reads *Google rate-limited, retry in N s* or *Local limit reached…*. |
| **Page chip** | Which pages' results go with the question. By default it follows the page on screen (*This page (CW)*). Click it to tick other pages or none. |
| **Paper clip** | Attaches `.xlsx`, `.xlsm`, `.csv` or `.tsv`. Click an attachment's chip to include or exclude it. |
| **Input** | **Enter** sends, **Shift+Enter** starts a new line |
| **Bin** | Clears the conversation |

**What travels with a question**

- The chips show exactly what is sent with the next question.
- Tables are compacted before sending: constant columns are stated once, and
  each numeric column gets a min/max/mean line.
- A long run is sampled evenly.
- An attached workbook is digested once, on the backend.

The conversation survives a reload but is lost when the tab closes. Limits
are shared by everyone using the console (defaults: 4 a minute, 18 a day).
See [1.7](01-installation-and-configuration.md#17-environment-variables).

## 3.10 Search and keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| **Ctrl+Shift+K** | anywhere | Open page search; press again to close it |
| ↑ / ↓, **Enter**, **Esc** | search | Move through results, open one, close |
| **Esc** | a dialog or the floating menu | Close it (the preflight dialog cannot be closed while it is connecting) |
| **Enter** | Nickname dialog, DC voltage box | Save / apply |
| **←** / **→** held | Load Pull jog pad (once focused) | Jog the trombone while held |

Search matches the protocol, group and page name, so "lte tx" and "sweep"
both work.

## 3.11 DUT-only builds

When the instrument packages are missing (the desktop build, or
`INSTRUMENTS_ENABLED=0`), the app knows from `/capabilities`:

- **Instruments** and the rig pages are **greyed out**, with the reason as a
  tooltip. The rig pages are Mode Sweep, Load Pull, Trombone, Switch, Network
  Analyzer, Power Meter and Signal Generator.
- Search leaves those pages out.
- Opening one shows *"<Page> needs an instrument"*.
- The DUT pages keep working. When they would measure, preflight offers
  **Send anyway / Run anyway**.
