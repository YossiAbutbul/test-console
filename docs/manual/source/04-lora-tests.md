# 4. LoRa tests

[← 3. Using the console](03-using-the-console.md) · [Contents](README.md) · Next: [5. LTE tests →](05-lte-tests.md)

- [4.1 Before any LoRa TX test](#41-before-any-lora-tx-test)
- [4.2 CW](#42-cw)
- [4.3 Modulated](#43-modulated)
- [4.4 Debug](#44-debug)
- [4.5 Mode Sweep](#45-mode-sweep)
- [4.6 Load Pull Test](#46-load-pull-test)

---

## 4.1 Before any LoRa TX test

1. **Cable the rig** as in [setup A](02-hardware-and-connections.md#a-lora--lte-tx-tests-cw-modulated-debug-mode-sweep).
2. **Power the DUT.** Connect the DC analyzer and switch on its supply in
   **Settings** (3.6 V by default).
3. **Connect the DUT** over BLE ([3.2](03-using-the-console.md#32-connecting-the-dut)).
4. **Enter the path loss** for the frequencies you will use
   ([3.4](03-using-the-console.md#34-path-loss)).
5. **Optionally connect the instruments** in advance. Otherwise the preflight
   connects them when you press Send or Run.

### Rules that apply to every LoRa TX page

- **Power** is a whole number of dBm, 0–255. The backend refuses negative or
  fractional values (HTTP 422).
- **Frequency** is entered in MHz and sent as whole Hz. The app does not check
  it against any band.
- **PA Mode** is one of **Off** (0), **On** (1) or **Auto** (2).
- **Settle** is how long the PA stays keyed before the reading. The minimum
  and default are **400 ms**. Below that, the sensor's averaged reading still
  holds energy from the previous point, so a low-power point reads high while
  its current reads correctly. That looks like a measurement fault, but it is
  a timing one.
- **A manual Send keeps the DUT transmitting until you press Stop.**
- **Automation stops the DUT after every point,** even when the point
  failed. The backend then enforces a 1.5 s recovery pause, so allow about
  2 s per point on top of Settle. The on-screen estimate (≈) does not include
  this pause.

### Automation panels (CW and Modulated)

The CW and Modulated pages share the same automation panel.

- **Range syntax** for Freq and Power:

  | Entry | Means |
  |---|---|
  | `915` | one value |
  | `900-930` | 900 to 930 in steps of 1 |
  | `900-930:5` | 900 to 930 in steps of 5 |
  | `902.3,915,927.5` | a list (spaces work too) |

- **Tolerance:** the pass band in ± dB around the *set* power. Leave it blank
  for no verdict (**N/A**). A negative tolerance blocks **Run**.
- **Verdict:** **PASS** when *set − tol ≤ measured ≤ set + tol*. The measured
  figure includes path loss.
- **Plan order:** each row expands to every frequency × every power, in row
  order.
- **Invalid rows:** a row with an invalid or blank Freq simply adds no points.
  Check each row's *N steps* count.
- **Time limit:** each point is limited to Settle + 30 s. A point that times
  out is recorded with its error, and the run carries on.
- **Stop:** ends the run at once, sends StopTest, and discards the point that
  was interrupted.
- **Results:** kept across navigation and reload. **Import** replaces the
  table with a previously exported CSV; it does not merge. **Graph** plots the
  results. **Export** writes a CSV.
- **CSV file name:** `<MAC without colons>-<UTC timestamp>.csv`, or
  `tx-cw-automation-<ts>.csv` / `lora-modulated-automation-<ts>.csv` when no
  MAC is known.
  > The name does not say which page produced the file. Rename your exports.

---

## 4.2 CW

*LoRa › TX › CW.* This page keys an unmodulated LoRa carrier at the frequency,
power and PA mode you set, then reads the RF power and the DUT's current.

### Manual tab

![LoRa CW, Manual](img/lora-cw-manual.png)

| Field | Unit | Default | Notes |
|---|---|---|---|
| **Frequency** | MHz | 902.3 | step 0.1 |
| **Power** | dBm | 14 | whole number, 0–255 |
| **PA Mode** | — | Auto | Auto / On / Off |
| **Measure power** | ☑ | on | read the power sensor after sending |
| **Measure CC** | ☑ | on | read the DC analyzer after sending |

The Measure boxes are saved, because they describe how the bench is set up.
With both unticked, **Send** only transmits: no instrument is connected or
read, and the measurement card is hidden.

**Procedure**

1. Set **Frequency**, **Power** and **PA Mode**, and tick what to measure.
2. Press **Send**. The page then:
   - runs the preflight, if anything is ticked;
   - sends `LoRa Power` (`17 50`);
   - reads the card 400 ms later.
3. Read the card: **Target**, **Measured**, **Error** (±1 dB) and **Current**.
   Press **Read** to measure again.
4. Press **Stop** to send StopTest. **Until you do, the DUT keeps
   transmitting.**

Instruments are connected *before* transmitting on purpose. A VISA connect
takes long enough that the DUT would otherwise transmit with nobody reading.

### Automation tab

![LoRa CW, Automation](img/lora-cw-automation.png)

| Column | Default | Notes |
|---|---|---|
| **Freq** (MHz) | rows 902.3, 915.0, 927.5 | range syntax |
| **Power** (dBm) | 14 | range syntax; blank means 14 |
| **PA Mode** | Auto | Off / On / Auto |
| **Tolerance** (± dB) | 1 | blank means N/A |
| **Settle** (panel header) | 400 ms | minimum 400; saved |

**Procedure**

1. Edit the rows. **Add** copies the last row with an empty Freq.
2. Check the point count and the ≈ run time. A Settle of 10,000 ms or more is
   flagged ⚠ as a likely typo.
3. Press **Run**. The preflight connects the power sensor and DC analyzer,
   then the results table clears.
4. For each point the page:
   1. sends `LoRa Power`;
   2. waits Settle;
   3. reads power and current;
   4. adds the path loss for that frequency;
   5. judges the point;
   6. sends StopTest.
5. At the end, a completion dialog appears and the log reports *P/T points
   within limits*, with a warning for any uncalibrated frequencies.

![Automation results, example data](img/lora-cw-results.png)

*Example data.*

| Result column | Meaning |
|---|---|
| **#** | point number |
| **Freq (MHz)** | frequency |
| **Set (dBm)** | requested power |
| **PA** | PA mode |
| **Measured (dBm)** | sensor reading + path loss |
| **CC (mA)** | supply current |
| **Verdict** | **PASS** / **FAIL** / grey **N/A** |
| **Status** | `ok` or the error text |

### Results graph

**Graph** opens a chart. The X axis is whichever of frequency or set power has
more distinct values, with one line per value of the other.

- **Tabs:** **Measured vs Set/Freq** and **Current vs Set/Freq**.
- **Legend:** click an entry to hide that line.
- **⚙ options:** Y min/max, line width, dot size, grid, legend, point labels,
  connect gaps. These options are not saved.
- **Download:** saves a PNG at twice the on-screen size.

![Results graph, example data](img/lora-cw-graph.png)

*Example data.*

### CSV export columns

`freq_mhz, set_power_dbm, pa_mode, measured_dbm, current_ma, path_loss_db,
margin_db, min_dbm, max_dbm, verdict, ok, status, error`

- Timestamps are UTC.
- **Import** needs at least `freq_mhz`, `set_power_dbm` and `measured_dbm`.
- A verdict already in the file is kept as recorded; it is only recalculated
  when blank.

---

## 4.3 Modulated

*LoRa › TX › Modulated.* This page transmits **LoRa** (bandwidth and spreading
factor) or **FSK** (bit rate) modulation, and measures power and current.
**The power sensor and DC analyzer are always used on this page**; there are
no Measure boxes.

### Manual tab

![LoRa Modulated, Manual](img/lora-modulated-manual.png)

| Field | Default | Options / range |
|---|---|---|
| **Frequency** (MHz) | 902.3 | |
| **Modem** | LoRa | **LoRa** (1) / **FSK** (0) |
| **Power** (dBm) | 14 | 0–255, whole numbers |
| **Bandwidth** | 0 - 125 kHz | 125 / 250 / 500 kHz (*3 - Reserved* is disabled). Disabled and sent as 0 for FSK. |
| **Datarate** | 7 | SF 6–12 for LoRa |

**Procedure:** set the fields, press **Send** (preflight, `LoRa Modulated`
`19 50`, then an automatic read), check the card, and press **Stop**.

> **Use the Automation tab for FSK.** The manual Datarate spinner is limited
> to 6–12, which is fine for a spreading factor but useless as an FSK bit
> rate.

### Automation tab

![LoRa Modulated, Automation](img/lora-modulated-automation.png)

| Column | Default | Range |
|---|---|---|
| **Freq**, **Power** | as CW | range syntax |
| **Modem** | LoRa | LoRa / FSK. Switching modem resets an invalid datarate to 7 (LoRa) or 50000 (FSK). |
| **Bandwidth** | 125 kHz | 125 / 250 / 500 kHz. Ignored for FSK, which always sends 0. |
| **Datarate** | 7 | LoRa: SF 6–12. FSK: 1–300,000 bit/s. An invalid value blocks Run. |
| **Tolerance** | 1 | ± dB; blank means N/A |

**Results columns:** #, Freq, Set, Modem, BW (`—` for FSK), DR, Measured, CC,
Verdict, Status.

**CSV columns:** `freq_mhz, set_power_dbm, modem, bandwidth_khz, datarate,
measured_dbm, current_ma, path_loss_db, margin_db, min_dbm, max_dbm, verdict,
ok, status, error`

> The graph plots only frequency and set power. Rows that differ only in
> modem, bandwidth or datarate overwrite one another on it. Use the table for
> those comparisons.

---

## 4.4 Debug

*LoRa › TX › Debug.* A low-level CW transmit (`CW Debug`, `28 50`) that also
sets the radio's **PA duty cycle** and **HP max** registers directly. It has no
automation and no export. The power sensor and DC analyzer are used.

![LoRa Debug](img/lora-debug.png)

| Field | Default | Range |
|---|---|---|
| **Frequency** (MHz) | 902.3 | |
| **Power** (dBm) | 14 | 0–255 |
| **PA Duty Cycle** | 1 | **1–7** |
| **HP Max** | 7 | **1–7** |
| **PA Mode** | **Off** | Auto / On / Off |

**Send** stays disabled until PA Duty Cycle and HP Max are both within 1–7.
**0 hangs the DUT** rather than being refused, and this check on the page is
the only protection against it. Nothing on this page is saved.

> **PA Mode defaults to Off here, but to Auto on the CW page.** Check it
> before comparing results from the two pages.

---

## 4.5 Mode Sweep

*LoRa › TX › Mode Sweep.* This test measures the PA across **every combination
of Power × PA Duty Cycle × HP Max** at one frequency. Its purpose is to find,
for each output power the DUT actually reaches, **the combination that draws
the least current**.

The loop runs on the backend, so it survives a page reload, and only one sweep
can run at a time.

**Requires:** a connected DUT, the power sensor, and the DC analyzer.

![Mode Sweep](img/mode-sweep.png)

### Sweep ranges

| Axis | Range | Default |
|---|---|---|
| **Power** | 1–22 dBm | 1–22 (22 steps) |
| **PA Duty Cycle** | 1–4 | 1–4 (4 steps) |
| **HP Max** | 1–7 | 1–7 (7 steps) |

- **Steps:** every integer in each span is swept. The default plan is
  22 × 4 × 7 = **616 steps**. The live step count is shown in the panel
  header.
- **Order:** HP Max is the outer loop, then PA DC, then Power (the inner
  loop).
- **No zero:** **0 is never allowed** on any axis, because it hangs the DUT.
- **Advanced:** sweeps several ranges one after another.
  - Each range appears as a card. Click a card to edit it; **Add range** adds
    another.
  - Overlapping ranges are measured twice.
  - Turning Advanced off discards the list.

### Common settings

| Field | Default | Limits |
|---|---|---|
| **Frequency** (MHz) | 902.3 | |
| **Settle** (ms) | 400 | 400–10,000; raised to 400 when you leave the field |
| **PA Mode** | Off | Off / On / Auto |

The path loss at this frequency is sent with the sweep and applied by the
backend. None of these settings are saved.

### Running

1. Set the ranges and common settings, and check the step count.
2. Press **Run sweep**. The button then reads **Running N/total**, and a
   progress bar runs along the top.
3. At each step the backend:
   1. sends `CW Debug` with that combination;
   2. waits Settle;
   3. reads power (up to 5 retries while it is ≤ −100 dBm);
   4. reads current, and voltage if available.

   It does **not** send StopTest between points. The DUT accepts a new CW
   command while transmitting, and a stop would add 1.5 s to every point
   (about 16 minutes over 616 points).
4. **Last measured row** shows the latest point. The table fills in as the
   run goes.
5. **Stop** ends the run after the current point. The DUT is always sent
   StopTest at the end, however the run ends.

A failed step is recorded with its reason in **Status**, and the run carries
on. For example, *DUT rejected the command (status=N)*.

> **No pass/fail on this page.** Most points land short of their commanded
> power, and that gap is the thing being measured.

### Results

| Column | Meaning |
|---|---|
| **#** | step number (the same in the workbook) |
| **Power Set (dBm)**, **PA DC**, **HP Max** | the combination |
| **Measured (dBm)** | reading + path loss |
| **CC (mA)**, **V (V)** | current and voltage |
| **Status** | `ok` or the error |

**Graph** opens **Best settings**:

- **Filtering:** rows with no reading, or below −50 dBm, are dropped.
- **Grouping:** the remaining rows are grouped by measured power, rounded to
  the nearest dBm.
- **Ranking:** within each level, rows are ranked by current, lowest first.
  A missing current counts as the worst, not the best.
- **Winner:** the lowest-current row in each level, marked with a trophy.
- **The chart** plots *lowest current per power reached*. Click it to jump to
  a level.

**Export** saves `pa_modes_YYYYMMDD_HHMMSS.xlsx`, which has these sheets:

- **All:** every row. It adds **Raw [dBm]** (the uncorrected reading), and
  writes PA DC and HP Max in hex, e.g. `0x02`.
- **Run:** the settings the sweep ran with.
- **"N dBm":** one sheet per rounded power level, sorted by closeness to N.

**Import** opens a workbook exported by this app, for viewing only. While an
imported file is shown, **Clear** and **Export** are disabled.

> **Where results are kept.** They are held in backend memory until **Clear**,
> the next run, or a backend restart. **Export before restarting the
> backend.**

---

## 4.6 Load Pull Test

*LoRa › Other › Load Pull Test.* This test measures how the PA performs as the
**load impedance** it drives changes. At each trombone position it records:

- the load (R + jX, S11), read by the VNA;
- output power;
- supply current;
- efficiency, calculated from the power and current.

The results are plotted on a Smith chart.

**Requires:** the DUT, the power sensor, the DC analyzer, the VNA, the RF
switch and the trombone, cabled as in
[setup B](02-hardware-and-connections.md#b-load-pull).

> ⚠ **This page moves the trombone and flips the RF switch.** The round red
> **Emergency stop** in the header is always enabled, even when no run is in
> progress, for example during a jog. It halts the motor first, then aborts
> the run and turns off the DUT's transmitter.

![Load Pull Test](img/load-pull.png)

**Header tiles:** **Live position** (mm and pulses), **Zero**, **End**, and
**Plan** (the number of points).

**Before running:** the **Run** button stays disabled until every
precondition is met. A **Before running** notice lists whatever is still
missing.

### Step 1 · Instruments

This step shows whether each instrument is ready: Power sensor, DC analyzer,
VNA, Switch, Trombone, and BLE DUT. Connect the instruments from the
Instruments panel, and the DUT from the connection row.

### Step 2 · RF path

1. Press **View setup** and compare the bench with the diagram.
2. Press **Confirm path**.

The confirmation is **never saved**. Cabling is the one thing the app cannot
check, so you confirm it again each session.

The path-loss chip turns amber if any planned frequency is uncalibrated.

### Step 3 · Test point

| Field | Default | Notes |
|---|---|---|
| **Frequency** (MHz) | 902.3 | range syntax, e.g. `900-930:5` |
| **DUT Power** (dBm) | 14 | range syntax |
| **PA Mode** | Auto | |
| **Settle** (ms) | 400 | minimum 400 |
| **Attenuator** | Off | **Sweep** pauses at each setting and asks you to dial it in |
| **Att max** (dB) | 20 | 0–20, in 1 dB steps from 0 |

The page shows the plan size as *positions × freqs × powers [× att]*. The
numbers multiply quickly, so check the total.

### Step 4 · Trombone calibration

At 400 pulses/mm, one full circle on the Smith chart is a fixed length of
travel. You find that length by jogging and watching the VNA.

1. Press **VNA** (RF path) to put the analyzer on the trombone path.
2. Choose a **Speed**: Slow 400, Medium 800 (default), or Fast 1500
   pulses/s.
3. **Jog:** press and hold ← or → while watching the Smith chart on the VNA.
   - You can also click the jog pad and hold the arrow keys.
   - The motor stops as soon as you release, move the pointer off the button,
     or the pad loses focus.
4. At the start of the cycle, press **Capture** on **Zero**. Jog to the end of
   one full cycle and press **Capture** on **End**.
   - **The soft limits now apply:** no move or jog can leave the Zero–End
     range.
   - Before both ends are captured, **there are no limits at all**.
5. Set **Delta X** (mm between points; default 1). The page shows *N points
   over L mm*.
6. **Go to › Zero / End** moves to a captured end at full speed (5000
   pulses/s, about 12.5 mm/s). Use it to check both ends.

To go beyond the range, clear Zero or End first (bin icon). This also lifts
the limits.

### Step 5 · Run

Press **Run**. The results table clears. **Export first if you need the old
data.**

For each trombone position:

1. The trombone moves to the position and settles.
2. The switch goes to **VNA**. After Settle, the VNA markers are read for
   every planned frequency, giving R, X and |S11|.
3. The switch goes to **PCB**. After Settle, for each frequency × power:
   1. the DUT keys a CW carrier;
   2. after Settle, power and current are read (power corrected by that
      frequency's path loss);
   3. the DUT is stopped.

The slow mechanical moves happen once per position. Frequency and power
change electronically, which costs almost nothing.

With **Attenuator: Sweep**, each cycle starts with the dialog **Set the
attenuator**:

- It shows the value to dial in, e.g. *"N dB"*.
- The switch is parked on VNA so you can watch the change take effect.
- The dialog cannot be dismissed by accident, and it waits as long as you
  need.
- **Attenuator is set** continues the run; the trombone returns to the start
  first. **Stop run** aborts it.

**Time limits and failures**

- Each point is limited to 3 × Settle + 90 s, and each motor move to 60 s.
- A point that fails is recorded with its error, and the run moves on.
- **Stop** discards the point in progress, so there are no half-measured
  rows.

![Load Pull results, example data](img/load-pull-results.png)

*Example data.*

**Result columns:** #, Pos (mm), Freq, Set, Att, **Power (dBm)**, CC (mA),
R (Ω), J (Ω), S11 (dB), VSWR, Status.

**Power confidence:** the Power cell is coloured by where the **raw** sensor
reading sat in the sensor's range:

| Raw reading | Rating |
|---|---|
| between −20 and +10 dBm | normal |
| +10 to +16 dBm, or −20 to −25 dBm | **amber** (marginal) |
| ≥ +16 dBm, or ≤ −25 dBm | **red** (poor) |

The raw reading is used because the path-loss correction shifts the number by
tens of dB without changing where the sensor actually was in its range.

### Smith chart

**Smith chart** plots the points with Z₀ = 50 Ω, coloured by efficiency
(blue = low, red = high):

```
eff = P_out[W] / (3.6 V × I_cc[A])
```

- **Fixed voltage:** the 3.6 V is a constant, not the measured voltage.
- **Pickers:** when there are several frequencies or powers, Freq and Power
  pickers choose which one to show. Attenuator settings are always shown
  together, one line each.
- **Details:** hover a point for its full measurement.
- **Copy chart:** puts a PNG on the clipboard.

![Smith chart, example data](img/load-pull-smith.png)

*Example data.*

### Export and import

**Export** saves `load_pull_YYYYMMDD_HHMMSS.xlsx` (there is no CSV export),
with these sheets:

- **All:** every point. It adds Pos [pulses] and Raw [dBm].
- **Run:** the settings, Zero/End, Delta X, the path loss at each frequency
  (marked *(uncalibrated)* where the default was used), and the DUT's MAC.
- **One sheet per frequency:** a table for each power, sorted by attenuation.

**Import** accepts either:

- an exported `.xlsx` (only its **All** sheet is read); or
- an older `.csv`, with optional `# key=value` header lines and at least the
  columns `pos_mm, pos_pulses, power_dbm, cc_ma, r_ohm, x_ohm, s11_db`.

Settings stored in the file are reported, never applied, so an import cannot
change what the next Run does.

> **Safety recap**
>
> - Capture both ends before any automated movement.
> - Recapture both ends after the motor or the backend restarts.
> - Soft limits are held in backend memory only.
