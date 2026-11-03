# Changelog

All notable changes to the Test Console. Versions follow
[semantic versioning](https://semver.org): **major** for a change that breaks
how the rig is driven or how results are read, **minor** for a new page,
test or capability, **patch** for fixes and polish.

New entries go under **Unreleased** as work lands; `scripts/release.ps1`
turns that heading into the version and date.

## [Unreleased]

### Added
- Load Pull: remeasure a point. Double-click a dot on the Smith chart (or its
  row in the point list) for a Remeasure dialog with the point's settings and
  saved reading. Remeasure takes it again at those settings (position,
  frequency or channel, power, attenuator) as a one-point backend run, so Stop,
  E-STOP and the attenuator prompt work as in a run; the new reading shows
  beside the saved one and replaces it only on Use new. Go to position moves
  the trombone there without measuring. `ModalShell` gains `keepToolbar`.
- Load Pull Smith chart: a Statistics card under the point card with the min,
  average and max of Pout, efficiency or current (one at a time, picked on
  the card), for everything shown and per attenuator setting. Each row has a
  min-to-max bar with a tick at the average, on one scale across the rows,
  in the setting's colour when the chart is coloured by Att. A min or max,
  hovered, names its point and lights its dot. It follows the dialog's
  filters and updates live; failed rows are left out.
- Load Pull: the attenuator prompt takes the setting you actually dial in.
  The value is a field (Enter confirms), with the sweep's next settings as
  chips under it and a line saying what the value does. A later setting of
  the sweep jumps to it, skipping the cycles between (counted as done, never
  measured); any other value runs this cycle only, its rows recording it, and
  the sweep carries on. Continue is refused after either, as where to resume
  is no longer known.
- Load Pull Smith chart: an Att filter beside Freq and Power, for a run that
  swept the attenuator. A checklist of the settings, with Show all and Hide
  all, so one setting ("4") or a few can be compared without the rest of the
  trajectories over them. All are shown by default, and a setting the run
  reaches after the filter was set is shown too.
- Load Pull Smith chart: Graph options (the sliders key in its title) turn
  the connecting lines and the grid off, set the dot size, and colour the
  points by attenuator setting instead of efficiency, with a legend to match
  in the dialog and in Copy chart. Kept between sessions; Reset restores them.
- Load Pull (LoRa and LTE): VNA span (Controls card) picks one of the plan's
  frequencies, or takes any typed one, and Apply (or Enter) puts the analyzer on the span and marker the run
  reads it on (±0.5 %, 897.79-906.81 MHz for 902.3), so what a point
  measures can be seen on the VNA before running. It leaves the RF switch
  where it is.
- Network Analyzer: "To path loss" (Marker readings, S21 tab) writes the last
  S21 sweep's markers into the path loss table, one row per marker at its
  frequency with the loss as a positive dB (S21 −20.5 dB → 20.5). A table
  that already has points asks first, showing the table as it is beside what
  replaces it, a row per frequency marked changed, added or removed; the
  default loss is kept. The path loss table opens afterwards.
- Load Pull: Continue (Results header) resumes a run that was stopped or cut
  short by a crash, running only the points after the saved rows and
  appending to them. Rows are saved the moment each is taken during a run,
  and with the plan they belong to; Continue refuses if the settings that
  decide the points have changed. The first resumed point re-drives the
  trombone, re-reads the VNA, asks for the attenuator again and (LTE)
  restarts the modem. Works after Stop as well as after a crash.
- Load Pull refuses a plan whose rows would not fit in browser storage (4 M
  characters of Chrome's ~5 MB, less whatever else is saved, at 350 per row:
  ~11 400 points with nothing else stored), so no row is ever lost to
  Continue.
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
- Load Pull results: the Power cell is red only when the raw sensor reading is
  outside the sensor's range, −25 to +15 dBm, and its tooltip gives the raw
  value. An amber band from +10 to +16 dBm flagged readings well inside the
  range (+14 at full power) and is gone.
- Load Pull Smith chart: the point list no longer opens blank until scrolled.
  A list scrolled before the dialog closed kept its old scroll offset while
  the reopened list started at the top, so it drew rows below the view.
- Load Pull: the trombone's soft limits are per page. Only the Load Pull page
  on screen sends its Zero and End as the motor's limits, none does during a
  run, and a run sets them from its own plan when it starts. Both pages are
  mounted together and each pushed its own, so after a backend restart the
  LoRa page's ends were left on the motor and an LTE run's last two positions
  failed in every cycle ("target 51822 outside soft limits").
- Results tables (Load Pull, Mode Sweep, the CW and Modulated automation
  panels) follow new rows only while scrolled to the bottom. Scrolling up to
  read an older row during a run stops the jump back down, and a "↓ N new
  rows" pill floats over the table until you are back; it, scrolling to the
  bottom, or Clear resumes following (`useFollowBottom` and `FollowLatest`
  in the kit). Only a wheel, key, scrollbar drag or touch stops it, never the
  scroll position moving by itself.
- The Smith chart left open through a run no longer rebuilds every dot and
  list row on each new point: dots and rows are memoised and the list renders
  only the rows in view. At 890 live rows, ~10-115 ms per point (was 233 ms
  and growing) and half the DOM. Its swatch colours and the top progress
  bar's width are plain styles, not generated classes.
- A long Load Pull run no longer freezes the page and crashes the tab ("Aw,
  Snap!"). The results table rebuilt every row on every render (each point,
  the 500 ms ETA tick, the motor poll): ~1.9 s and ~100 MB per render at 5000
  rows. It is its own memoised component now and renders only the rows in
  view: ~95 ms per page render and 142 MB heap at 5000 rows (was 941 MB).
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
- Resizing the inspector tracks the pointer instead of trailing it: the
  column's open/close transition no longer runs during the drag, the width
  is painted once a frame without re-rendering the app, and it is saved once,
  on release. The edge no longer jumps by where the handle was grabbed.
- Stop on the LoRa CW, Modulated and Debug pages is disabled while no DUT is
  connected, as Send is; it stayed pressable with nothing to stop.

### Changed
- Load Pull Smith chart, layout and density: the point card is half its
  height (step and attenuator in a head line, efficiency and Pout large, the
  rest in a captioned 2 x 2 grid), and with no point hovered it is a centred
  "Hover a point" with the efficiency formula as a small key at its foot. The
  point list has fixed columns on one grid, figures right-aligned, so a
  three-digit step no longer runs into its position and a long Z is cut
  rather than pushing the row; its head no longer collapses. The Att filter
  opens a sheet of chips (All / None in its head, double-click for one)
  instead of a tall list. The Remeasure dialog gives the point's settings in
  one line and Saved / New in one grouped block, a changed figure marked.
- Instruments dialog: each row's Connect is the filled blue primary key (as
  Sweep S21), and Disconnect (each row, and Disconnect all) the soft red of
  the DUT's Disconnect key, instead of two outlined keys that differed by
  hue alone, so which instruments are connected reads at a glance.
