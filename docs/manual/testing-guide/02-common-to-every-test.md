# 2. Common to every test

The test pages share the same way of working. Learn it once here.

## 2.1 Manual and Automation tabs

Most test pages have two tabs:

- **Manual** sends **one** setting. You press **Send**, read the result, and
  press **Stop**.
- **Automation** runs a **list** of settings one after another, judges each
  one PASS or FAIL, and fills a results table. You press **Run**, and
  **Stop** if you need to end it early.

## 2.2 The measurement card (Manual tab)

After a **Send**, the card under the settings takes a reading by itself.

![The measurement card](img/lora-cw-manual.png)

| Tile | Shows |
|---|---|
| **Target** | The power you asked for |
| **Measured** | The power at the DUT (sensor reading plus path loss) |
| **Error** | Measured minus Target: green within ±1 dB, amber within ±2 dB, red beyond |
| **Current** | The DUT's supply current in mA, with the voltage under it |

- Press **Read** to measure again without sending.
- If the header says **uncalibrated** in amber, the path loss for this
  frequency is the default, not a measured value.
- If you change the power after reading, the Error tile says *read again*,
  because it still compares against the old target.

## 2.3 Settle time

**Settle** is how long the DUT transmits before the reading is taken. The
minimum and default is **400 ms**.

If a low-power point reads too high while its current looks right, settle is
too short: the sensor is still averaging the previous, stronger point.

## 2.4 Entering a list of values (Automation)

The frequency and power boxes on the Automation tabs accept a list:

| You type | It means |
|---|---|
| `915` | one value |
| `900-930` | 900 to 930 in steps of 1 |
| `900-930:5` | 900 to 930 in steps of 5 |
| `902.3,915,927.5` | exactly these values |

Each row tests every frequency with every power. The number at the end of the
row (*N steps*) shows how many points it adds; a row with a mistake adds
**0 steps**, so check it before you press Run.

## 2.5 Tolerance and verdict

**Tolerance** is the pass band in ± dB around the power you asked for.

- **PASS** means the measured power is within the tolerance.
- **FAIL** means it is outside.
- Leave the tolerance blank for no verdict (**N/A**).

## 2.6 Following a run

While a run is going:

- a **progress bar** runs along the top of the panel;
- the panel shows **time elapsed** and **time left**;
- a **Run** tag shows in the top bar, so you can see it from any page;
- the results table fills in point by point.

Before you press Run, the panel shows an estimate of how long the run will
take (for example *≈ 4m 10s*). The estimate gets more accurate as the run
goes.

When the run ends, a box tells you how it went:

| Box | Meaning |
|---|---|
| **complete** | Every point was measured |
| **finished with errors** | Some points could not be measured; their **Status** says why |
| **stopped** | You pressed Stop |
| **failed** | The run could not continue; the box gives the reason |

> "Complete" means every point was **measured**, not that every point
> passed. Always check the **Verdict** column.

## 2.7 Pages remember your work

You can move between pages during a run; nothing is lost. Settings and
results are also kept if you reload the page. A run in progress keeps going
while you look at other pages.
