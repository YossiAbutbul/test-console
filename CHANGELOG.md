# Changelog

All notable changes to the Test Console. Versions follow
[semantic versioning](https://semver.org): **major** for a change that breaks
how the rig is driven or how results are read, **minor** for a new page,
test or capability, **patch** for fixes and polish.

New entries go under **Unreleased** as work lands; `scripts/release.ps1`
turns that heading into the version and date.

## [Unreleased]

### Added
- LTE Load Pull Test (LTE → Load Pull Test): the Load Pull run keyed with LTE
  CW instead of LoRa. Channels in the LTE pages' unit (EARFCN or MHz, within
  the selected bands), 0–23 dBm, no PA mode. The modem is turned on at the
  start of the run (off, then on) and off once every cycle is done, or the
  run is stopped or fails; each point is a CW START, settle, read and ABORT. Same page as
  LoRa's with its own saved settings. The workbook's Run sheet names the
  radio, and LTE files are named `…_lte-load-pull_…`.
- `scripts/publish-release.ps1` creates the GitHub Release page from the
  changelog; `release.ps1 -Push` runs it, and `-Bundle` attaches the
  DUT-only zip.
- Mode Sweep: a "Measure CC" checkbox on the Last measured row card. Unchecked, the
  sweep reads power only: the DC analyzer is not preflighted, opened or read,
  and the Run sheet records "Current measured: No".
- Mode Sweep autosaves every run's workbook when it ends (done, stopped,
  failed or cut short by a backend shutdown) to `autosave/sweeps/`, and the
  page logs the path. A restart no longer loses the rows; open the file with
  Import.
- Mode Sweep: "Power from" picks the power sensor or the spectrum analyzer.
  With the analyzer, a Spectrum analyzer card sets span, RBW, VBW and
  detector; the run centres it on the sweep frequency, zeroes its reference
  offset (path loss is still applied in software), and reads the peak marker
  after one sweep per step. The Run sheet records the source and settings.

### Fixed
- Load Pull's Test setup and Smith chart dialogs dim the toolbar too, as any
  dialog does. Only during a run do they stop below it, so E-STOP and Stop
  stay reachable.
- A persisted setting changed on one page reaches every other mounted page
  that reads it: switching the LTE channel unit on the CW page left LTE
  Modulated reading its channels in the old unit until a reload.
- A scrolling page (Mode Sweep, Load Pull, Spectrum Analyzer) keeps its scrollbar's lane even
  when nothing overflows, so the cards no longer narrow by 10 px and shift
  the moment content is added (e.g. choosing Spectrum analyzer).
- Switching pages in the sidebar is immediate (~30-50 ms in the dev server,
  was 280-410 ms). Each mounted page is memoised, and the page trees'
  `active` prop is deferred: the new page, its title and the sidebar change
  at once, and the re-render that starts the page's polls follows.
- Mode Sweep: a lost DUT link ends the run as an error ("DUT not answering")
  after three failed commands in a row, instead of failing every remaining
  step in milliseconds and finishing as "done".
- Stopping the backend mid-sweep stops the sweep and keys the DUT down before
  the BLE link is released, and the run reports "backend shut down mid-run".

- Mode Sweep survives a BLE drop: a failed command waits (up to 45 s) for the
  manager's reconnect and resends that step on the new link. The run used to
  keep the old, dead device, so every step after a drop failed with "Not
  connected" even once the link was back. A step whose command fails on a
  link that still looks up (a timeout just before the drop is reported) is
  resent once after 1.5 s, on the new link if one appeared, so it is no
  longer skipped. Only a step that fails twice is recorded as an error.
- A late disconnect callback from a replaced BLE client no longer wipes the
  client that reconnected after it.
- A timed-out instrument call keeps the driver's own message ("no SCPI
  answer from 172.16.10.1:5555 …") instead of a bare "timed out".

### Changed
- No em dashes in toasts or tooltips (run-complete toast, import errors and
  notices, meter info results, field validation, the Measurement card's
  failure tooltip, the Mode Sweep chart). Empty-value dashes are unchanged.
- Load Pull: the trombone cards' controls fill the card instead of stopping
  at 232 px with empty card to their right.
