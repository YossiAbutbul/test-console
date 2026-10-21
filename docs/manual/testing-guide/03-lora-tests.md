# 3. LoRa tests

Before any LoRa test: the bench is cabled (1.1), the DUT is powered and
connected (1.3, 1.4), and the path loss is entered for your frequencies (1.5).

## 3.1 CW — one setting

*LoRa › CW, Manual tab.* Transmits a plain carrier and reads the power
and current.

![LoRa CW, Manual](img/lora-cw-manual.png)

1. Set **Frequency** (MHz), **Power** (dBm, whole numbers) and **PA mode**
   (Auto, On or Off).
2. Tick **Measure power** and **Measure CC** for the readings you want. With
   both unticked, Send only transmits.
3. Press **Send**. The card fills in a moment later.
4. Check **Measured**, **Error** and **Current**. Press **Read** to measure
   again.
5. Press **Stop**. **The DUT keeps transmitting until you do.**

## 3.2 CW — a list of settings with pass/fail

*LoRa › CW, Automation tab.*

![LoRa CW, Automation](img/lora-cw-automation.png)

1. Fill in the rows: **Freq**, **Power**, **PA mode** and **Tolerance**. Use
   the list format from 2.4. **Add** adds a row.
2. Set **Settle** in the panel header (400 ms is normal).
3. Check the number of points and the time estimate.
4. Press **Run**. The table clears and fills in point by point. The DUT is
   stopped after every point.
5. When the box appears, check the **Verdict** column.

![Results, example data](img/lora-cw-results.png)

| Column | Meaning |
|---|---|
| **Freq**, **Set**, **PA** | The setting tested |
| **Measured** | The power at the DUT |
| **Δ** | Measured minus Set |
| **CC [mA]** | The supply current |
| **Verdict** | PASS, FAIL or N/A |
| **Status** | `ok`, or why the point could not be measured |

To look at the results as a chart, press **Graph** (see 5.1). To save them,
press **Export** (see 5.2). To see only the failed points, press the
**fail** count above the table (see 2.7).

## 3.3 Modulated

*LoRa › Modulated.* Transmits LoRa or FSK modulation. Power and current
are always measured.

![LoRa Modulated, Manual](img/lora-modulated-manual.png)

**Manual:** set **Frequency**, **Modem** (LoRa or FSK), **Power**,
**Bandwidth** and **Datarate** (the spreading factor, 6–12, for LoRa). Press
**Send**, check the card, press **Stop**.

> **For FSK, use the Automation tab.** The Manual tab's datarate box only goes
> up to 12, which is too low for an FSK bit rate.

**Automation:** the same as CW automation, with **Modem**, **Bandwidth** and
**Datarate** columns. For FSK the datarate is the bit rate (up to 300,000).

![LoRa Modulated, Automation](img/lora-modulated-automation.png)

## 3.4 Debug

*LoRa › Debug.* A carrier where you also set the **PA duty cycle** and
**HP max** directly. There is no automation and nothing is saved.

![LoRa Debug](img/lora-debug.png)

- **PA duty cycle** and **HP max** must each be **1 to 7**. **Send** stays
  disabled otherwise, because 0 makes the DUT stop responding.
- **PA mode starts at Off here, but at Auto on the CW page.** Check it before
  comparing the two pages.
- **Measure power** and **Measure CC** work as on the CW page, but start
  ticked every time the page opens.

## 3.5 Mode Sweep — the best setting for each power

*LoRa › Mode Sweep.* Tries **every combination** of Power, PA Duty Cycle
and HP Max at one frequency, then shows, for each power the DUT actually
reaches, **the combination that draws the least current**.

Needs the DUT, the power sensor and the DC analyzer.

![Mode Sweep](img/mode-sweep.png)

1. Set the ranges: **Power** 1–22 dBm, **PA duty cycle** 1–4, **HP max** 1–7.
   The default plan is 616 steps; the header shows the count and the time it
   will take.
2. Set **Frequency**, **Settle** and **PA Mode**.
3. Press **Run sweep**. The progress bar, the time left and **Last measured
   row** show how it is going.
4. **Stop** ends the run after the current point.

There is no pass/fail on this page: most points fall short of the power asked
for, and that gap is what the test measures.

**Reading the result:** press **Graph** to open **Best settings**. Each line
is one power level the DUT reached, with the combination that held it for
the least current (marked with a trophy). Click the chart to jump to a
level.

