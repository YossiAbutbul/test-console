# 5. Results and saving them

## 5.1 Graphs

**Graph** on an Automation tab opens a chart of the results.

![Results graph, example data](img/lora-cw-graph.png)

- Two tabs: **Measured** power and **Current**, against frequency or set
  power (whichever has more values).
- Each line is one value of the other setting. On the Modulated pages each
  modem, bandwidth and datarate combination (or bandwidth, MCS and RB for
  LTE) gets its own line.
- Click a line in the legend to hide it.
- The options button sets the Y-axis range, the grid and the legend.
- **Download** saves the chart as a picture.

Mode Sweep's **Best settings** chart and the Load Pull **Smith chart** are
described with their tests in chapter 3. The Best settings chart has the same
download and Y-axis options.

## 5.2 Exporting

Press **Export** to save the results.

| Test | Saved as |
|---|---|
| LoRa and LTE automation | A CSV file that opens in Excel |
| Mode Sweep, Load Pull | An Excel workbook |

The file name starts with the DUT's MAC address, then the test, then the date
and time, so files sort by unit, then test, then time. For example:
`D4A1B2C3E4F5_tx-cw-automation_2026-10-18T14-05-31.csv`.

**What's in an Excel workbook:**

- **All**: every point. Numbers show 2 decimal places; click a cell to see
  the full value. Failed points are highlighted in red.
- **Run**: the settings the test ran with, a summary (points measured and
  failed, lowest and highest power, start and finish time), which DUT and
  instruments were used, and the path loss.
- **Best settings** (Mode Sweep): the lowest-current setting for each power,
  with the current shaded from low to high.
- One sheet per power level (Mode Sweep) or per frequency (Load Pull).

The header row stays in view as you scroll, and every column has a filter.

> **Export after every run.** A new run clears the table, and Mode Sweep
> results are lost if the console is restarted.

## 5.3 Importing

**Import** opens a file you exported earlier, to look at it again.

- On the automation pages, an imported CSV **replaces** the table; it does not
  add to it.
- On Mode Sweep and Load Pull, the imported workbook is for viewing. **Clear**
  goes back to your own results.

Files exported by older versions of the console still import.

## 5.4 The log

The **Log** (a tab of the panel on the right, beside **Bench**) lists
everything that happened, newest at the top. Errors are red, warnings amber. Its download button saves it as a
text file — useful to attach to a fault report.
