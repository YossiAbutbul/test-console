# 5. LTE tests

[← 4. LoRa tests](04-lora-tests.md) · [Contents](README.md) · Next: [6. Component pages →](06-component-pages.md)

- [5.1 Concepts: modem key, EARFCN, bands](#51-concepts-modem-key-earfcn-bands)
- [5.2 LTE CW](#52-lte-cw)
- [5.3 LTE Modulated](#53-lte-modulated)
- [5.4 Automation (both pages)](#54-automation-both-pages)
- [5.5 Cautions](#55-cautions)

The LTE pages drive the DUT's Cat-M modem. They use the same cabling as the
LoRa TX tests ([setup A](02-hardware-and-connections.md#a-lora--lte-tx-tests-cw-modulated-debug-mode-sweep)),
the same path loss, and the same preflight.

---

## 5.1 Concepts: modem key, EARFCN, bands

### The Modem key

The LTE modem is **off at rest** and takes **about 10 s to boot**. You control
it with the latching **Modem off / Modem on** key in the page header. The key
shows a green lamp when the modem is on.

- **Send turns the modem on for you** if the page believes it is off. A
  **Turning on modem** dialog shows while it boots.
- **Only the key turns the modem off.** Stop does not, a failed Send does not,
  and the end of a run does not. The modem is kept up on purpose, so you don't
  wait 10 s before every Send. The cost is that the DUT stays powered.
  **Turn the key off when you finish.**
- **The page cannot ask the modem its state.** It only remembers what it last
  did, and it assumes the modem is off after every page reload.
  - If the modem is actually on, the next power-on is refused: *"modem on
    rejected … power it off and on again"*.
  - To recover, turn the key **off**, then **on**.
- **The modem runs one test at a time.** A START sent while another test is
  running is **silently dropped**: the reply looks fine, but the radio keeps
  its old settings. The page always aborts the test it knows about before
  sending a new START.

### EARFCN or MHz

The **EARFCN | MHz** switch chooses how you enter the channel.

- **EARFCN → frequency** always has exactly one answer, using the uplink
  formula *F = F_low + 0.1 × (N − N_offset)*.
- **MHz → EARFCN** can be ambiguous, because uplink bands overlap. For
  example, 1880 MHz is EARFCN 18900 in B2, 26340 in B25 and 38250 in B39. So a
  MHz value is resolved **only within the bands ticked in Bands in use**:
  - it matches no ticked band → *Not in the selected bands*;
  - it matches more than one → *In more than one selected band*.

  The value is snapped to the nearest 100 kHz channel centre.

The unit and band choices are shared by both LTE pages. A change made on one
page appears on the other after a page reload.

### Bands in use

![Bands in use](img/lte-bands.png)

- **Selecting bands:** tick the bands this rig works in. The default is B2,
  B4 and B12. **Reset** restores that default; **Save** stores your choice.
- **Overlap warning:** ticking overlapping bands (for example 2/25/39,
  3/4/66, 1/65, 5/26/18/19/20, or 12/17/28) shows the warning **Overlapping
  bands selected**. A MHz value in the shared span is then refused until you
  untick one of the bands.
- **Scope:** bands only matter in **MHz** mode.

**Supported bands (uplink):**

| Band | Uplink MHz | EARFCN | | Band | Uplink MHz | EARFCN |
|---|---|---|---|---|---|---|
| B1 | 1920–1979.9 | 18000–18599 | | B20 | 832–861.9 | 24150–24449 |
| B2 | 1850–1909.9 | 18600–19199 | | B21 | 1447.9–1462.8 | 24450–24599 |
| B3 | 1710–1784.9 | 19200–19949 | | B25 | 1850–1914.9 | 26040–26689 |
| B4 | 1710–1754.9 | 19950–20399 | | B26 | 814–848.9 | 26690–27039 |
| B5 | 824–848.9 | 20400–20649 | | B28 | 703–747.9 | 27210–27659 |
| B7 | 2500–2569.9 | 20750–21449 | | B31 | 452.5–457.4 | 27760–27809 |
| B8 | 880–914.9 | 21450–21799 | | B38 (TDD) | 2570–2619.9 | 37750–38249 |
| B11 | 1427.9–1447.8 | 22750–22949 | | B39 (TDD) | 1880–1919.9 | 38250–38649 |
| B12 | 699–715.9 | 23010–23179 | | B40 (TDD) | 2300–2399.9 | 38650–39649 |
| B13 | 777–786.9 | 23180–23279 | | B41 (TDD) | 2496–2689.9 | 39650–41589 |
| B14 | 788–797.9 | 23280–23379 | | B65 | 1920–2009.9 | 131072–131971 |
| B17 | 704–715.9 | 23730–23849 | | B66 | 1710–1779.9 | 131972–132671 |
| B18 | 815–829.9 | 23850–23999 | | B71 | 663–697.9 | 133122–133471 |
| B19 | 830–844.9 | 24000–24149 | | | | |

An EARFCN outside every band in this table is refused; the app does not
guess a frequency for it.

---

## 5.2 LTE CW

*LTE › TX › CW.* This page transmits an unmodulated tone on an uplink channel
and, optionally, reads power and current.

![LTE CW, Manual](img/lte-cw-manual.png)

| Field | Unit | Default | Range |
|---|---|---|---|
| **EARFCN** / **Frequency** | — / MHz | 18900 / 1880 | must fall in a known band (see [5.1](#51-concepts-modem-key-earfcn-bands)) |
| **Tx Power** | dBm | 23 | **0–23**, step 0.01 (sent in 0.01 dB units) |
| **Time** | s | 200 | 0–4,294,967 |
| **Offset from centre** | Hz | 0 | signed 32-bit |
| **Measure power** / **Measure CC** | ☑ | on | with both off, Send only transmits |

The hint under the channel field shows the other unit and the band, for
example *1880.0 MHz · Band 2*.

**Procedure**

1. Choose EARFCN or MHz and enter the channel. Set **Tx Power**, **Time** and
   **Offset**.
2. Optionally press **Modem off** to boot the modem ahead of time.
3. Press **Send**. The page:
   1. runs the preflight;
   2. sends MODEM_ON if needed;
   3. aborts any previous test;
   4. sends CW START (`24 50`);
   5. reads the measurement card.
4. Press **Stop** to abort the test. The modem stays on.
5. Turn the **Modem** key off when you finish.

---

## 5.3 LTE Modulated

*LTE › TX › Modulated.* This page transmits a modulated uplink with a chosen
bandwidth, MCS and resource-block allocation. **The power sensor and DC
analyzer are always used on this page.**

![LTE Modulated, Manual](img/lte-modulated-manual.png)

| Field | Default | Range |
|---|---|---|
| **EARFCN** / **Frequency** | 18900 / 1880 | |
| **Tx Power** (dBm) | 23 | 0–23 |
| **Time** (s) | 200 | |
| **Bandwidth** | **5 MHz** | 1.4 (6 RB), 3 (15), 5 (25), 10 (50), 15 (75), 20 MHz (100 RB) |
| **MCS** | 5 | 0–28 (29–31 are reserved for retransmissions) |
| **Resource blocks** | 6 | 1 to the channel's maximum |
| **First block** | 0 | the allocation must fit: first + count ≤ maximum |

Changing **Bandwidth** clamps the RB fields so the allocation still fits the
channel. Send and Stop work as on LTE CW (Modulated opcode `23 50`).

---

## 5.4 Automation (both pages)

![LTE CW, Automation](img/lte-cw-automation.png)

![LTE Modulated, Automation](img/lte-modulated-automation.png)

### Row columns

| Page | Columns |
|---|---|
| **CW** | EARFCN (or Frequency) · Power (dBm) · Tolerance (± dB) |
| **Modulated** | the same, plus Bandwidth · MCS · RB |

**Range syntax:**

| Mode | Examples |
|---|---|
| EARFCN | `18900`, `18900-18910`, `18900-18910:5`, `18900,20175` |
| MHz | `1880`, `1850-1910`, `1850-1910:0.5`, `1850,1880,1909.9` |

- **Blank Power** means 23 dBm.
- **Blank Tolerance** means N/A (no verdict). A negative tolerance, or an
  invalid MCS or RB, blocks **Run**.
- **Channels are the outer loop** and powers the inner loop.

**Fixed in automation:**

- transmit time is 20 s, a backstop only, since each point is aborted as soon
  as it has been measured;
- CW offset is 0 Hz;
- Modulated first block and NB index are 0.

**Estimate:** the page shows *≈ duration · plus ~10 s to restart the modem*.

### Run sequence

1. The preflight connects the power sensor and DC analyzer.
2. **The modem is power-cycled**: OFF, then ON, which takes about 10 s. This
   clears anything left over from the manual tab. If ON is refused, the run
   fails.
3. For each point:
   1. START;
   2. Settle;
   3. read power and current;
   4. add the path loss;
   5. judge the verdict;
   6. **ABORT**, which is always sent, even after a failure.

   Each point is limited to Settle + 40 s.
4. At the end, the running test is aborted but **the modem is left on**. A
   completion dialog appears, and the log reports *p/t points within limits*.

**Stop** aborts at once and discards the point in progress.

### Results and CSV

| Page | Table columns |
|---|---|
| CW | #, EARFCN, Freq (MHz) + band, Set, Measured, CC, Verdict, Status |
| Modulated | the same, plus **Signal** (e.g. *5 MHz · MCS 5 · 6 RB*) |

**CSV columns:**

- **CW:** `earfcn, band, freq_mhz, set_power_dbm, measured_dbm, current_ma,
  path_loss_db, margin_db, min_dbm, max_dbm, verdict, ok, status, error`
- **Modulated:** adds `bandwidth, mcs, rb_count` after `set_power_dbm`.

**File names:** `<MAC>-<UTC timestamp>.csv`, or
`lte-cw-automation-<ts>.csv` / `lte-modulated-automation-<ts>.csv` when no
MAC is known.

**Import** needs `earfcn, set_power_dbm, measured_dbm`.

---

## 5.5 Cautions

- **Turn the modem key off** when you are done. Nothing else powers the modem
  down.
- **The CW and Modulated pages track the modem separately.** A test started on
  CW is unknown to the Modulated page. Its key may read *off* while the modem
  is on, and its first START can be silently dropped. **Stop the test and turn
  the modem off before switching LTE pages.** An automation run is safe,
  because it power-cycles the modem first.
- **Manual controls are not locked during an automation run.** Pressing the
  manual **Send** or **Stop** during a run disturbs it. Only the modem key is
  locked.
- **Unresolvable channels are dropped silently.** A channel entry that is
  invalid (red) does not block Run as long as another row is valid. Check each
  row's *N steps* count.
- **The Modulated graph ignores the signal settings.** Rows with the same
  channel and power but different bandwidth, MCS or RB overwrite one another
  on the graph.