- Load Pull (LoRa and LTE) runs in the backend (`backend/loadpull/runner.py`,
  `/test/load-pull/run|status|rows|att|cancel`) instead of in the page. A tab
  that crashes, reloads or closes no longer stops the run or leaves the DUT
  keyed; the page re-attaches on load and copies the rows in. The attenuator
  prompt is raised by the backend and answered from the page, and comes back
  after a reload. One Load Pull run at a time across both pages. Graceful
  backend shutdown stops a run and keys the DUT down first.
- Load Pull reads the VNA on a span of ±0.5 % around each frequency (995–1005
  MHz for 1000 MHz), one sweep per frequency per position, instead of on
  whatever span the analyzer was left at, where a marker snapped to a sweep
  point up to MHz away. Each span change waits one settle before the read,
  so a position now costs one settle per frequency.
- LTE Load Pull names the channels the selected bands cannot resolve and the
  band each needs ("725, 747.9 (band 28) · 1930 (band 1 or 65)"), and has an
  Edit bands key, instead of only counting them.
- No em dashes in toasts or tooltips (run-complete toast, import errors and
  notices, meter info results, field validation, the Measurement card's
  failure tooltip, the Mode Sweep chart). Empty-value dashes are unchanged.
- Load Pull: the trombone cards' controls fill the card instead of stopping
  at 232 px with empty card to their right.
- Load Pull (LoRa and LTE): the attenuator sweep is one Att values field
  taking the same specs as DUT power, whole dB within 0–20: a range
  ("0-20", or "20-0" downwards), a stepped range ("0-20:2") or any list
  ("0-5, 8, 9, 20"), run in the order typed. It replaces an Att max that
  always went from 0 in 1 dB steps; a saved Att max carries over as "0-max".
- Frequency, channel and power specs on every page can mix ranges and single
  values in one list ("0-5, 8, 9, 20"); a range used to have to be the whole
  spec.
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
