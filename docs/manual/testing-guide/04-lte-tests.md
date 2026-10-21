# 4. LTE tests

The LTE pages use the same bench, path loss and instruments as the LoRa
tests.

## 4.1 The Modem key

The LTE modem is **off** until you need it and takes **about 10 seconds** to
start. The **Modem off / Modem on** key in the page header controls it; it
is grey while off and filled in colour while on.

- **Send starts the modem for you** if it is off. A box shows while it
  starts.
- **Only the key turns the modem off.** Stop doesn't, and neither does the
  end of a run. **Turn the key off when you finish.**
- The page can't ask the modem whether it is on; it remembers what it last
  did. If you see *"modem on rejected"*, turn the key **off**, then **on**.
- **Stop the test and turn the modem off before switching between the CW and
  Modulated pages.** Each page keeps track of the modem separately.

## 4.2 Choosing the channel: EARFCN or MHz

The **MHz | EARFCN** switch at the top right of the **Transmit** card chooses
how you enter the channel. **MHz** is the default.

- **EARFCN** is the LTE channel number. Each one maps to exactly one
  frequency, shown under the box (for example *1880.0 MHz · Band 2*).
- **MHz** is easier to read, but some frequencies belong to more than one
  band. The console only looks in the bands ticked under **Bands in use**
  (the tune icon). Tick only the bands this rig works in.

![Bands in use](img/lte-bands.png)

## 4.3 LTE CW — one setting

*LTE › CW, Manual tab.*

![LTE CW, Manual](img/lte-cw-manual.png)

1. Enter the channel, **Power** (0–23 dBm), **Duration** (how long to
   transmit, in seconds) and **Offset from centre** (usually 0).
2. Tick what to measure.
3. Press **Send**. The modem starts if needed, the DUT transmits, and the card
   fills in.
4. Press **Stop** to end the transmission. The modem stays on.
5. Turn the **Modem** key off when you finish.

## 4.4 LTE Modulated — one setting

*LTE › Modulated, Manual tab.* The same as CW, plus the signal:

![LTE Modulated, Manual](img/lte-modulated-manual.png)

- **Bandwidth**: 1.4, 3, 5, 10, 15 or 20 MHz.
- **MCS**: 0–28.
- **Number of RB allocation** and **Position of RB allocation**: the
  allocation must fit inside the bandwidth. Changing the bandwidth adjusts
  them for you.

Power and current are always measured on this page.

## 4.5 Automation (both pages)

![LTE CW, Automation](img/lte-cw-automation.png)

1. Fill in the rows: channel, **Power** and **Tolerance** (plus **Bandwidth**,
   **MCS** and **RB** on the Modulated page). The list format from 2.4 works
   for channels too, for example `18900-18910:5`.
2. Check each row's point count and the time estimate. The estimate includes
   about 10 s for restarting the modem.
3. Press **Run**. The console restarts the modem first, then measures each
   point and stops the DUT after it.
4. At the end the modem is **left on**. Turn the key off when you are done.

The results table adds **EARFCN** and the band to the usual columns; on the
Modulated page a **Signal** column shows the bandwidth, MCS and RBs. The
**pass** / **fail** counts above it filter it, as on the LoRa pages (2.7).

> **Don't use the Manual tab during a run.** Its Send and Stop buttons still
> work and would disturb the run.
