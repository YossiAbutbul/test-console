# 6. Component pages

[← 5. LTE tests](05-lte-tests.md) · [Contents](README.md) · Next: [7. Troubleshooting →](07-troubleshooting-and-reference.md)

- [6.1 Trombone](#61-trombone)
- [6.2 Switch](#62-switch)
- [6.3 Network Analyzer](#63-network-analyzer)
- [6.4 Power Meter](#64-power-meter)
- [6.5 Signal Generator](#65-signal-generator)

The **Components** pages drive one instrument each, by hand. None of them
needs the DUT.

- **Shared connections:** connection state is shared with the Instruments
  panel. An instrument connected in one place shows as connected in the
  other.
- **No exports:** none of these pages exports anything. Results appear on
  screen and in the Log.

| Page | Moves hardware / changes the RF path | Emits RF |
|---|---|---|
| Trombone | **Move**, **Step up/down**, **Go min/max**. Connecting energises the motor. | no |
| Switch | **Go VNA**, **Go PCB**, **Move**. The store buttons overwrite the presets. | no, but it redirects the RF path |
| Network Analyzer | — | **yes**: the stimulus runs the whole time it is connected |
| Power Meter | — | no |
| Signal Generator | — | **RF On**. **Apply** changes a live output. |

---

## 6.1 Trombone

*Components › Trombone.* This page moves the RF trombone (Arcus DMX-J-SA),
shows where it is, and shows how much travel is left in each direction.

![Trombone](img/trombone.png)

### Connecting

While disconnected, enter the **Index** (0–15, normally **0**) and press
**Connect**. You can also connect from the Instruments panel.

The status chip reads **Disconnected**, **Idle** or **Moving**. It is polled
every 0.5 s while connected.

### Controls

| Control | Effect |
|---|---|
| **Target** + **Move** | Absolute move, in pulses (3,200 pulses = 1 revolution; 400 pulses = 1 mm). The target must lie within the soft limits, or within ±1,000,000 if none are set. |
| **Step down** / **Step up** | ±3,200 pulses (one revolution), stopping short at a soft limit |
| **Go min** / **Go max** | Move to the lower or upper soft limit. Disabled when no limits are set. |
| **Stop** (header) | Immediate stop, with no deceleration. It also cancels a jog. |

### Readouts

| Readout | Shows |
|---|---|
| **Position** | pulses, with *N% of travel* |
| **Room below** / **Room above** | pulses left to each limit, or *no soft limit* |
| **Travel bar** | shown only when limits exist; turns orange while the motor is moving |

### Behaviour to know

- **Soft limits are set on the Load Pull page,** by capturing Zero and End.
  This page cannot set them. Without them, **moves are not limited at all.**
- **"Complete" does not mean arrived.** A move reports complete as soon as
  the controller *accepts* it. Wait for the chip to return to **Idle**.
- **Speed is fixed** at 5,000 pulses/s here. Reduced-speed jogging is only
  available on Load Pull.
- **Disconnect releases the holding torque.**
- **No devices found?** *"no Performax USB devices found"* or *"device_index
  out of range"* means: check the USB cable and the Index, and check the
  driver (Code 28; see
  [1.2](01-installation-and-configuration.md#arcus-motor-driver-two-steps)).

---

## 6.2 Switch

*Components › Switch.* This page flips the RF path between the **VNA** and the
**PCB** (the DUT). It also calibrates the two preset positions, which are
stored on the Arduino.

![Switch](img/switch.png)

### Connecting

While disconnected, pick the **Port**. USB-serial ports are listed first, and
the list refreshes each time you open it. Then press **Connect**. The header
shows *Arduino · 9600 8N1*.

### Everyday use

Press **Go VNA** or **Go PCB**. The **Selected** tile confirms which path is
active.

### Calibrating a preset

1. Set an angle with the box or the nudge buttons (−10, −1, +1, +10°), then
   press **Move**. Angles run 0–180°. The nudge buttons only change the
   number; nothing moves until you press **Move**.
2. Check the switch mechanically, adjust, and press **Move** again.
3. Under *Store current position as*, press **VNA** or **PCB**. This stores
   **wherever the servo is now**, not the number in the box, and it
   overwrites the preset without asking.

### Behaviour to know

- **The PC cannot read the servo's position.** The **Angle** tile shows the
  last angle commanded, or the angle the Arduino reported after moving to a
  preset. Otherwise it shows *held by the servo*.
- **Switching with RF live** sends the signal to the other port.
- **"PermissionError 13"** when connecting: unplug and replug the Arduino.

---

## 6.3 Network Analyzer

*Components › Network Analyzer.* This page sets the E5061B's sweep range,
places up to 9 markers, and reads **S11** (impedance) or **S21**
(transmission) at them.

![Network Analyzer](img/network-analyzer.png)

### Connecting

Pick the **VISA resource** (the page runs a VISA scan) and press **Connect**.
The chip reads **Online**. Connecting switches the analyzer to continuous
sweep, **so it is transmitting its stimulus from then on.**

### Procedure

1. If the analyzer reaches the DUT path through the RF switch, set the switch
   to **VNA** first (Switch page).
2. Enter **Start** and **Stop** in MHz (defaults 800–1000; filled in from the
   instrument on first connect), then press **Apply**.
   - A filled **Apply** button, with the note *"Not applied — the instrument
     still has the range above."*, means your entry differs from what the
     instrument has.
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
- **Markers read the nearest sweep point.** On a coarse sweep this can be
  far from the marker frequency: a 902.3 MHz marker on a 201-point, 3 GHz
  span reads at 900.21 MHz. Narrow the span or add points for accurate marker
  values.
- **A dead port** reads −200 dB.
- **"…not responding to a previous command"**: disconnect and reconnect.

---

## 6.4 Power Meter

*Components › Power Meter.* This page uses the Mini-Circuits sensor as a
standalone power meter, with single readings or a continuous trace and
statistics.

![Power Meter](img/power-meter.png)

### Connecting

Press **Connect**. The first sensor found is used. To pick a specific serial,
set it in the Instruments panel. The chip shows the model, serial and
firmware.

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
| **Correction** | the **default** path loss from the connection row. The per-frequency table is not used here, because this page has no frequency. |
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

## 6.5 Signal Generator

*Components › Signal Generator.* This page sets the R&S SML03's frequency and
level and switches its RF output. Everything shown is **read back from the
instrument**.

![Signal Generator](img/signal-generator.png)

### Connecting

1. On the instrument, set the rate under **Utilities → System → RS232**, and
   connect it with a **null-modem** cable.
2. Pick the **Port** (press **Scan** if it is missing) and the matching
   **Baud** (default 9600), then press **Connect**. The chip shows the IDN.

Connecting changes nothing on the instrument.

### Output

| Field | Unit | Range |
|---|---|---|
| **Frequency** | MHz | 0.009 – 3,300 |
| **Level** | dBm | −145 to +20 (datasheet maximum +13) |

Both fields are empty by default and keep what you last typed.

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