> **Export after every sweep.** The results are kept only until the next run
> or until the console is restarted.

Your ranges and settings are remembered, so the next sweep starts from them.

## 3.6 Load Pull

*LoRa › Load Pull Test.* Measures how the DUT's power, current and
efficiency change as the **load** it drives changes. The results are drawn on
a Smith chart.

> ⚠ **This page moves the trombone and switches the RF path.** Keep hands
> clear of the trombone. The red **E-Stop** key in the header always works.

### The bench

![Load Pull bench](img/diagram-2.png)

- With the switch on **VNA**, the network analyzer measures the load the
  trombone presents.
- With the switch on **PCB**, the DUT transmits into that load while power
  and current are measured.
- The trombone length moves the load **around** the Smith chart; the
  attenuator moves it **in or out**.

Press **View setup** on the page to see the app's own drawing of the bench.

![Load Pull Test](img/load-pull.png)

**Run** stays disabled until everything is ready, and says what it is
waiting for (for example **Needs RF path**). The row of checks along the top
of the page shows which steps are still open; click one to jump to it. Work
down the page:

### Step 1 · Connections

The **Connections** card has a pill for each thing the run needs: power
sensor, DC analyzer, VNA, switch, trombone and the DUT. A grey pill with a
tick is connected; an amber one is missing. The card says *N of 6
connected*. Connect anything missing.

### Step 2 · RF path

1. Press **View setup** and compare the bench with the drawing.
2. Press **Confirm path**. You must do this every session.

### Step 3 · Test point

Set **Frequency**, **DUT power**, **PA mode** and **Settle**. Both
frequency and power accept a list (2.4). Set **Attenuator** to **Sweep** if
you want the run to step the attenuator too; it will ask you to set it by
hand at each value.

The page shows the size of the plan. The numbers multiply quickly, so check
the total and the time estimate.

### Step 4 · Trombone calibration

Three cards side by side: **Move trombone** (the position, the jog pad and
the jog speed), **Controls** (the RF path and **Go to**) and **Sweep bounds**
(Zero, End and Delta X).

1. Press **VNA** in the **Controls** card to put the network analyzer on the
   trombone.
2. Choose a jog **Speed**: **Slow**, **Medium** or **Fast**.
3. Press and hold **←** or **→** on the jog pad while watching the Smith
   chart on the network analyzer. The motor stops the moment you let go. The
   card's header shows the position and **Idle** or **Moving**.
4. At the start of one full circle, press **Capture** on **Zero**. Jog to the
   end of the circle and press **Capture** on **End**. From now on the
   trombone cannot be moved outside Zero–End.
5. Set **Delta X**, the distance between points in mm. The **Sweep bounds**
   header then shows the number of points and the time it will take.
6. Use **Go to › Zero / End** to check both ends.

> Before Zero and End are captured, there are **no travel limits**. Capture
> them before any automatic movement, and capture them again after the
> console or the motor has been restarted.

### Step 5 · Run

Press **Run**. **The results table is cleared, so export earlier results
first.** At each trombone position the console measures the load, then the
DUT's power and current at every frequency and power. If the attenuator is
being swept, a box asks you to set each value; press **Attenuator is set**
to carry on.

### Results

![Load Pull results, example data](img/load-pull-results.png)

| Column | Meaning |
|---|---|
| **Pos [mm]** | Trombone position |
| **Power [dBm]** | Power at the DUT |
| **CC [mA]** | Supply current |
| **R [Ω]**, **X [Ω]** | The load impedance |
| **S11 [dB]**, **VSWR** | How far the load is from 50 Ω |

The **Power** cell is coloured when the sensor was near the edge of its
range: **amber** is marginal, **red** is unreliable.

**Smith chart** shows every point, coloured by efficiency (dark violet low,
bright yellow high). Hover a point for its numbers; the step number matches the **#** in
the table. With several frequencies or powers, pick which one to show.

![Smith chart, example data](img/load-pull-smith.png)

### The Trombone page

*Components › Trombone* moves the trombone by hand, in mm. It shows the
Zero and End captured on Load Pull. Its **Step** card has the same
hold-to-jog pad and **Slow / Medium / Fast** speed as Load Pull, then
**−8 mm / +8 mm** buttons and **Go min / Go max**.
Use it to check the trombone before a Load Pull.

![Trombone](img/trombone.png)
