# Changelog

All notable changes to the Test Console. Versions follow
[semantic versioning](https://semver.org): **major** for a change that breaks
how the rig is driven or how results are read, **minor** for a new page,
test or capability, **patch** for fixes and polish.

New entries go under **Unreleased** as work lands; `scripts/release.ps1`
turns that heading into the version and date.

## [Unreleased]

### Added
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