- Load Pull (LoRa and LTE): the attenuator sweep has Att start and Att stop
  (0–20 dB, 1 dB steps, either direction) instead of an Att max that always
  started at 0. A saved Att max carries over as the stop.
- Load Pull's Frequency/Channel and DUT power tooltips are four short examples
  (One, Range, Step, List) in the field's own unit instead of a sentence; the
  LTE Channel's follow the EARFCN/MHz setting.
- Mode Sweep's results table is a fixed 240 px, the same as Load Pull's
  (`RESULTS_H` in the UI kit), and the page scrolls when the cards above it
  do not fit, instead of squeezing the table.
- A disabled primary key ("Needs DUT") is the faded grey of any disabled key,
  not a blue wash that looked pressable, and no longer shows a tooltip.
- The inspector always opens on the Bench tab.
- Bench inspector: an instrument row opens the Instruments panel at that
  instrument (scrolled to, marked with an accent bar, its key or address
  focused); Manage opens the whole panel. Rows answer on the press and their
  chevron leans on hover; Manage is a tinted key rather than bare text.
  Opened from a row that is not connected, the panel re-scans that
  instrument and opens the list of what it found.
- Sidebar DC supply: while the DC analyzer is not connected, the greyed Off
  key is a Connect key in the same box. A failed connect marks the footer and
  opens the Instruments panel at the DC analyzer.
- The inspector's first tab is called Connection (was Bench).
- A DUT page with no DUT connected is no longer dimmed and click-blocked:
  fields, tabs, the Measurement card's Read and the results all work, and
  only Send, Run and their Stop wait, reading "Needs DUT". Drops the
  `ungated` escape hatch (`Section` prop, `data-ungated`) the dimming needed.
  The manual says so; its `dut-page-dimmed` screenshot needs re-capturing.
- Light is the default theme for a browser that has not picked one (was Mid).
- The toolbar title is one 20 px line, "LoRa CW", instead of the page name
  over a "LoRa" caption. Rig pages show the page name alone.
- Measurement card: the Measured (TX power) reading leads the strip on an
  accent-tinted cell with an accent bar and label (`primary` on `StatTile`).
- Readout tiles show an empty value instead of a "—" when there is no
  reading; the caption already says why. Captions share one baseline across
  the strip.

### Fixed
- Resizing the inspector tracks the pointer instead of trailing it: the
  column's open/close transition no longer runs during the drag, the width
  is painted once a frame without re-rendering the app, and it is saved once,
  on release. The edge no longer jumps by where the handle was grabbed.
- Stop on the LoRa CW, Modulated and Debug pages is disabled while no DUT is
  connected, as Send is; it stayed pressable with nothing to stop.

## [1.0.0] - 2026-10-21

The first versioned release.

### Tests
- **LoRa:** CW (manual and automated sweep with tolerance verdicts),
  Modulated, Debug, Mode Sweep, and the Load Pull test with trombone sweep,
  RF switching and Smith chart.
- **LTE:** CW and Modulated, with EARFCN/MHz channel entry and band filters.
- **Components:** Trombone, RF switch, network analyzer, power meter, signal
  generator, DC analyzer and spectrum analyzer pages.

### Design (the Inspector redesign)
- macOS-style shell: full-height sidebar with foldable sections and the DC
  supply, a translucent window toolbar holding each page's title and keys,
  and a right inspector with Bench, Log and Assistant tabs.
- One blue accent; grey secondary keys; filled field wells; labelled E-Stop;
  Light, Mid and Dark themes.
- Results tables with units in brackets and PASS / FAIL counts that filter the
  rows.
- Instruments dialog as grouped panels, with Re-scan in the address field.
- Load Pull's trombone step as three cards, with a shared hold-to-jog pad
  that the Trombone page now has too.
- Settings: DUT scan time, "Select text on focus" (off by default), theme.
- Nothing changes size when its state changes.

### Docs
- DESIGN.md, the user manual and the testing guide describe this release.
  Manual screenshots still show the previous design.

[Unreleased]: https://github.com/YossiAbutbul/test-console/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.0.0
