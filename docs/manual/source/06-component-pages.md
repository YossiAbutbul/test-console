# 6. Component pages

[← 5. LTE tests](05-lte-tests.md) · [Contents](README.md) · Next: [7. Troubleshooting →](07-troubleshooting-and-reference.md)

- [6.1 The connection bar](#61-the-connection-bar)
- [6.2 Trombone](#62-trombone)
- [6.3 Switch](#63-switch)
- [6.4 Network Analyzer](#64-network-analyzer)
- [6.5 Power Meter](#65-power-meter)
- [6.6 Signal Generator](#66-signal-generator)
- [6.7 DC Analyzer](#67-dc-analyzer)
- [6.8 Spectrum Analyzer](#68-spectrum-analyzer)

The **Components** pages each drive one instrument by hand. None of them
needs the DUT.

- **Shared connections:** each page uses the same connection as the
  Instruments panel. An instrument connected in one place shows as connected
  in the other.
- **No exports:** none of these pages exports anything. Results appear on
  screen and in the Log.

| Page | Moves hardware / changes the RF path | Emits RF / powers the DUT |
|---|---|---|
| Trombone | **Move**, the jog pad, **−8 mm / +8 mm**, **Go min/max**. Connecting energises the motor. | no |
| Switch | **Go VNA**, **Go PCB**, **Move**. The store buttons overwrite the presets. | no, but it redirects the RF path |
| Network Analyzer | — | **yes**: the stimulus runs the whole time it is connected |
| Power Meter | — | no |
| Signal Generator | — | **RF On**. **Apply** changes a live output. |
| DC Analyzer | — | **Output On** powers the DUT. **Apply** changes a live output. |
| Spectrum Analyzer | — | no (it only listens) |

---

## 6.1 The connection bar

Every Components page opens with the same connection bar.

![The Config dialog, here for the DC analyzer](img/dc-analyzer-config.png)

| Part | Shows / does |
|---|---|
| **Status chip** | **Connected**, **Connecting**, **Disconnected** or **Error**. The trombone shows **Idle** or **Moving** instead of Connected. |
| **Name and model** | e.g. *DC analyzer · Keysight N6705B* |
| **Second line** | While disconnected: the address the next Connect will use. While connected: the instrument's identity string. *Not configured — open Config* means there is nothing to connect to yet. |
| **Config** | Opens the connection settings for that instrument: address, port, channel or baud rate. They are read-only while connected. The dialog has its own **Connect** button. |
| **Connect / Disconnect** | Disabled until Config holds an address |

---

## 6.2 Trombone

*Components › Trombone.* This page moves the RF trombone (Arcus DMX-J-SA),
shows where it is, and shows how much travel is left in each direction.

![Trombone](img/trombone.png)

### Connecting

1. In **Config**, set the **Device index** (0–15; normally **0** with one
   controller on USB).
2. Press **Connect**. This **energises the motor**.

The status chip reads **Idle** or **Moving**, and is polled every 0.5 s.

### Controls

| Control | Effect |
|---|---|
| **Target** + **Move** | Absolute move, in mm (400 pulses = 1 mm; the pulse count it will send is shown under the box). The target must lie within the soft limits, or within ±1,000,000 pulses if none are set. |
| **Jog** pad (*Hold to jog*) | In the **Step** card. Press and hold **←** or **→** to run the motor; it stops when you release. You can also click the pad and hold the arrow keys. |
| **Slow** / **Medium** / **Fast** | Jog speed: 400, 800 (default) or 1500 pulses/s. It applies to the jog only. |
| **−8 mm** / **+8 mm** | One step of 8 mm (3,200 pulses, one revolution), stopping short at a soft limit |
| **Go min** / **Go max** | Move to the lower or upper soft limit. Disabled when no limits are set. |
| **Stop** (header) | Immediate stop, with no deceleration. It also cancels a jog. |

### Readouts

| Readout | Shows |
|---|---|
| **Position** | mm, with pulses underneath, and *N% of travel* when soft limits are set |
| **Room below** / **Room above** | mm left to each limit, or *no soft limit*. Load Pull's captured Zero and End are shown under the Target box when set. |

### Behaviour to know

- **Soft limits come from Load Pull.** They are set by capturing Zero and End
  on the Load Pull page; this page cannot set them. Without them, **moves
  are not limited at all.**
- **"Complete" does not mean arrived.** A move reports complete as soon as
  the controller *accepts* it. Wait for the chip to return to **Idle**.
- **Speed:** **Move**, the steps and **Go min/max** run at 5,000 pulses/s.
  Only the hold-to-jog uses the Slow / Medium / Fast speed.
- **Disconnect releases the holding torque.**
- **No devices found?** *"no Performax USB devices found"* or *"device_index
  out of range"* means: check the USB cable and the index, and check the
  driver (Code 28; see
  [1.2](01-installation-and-configuration.md#arcus-motor-driver-two-steps)).

---

## 6.3 Switch

*Components › Switch.* This page flips the RF path between the **VNA** and the
**PCB** (the DUT). It also calibrates the two preset positions, which are
stored on the Arduino.

![Switch](img/switch.png)

### Connecting

1. In **Config**, pick the **Port**. USB-serial ports are listed first, and
   the list refreshes each time you open it. Listing ports never opens them,
   so the Arduino is not reset.
2. Press **Connect**.

Connecting from this page does **not** move the switch. Connecting it from
the Instruments panel moves it to VNA.

### Everyday use

Press **Go VNA** or **Go PCB**. The **Selected** tile confirms which path is
active.

### Calibrating a preset

1. Set an angle with the box or the nudge buttons (−10, −1, +1, +10°), then
   press **Move**. Angles run 0–180°. The nudge buttons only change the
   number; nothing moves until you press **Move**.
2. Check the switch mechanically, adjust, and press **Move** again.
3. Under *Store current position as*, press **VNA** or **PCB**. This stores
   **wherever the servo is now**, not the number in the box. It overwrites
   the preset without asking.

### Behaviour to know

- **The PC cannot read the servo's position.** The **Angle** tile shows the
  last angle commanded, or the angle the Arduino reported after moving to a
  preset. Otherwise it shows *held by the servo*.
- **Switching with RF live** sends the signal to the other port.
- **"PermissionError 13"** when connecting: unplug and replug the Arduino.

---

## 6.4 Network Analyzer

*Components › Network Analyzer.* This page sets the E5061B's sweep range,
places up to 9 markers, and reads **S11** (impedance) or **S21**
(transmission) at them.

![Network Analyzer](img/network-analyzer.png)

### Connecting

1. In **Config**, pick the **VISA resource**. The page scans VISA and
   preselects the E5061B. The DC analyzer shares the USB bus and is left off
   the list.
2. Press **Connect**. The analyzer switches to continuous sweep, **so it is
   transmitting its stimulus from then on.**

### Procedure

1. If the analyzer reaches the DUT path through the RF switch, set the switch
   to **VNA** first (Switch page).
2. Enter **Start** and **Stop** in MHz (defaults 800–1000; filled in from the
   instrument on first connect), then press **Apply**. A filled **Apply**
   with *"Not applied — the instrument still has the range above."* means
   your entry differs from what the instrument has.
3. Enter markers **M1–M9** in MHz (default one marker at 915; the counter
   shows *N/9*). Optionally press the markers' **Apply** to show them on the
   instrument's screen.
4. Choose the **S11** or **S21** tab, then press **Sweep + Read S11/S21** (in
   the header) or **Read**.

### Readouts

| Readout | Shows |
|---|---|
| **Tiles** (refreshed every 5 s) | Start, Stop, **Points** (with the source power in dBm), IF bandwidth. Points, IF bandwidth and source power can only be set on the front panel. |
| **S11 table** | Mk, Freq, R (Ω), jX (Ω), **\|S11\| (dB)**, S11 real/imag (50 Ω reference) |
| **S21 table** | Mk, Freq, **\|S21\| (dB)**, Phase (°), real/imag |

### Behaviour to know

- **Reading does not start a new sweep.** It takes the last completed
  continuous sweep. **After changing the range or the cabling, wait one full
  sweep before reading.**
- **Markers read the nearest sweep point.** On a coarse sweep this can be far
  from the marker frequency: a 902.3 MHz marker on a 201-point, 3 GHz span
  reads at 900.21 MHz. Narrow the span or add points for accurate values.
- **A dead port** reads −200 dB.
- **"…not responding to a previous command"**: disconnect and reconnect.

---

## 6.5 Power Meter

*Components › Power Meter.* This page uses the Mini-Circuits sensor as a
standalone power meter, with single readings or a continuous trace and
statistics.

![Power Meter](img/power-meter.png)

### Connecting

1. **Config** has one setting, the **Serial number**. Leave it blank to use
   the first sensor found. It is only needed when more than one sensor is
   plugged in.
2. Press **Connect**. The bar shows the model, serial and firmware.

### Tabs

| Tab | Header button | Notes |
|---|---|---|
| **Read** | **Read** takes one reading | |
| **Continuous** | **Start** / **Stop** a trace | **Every**: the interval in ms, default 400, range 200–60,000. The trace pauses when you leave the page and resumes when you come back. |

**Clear** resets the trace and the statistics.

### Readouts

| Tile | Shows |
|---|---|
| **At sensor** | the raw reading. *under range - no signal* (amber) means ≤ −100 dBm: the sensor sees nothing. |
| **Correction** | the **default** path loss from the Bench tab. The per-frequency table is not used here, because this page has no frequency. |
| **Result** | at sensor + correction, in dBm and mW |
| **Min / Max / Mean** | statistics of the result, over up to 500 samples |
| **Recent** | the last 10 samples |

### Behaviour to know

- **No frequency is sent.** The sensor keeps whatever calibration frequency a
  test page last set. For accurate absolute readings, run a Send at the
  frequency you want on a TX page first.
- **Readings are stored raw.** Changing the path loss re-corrects the whole
  trace.
- **Measurement only.** Keep the input below the sensor's damage level; see
  the Mini-Circuits datasheet.

---

## 6.6 Signal Generator

*Components › Signal Generator.* This page sets the R&S SML03's frequency and
level and switches its RF output. Everything shown is **read back from the
instrument**.

![Signal Generator](img/signal-generator.png)

### Connecting

1. On the instrument, set the rate under **Utilities → System → RS232**, and
   connect it with a **null-modem** cable.
2. In **Config**, pick the **Port** (press **Scan** if it is missing) and the
   matching **Baud** (default 9600).
3. Press **Connect**. The bar shows the identity string.

Connecting changes nothing on the instrument. The port and baud rate are
remembered after a successful connect.

### Output

| Field | Unit | Range |
|---|---|---|
| **Frequency** | MHz | 0.009 – 3,300 |
| **Level** | dBm | −145 to +20 (datasheet maximum +13) |

Both fields start empty and keep what you last typed.

| Button | Effect |
|---|---|
| **Apply** | Sends the fields that are filled in. The output state is unchanged. |
| **RF On** | Sends the typed frequency and level **first**, then switches the output on, so it never comes on at old settings |
| **RF Off** | Switches the output off only |

### Status and readouts

- *not sent yet* (amber): what you typed differs from the instrument.
- *RF is live* (red): the output is on.
- **Instrument tiles** (every 2.5 s, while the page is open): Frequency,
  Level, **RF output ON/OFF**, and the instrument's own error queue.

### Behaviour to know

- **Disconnect does not switch RF off.** Press **RF Off** first.
- **Apply while RF is on** changes the live output immediately.
- **Connection errors:**
  - *"no reply … CTS and DSR are both low"*: the cable is straight-through,
    or the instrument is off. It is not a baud-rate problem.
  - *"no reply … at N baud"*: the baud rate or cable is wrong.
- **Wrong baud rate?** `scripts\sml_probe.py` tries every baud rate and
  handshake for you.

---

## 6.7 DC Analyzer

*Components › DC Analyzer.* This page drives the Keysight N6705B as the DUT's
supply and meter. It switches the output on and off, and sets the voltage and
current limit. It also shows what the analyzer measures, read back once a
second.

![DC Analyzer](img/dc-analyzer.png)

### Connecting

1. In **Config**, pick the **VISA resource**. The page scans VISA and
   preselects the N6705. The network analyzer is left off the list.
2. Choose the **Channel** (1–4, default **3**). **Every test supplies and
   measures the DUT on this channel too**, so it is the same setting the
   Instruments panel's **Ch** box holds.
3. Press **Connect**. Connecting changes nothing on the analyzer.

### Controls

| Control | Effect |
|---|---|
| **Output On** (header) | Sends the typed voltage and current limit **first**, then switches the output on, so the DUT is never powered at old settings. While on, the button reads **Output Off** (red) and only switches the output off. |
| **Voltage** (V) | The voltage **at the DUT**, 0–60 V (the module has its own lower limit and reports it as an error) |
| **Current limit** (A) | Leave blank to keep the analyzer's limit; 0–10 A |
| **Apply** | Sends the fields that are filled in. The output state is unchanged. *not sent yet* (amber) means what you typed differs from the analyzer. |

When a request changes several things, they go out in a safe order. Switching
off goes first, so a new value never reaches a DUT being powered down. The
current limit is set before the voltage. Switching on goes last.

### Readouts

| Tile | Shows |
|---|---|
| **Output** | **ON** (red) or **OFF**, with the channel and the module in it (e.g. *ch 3 · N6781A*) |
| **Set voltage** / **Current limit** | the analyzer's settings |
| **Voltage** / **Current** / **Power** | measured at the terminals: V, mA, mW |

The analyzer's own error queue is shown in red under the tiles. The one
harmless warning an N6781A queues after a limit change (315 "Settings
conflict") is left out.

### Behaviour to know

- **The sidebar's DC supply key controls the same output.** The **DC
  supply** key in the sidebar footer (see
  [3.1](03-using-the-console.md#31-screen-layout)) works on the same
  channel. This page reads back whatever either of them set.
- **Voltage scaling:** this rig's hardware doubles the programmed voltage, so
  the app halves the setpoint on its way out and doubles it on its way back.
  The figure on screen is the voltage at the DUT. The measured voltage is
  read straight from the terminals.
- **Meter auto-ranging** is not on this page. The analyzer's front-panel
  *Properties → Meter Ranges* **Auto** checkbox belongs to the front panel's
  own measurement system (in the default "N6705 mode"), and USB cannot reach
  it.
- **Tests keep working while this page is open.** Its once-a-second poll only
  runs while the page is on screen. Commands wait their turn behind a poll
  instead of failing.

---

## 6.8 Spectrum Analyzer

*Components › Spectrum Analyzer.* This page is a live control panel for the
Rohde & Schwarz **FSC3** handheld analyzer over LAN. It covers frequency,
amplitude, trace mode, detector, bandwidths and up to six markers, and it
shows the analyzer's live trace.

![Spectrum Analyzer, example data](img/spectrum.png)

*Example data.*

### Connecting

1. Connect the analyzer's **LAN** port to the PC. Plugged in directly, the
   analyzer is `172.16.10.1` and gives the PC `172.16.10.2`.
2. In **Config**, check the **Address** (`host:port`). The default is
   `172.16.10.1:5555`; R&S handhelds use SCPI port **5555**, not 5025.
3. Press **Connect**. The bar shows the analyzer's identity string.

![Spectrum Analyzer connection settings](img/spectrum-config.png)

> **Use LAN, not USB.** The FSC3's USB port cannot be used without the R&S
> driver that ships with R&S InstrumentView. Windows binds a generic serial
> driver to it that cannot open the port.

### Layout

**Settings on the left, screen on the right.** The settings column scrolls on
its own, so the trace stays in view while you change something. The right
column never scrolls: the screen fills whatever the marker table leaves.

- **Screen:** the trace, drawn against frequency (MHz), or against time (ms)
  in zero span. Markers show as dashed lines labelled with their level. The
  header summarises what the analyzer is showing, e.g. *906.2 MHz – 911.2 MHz
  · max peak · RBW 100 kHz*, next to the refresh rate.
- **Divider:** drag the handle between the screen and the marker table to
  resize the table. Double-click it to reset. The size is remembered.
- **Marker table:** each active marker's frequency (or time) and level, with
  an **Off** button per row. Click a row to select that marker. **Hide
  table** folds the panel to one slim row.

### Reading the trace

| Header button | Effect |
|---|---|
| **Peak search** | Moves the selected marker to the highest point (switching on M1 first if no marker is on) |
| **Sweep once** | Runs one sweep and shows it. This leaves the analyzer in single-sweep mode. |
| **Go live** / **Stop** | Reads the trace repeatedly at the refresh rate (0.3–5 s, default 1 s). Going live puts the analyzer back into continuous sweep. |

**Live mode only reads the trace.** It never arms a sweep, so the analyzer
keeps sweeping on its own and max hold and averaging keep working. Every read
still costs the analyzer some sweep time. At 0.3 s its own screen visibly
slows.

**After a disconnect, the last capture stays on screen.** The header then
reads *last capture · …*. The settings fields go blank, because nobody can
change or confirm them. A browser reload clears the capture.

### Settings

Each value is sent when you press **Enter** or leave the field. The field then
shows what the analyzer reports back. **Esc** abandons an edit.

| Section | Controls |
|---|---|
| **Frequency** | **Center**, **Span**, **Start**, **Stop** (MHz); **Full span**, **Zero span** |
| **Amplitude** | **Ref level** (dBm), **Ref offset** (dB), **Attenuation** (dB); **Display range** is read-only |
| **Trace** | **Mode**: Clear write, Max hold, Min hold, Average, View. **Detector**: Auto peak, Max peak, Min peak, Sample, RMS. The analyzer's current choice is shown filled. |
| **Sweep & bandwidth** | **RBW**, **VBW** (kHz) and **Sweep time** (ms), each with an **Auto** button; **Sweep**: Continuous or Single |
| **Markers** | **Active**: 1–6 markers, with **All off**. **Selected** marker, **Place M*n*** at a frequency (or time in zero span), **Next peak**, **Min**, **Mkr → center** (moves the center frequency to the marker) and **M*n* off**. |

Any command the analyzer rejects is shown under the screen, as the analyzer
worded it, and written to the Log.

### Behaviour to know

- **Settings stay as you leave them.** Disconnecting does not put the analyzer
  back the way it was found. It leaves it sweeping continuously with your
  settings.
- **Markers are numbered from M1 without gaps.** The FSC3 refuses to switch on
  M2 while M1 is off. So switching off a marker in the middle renumbers the
  ones above it, at their old positions: with M1–M3 on, **M2 off** turns M3
  into M2.
- **The reference level follows the offset.** Changing the offset moves the
  reference level by the same amount (offset 20 → 30 dB moves the level from
  −20 to −10 dBm), which is why the level is read back after every change.
- **Display range is read-only.** The FSC3 accepts a new range and ignores it
  (it always reads back 100 dB).
- **Sweep time and zero span:** a fixed sweep time only takes effect in zero
  span, and **Auto** sweep time is refused there. Its **Auto** button is
  disabled in zero span.
- **Detectors:** the FSC3 has no average or quasi-peak detector. **Max peak**
  is its positive-peak detector.
