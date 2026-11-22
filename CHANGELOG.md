# Changelog

All notable changes to the Test Console. Versions follow
[semantic versioning](https://semver.org): **major** for a change that breaks
how the rig is driven or how results are read, **minor** for a new page,
test or capability, **patch** for fixes and polish.

New entries go under **Unreleased** as work lands; `scripts/release.ps1`
turns that heading into the version and date.

## [Unreleased]

### Fixed
- Load Pull: the "Set the attenuator" prompt could open under the Smith
  chart when a cycle ended with the chart open. The run waited on an answer
  that could not be given, and neither dialog could be closed, so the only
  way out was reloading the frontend and restarting the backend. The prompt
  now always opens above every other dialog.

## [1.3.0] - 2026-11-17

### Added
- BLE CW: a BLE section in the sidebar with a CW page, Manual and
  Automation, laid out like LTE CW. The DUT's BLE radio is the one carrying
  the link, so both of its test commands drop it, and the page sequences the
  reconnects: a power change is set (`31 00`), save-and-reset, reconnect,
  then read back (`30 00`) to confirm it took; a tone (`10 21`: channel,
  offset, duration) is measured while on air, waited out (it cannot be
  stopped -- the Stop key stays greyed and a status beside it counts the
  tone down), then the DUT is reconnected. Send reads the power first and
  resets only if it differs. Automation sweeps channel and power specs (in
  channel numbers or MHz) with optional Min/Max dBm limits, grouped by
  power so each power costs one reset, with a run-wide settle. The tone
  length is auto by default: sized per point from how long the readings
  actually take (typically ~3 s), so the run is not left waiting out a long
  tone; a number fixes it. A reading that finishes after its tone has ended
  is shown but not judged. Each row appears as soon as it is measured, ahead
  of the reconnect, and the log times every reconnect. A DUT that does not
  come back ends the run. Export, Import and Add to report as on the LTE
  page. Power is the firmware param (6-31) throughout, never dBm; tone
  duration is capped at 255 s until a frame shows whether its field is one
  byte or two. New routes
  `/device/ble/tx-power` (GET/POST), `/device/ble/tone` and `/ble/relink`.
- Path loss: Loadâ€¦ and Save asâ€¦ in the Path loss dialog. Save as writes the
  table as shown (default and per-frequency points) to a .json file; Load
  fills the dialog from one, to review and apply with Save (Cancel still
  discards it). A file that is not a path loss table, or has a bad or
  repeated frequency, is refused whole, with the reason. A bare list of
  `{"freq_mhz", "db"}` points loads too.
- Load Pull: trombone range per frequency. Zero/End leave the Sweep
  bounds card for one Range row (the extent swept, and how many frequencies
  have their own range) with Set/Edit, which opens a dialog laid out like
  Path loss: the trombone's live position, press-and-hold jog with its
  speed, and Go to Lowest start / Highest end on top; below, an All
  frequencies row (the former Zero/End, carried over) and a row per test
  frequency, each with Start and Stop captured from where the carriage is
  (Recapture, go back to a captured end, clear the row). Each capture is
  saved as it is taken, one end alone included, so closing the dialog
  midway loses nothing; Run stays blocked until every range in use has both
  ends.
  The run sweeps a frequency over its own range, or All frequencies when it
  has none, on one shared grid of Delta X steps (anchored on the All
  frequencies Start when it is used), so frequencies share positions instead
  of each stepping from its own hand-captured Start -- a 7-frequency run went
  from 124 positions per attenuator step to 34. Each position is visited
  once, skipping the frequencies it is not in; the VNA reads only those planned there, and the
  workbook's Run sheet lists each range. Go to on the Controls card is now
  Start / Stop of the frequency picked under VNA span. Travel limits follow
  the extent of the captured ranges, and are lifted while the dialog is open
  so new ends can be reached. Nothing moves except on a key press.
  The dialog dims the whole window, toolbar included, and carries its own
  E-Stop; a VNA column puts the analyzer on a row's span and marker ("Show",
  then "On VNA" on the row it is showing), so ends can be chosen watching
  the Smith chart.
  The Range row on the card is one line: how many ranges and where they
  span, each frequency's figures on hover. The dialog draws them: a Sweep
  column with each row's range on one shared scale (own blue, All
  frequencies grey, one captured end an amber dot) and the carriage's live
  position as a line across every row, so jogging toward an end shows where
  it is against every range.
- Power sensor dynamic range, a setting (default -30 to +20 dBm) in the
  power sensor's settings on the Power Meter page. A raw reading outside it
  is flagged: "outside dynamic range" in amber on the Power Meter's At
  sensor tile and on the CW/Modulated measurement card, and in red, with
  the reason on hover, in the Load Pull results (which used a fixed -25 to
  +15 dBm before).
- LTE Load Pull: the "Turning on modem" notice LTE CW shows, while a run's
  first step cycles the modem; below the toolbar, so Stop and E-STOP stay
  in reach.
- Smith chart: Colour by Pout, beside Efficiency and Att (Att offered only
  when the run swept the attenuator). The legend, the copied chart and the
  hovered point's card follow the choice.
- Load Pull run: the RF switch moves once per position instead of twice.
  Positions alternate VNA-first and PCB-first, so the switch is already
  where the next position starts; a PCB-first position's rows are published
  once its VNA read has filled in R/X, and a Stop part-way through one keeps
  none of it (Continue measures it again).
- LTE Load Pull: an MHz / EARFCN switch on the Test point card, so the
  channel unit can be set there rather than only on the other LTE pages.
  It is the setting every LTE page shares, and switching rewrites the
  channels already typed into the new unit.
- Product reports (phase 1). A report collects the runs kept for one
  product model, from any number of units. "Add to report" beside Export on
  the CW and Modulated automation tabs (LoRa and LTE) and on Frequency
  accuracy (LoRa and LTE) adds the run's results table, exactly as Export
  writes it, with its settings, the unit (MAC, BLE name, nickname), the
  operator and a note; the last product used is preselected. A new
  "Product reports" page, in its own Reports section of the sidebar, is a
  document editor: the report drawn as the paper it prints on, built from
  components (cover, heading, text, summary table, one test run, all runs,
  page break, picture). Text edits in place, and so does every other word
  and value on the page -- the cover's title, subtitle and fields, a run's
  title, details and result lines and note, every header and cell of the
  Settings, Results and Summary tables, the unit IDs -- per block, emptied
  back to the measured value, an edited value underlined on screen only.
  A run in "All runs" opens as a block of its own ("Edit on its own").
  Pictures come from the clipboard (Ctrl+V: after the block holding the
  cursor, else the block last clicked; a click into a block's text selects
  that block), a file
  dropped on the page, or the file picker; sized S/M/L/full width with a
  caption, converted to PNG/JPEG and capped at 2400 px for Word, kept under
  `reports/images` and shared by id so a template can carry a logo. The
  report's name in the toolbar switches reports. A block moves by dragging its handle
  (it follows the pointer, the others make room, it settles into its slot)
  or with its up/down keys; + between blocks or Add inserts one; a run's
  block can hide its settings or note. A layout saves as a template (its
  runs become an All runs component) to start or restyle another product's
  report. Changes save automatically; add, move, remove and template
  changes can be undone. Export Word prints the layout in order, runs
  numbered as they appear, failed rows shaded, in the lab's RF report style
  (taken from its SW2233 report): A4 portrait, Calibri with navy headings, a
  cover page (logo, the product in large navy type, subtitle, photo, Tested
  By, Date), the logo in the header and a blue page number on the pages
  after it, tables with a light blue header row and black rules. The editor
  draws the same pages, as Word's print layout does: A4 sheets (794 x 1123
  px at 96 dpi) one below the other, the blocks flowing onto the next sheet
  when they no longer fit (a heading going with the block it introduces, as
  Word's keep-with-next does), the cover and page breaks starting a new one,
  and each sheet after the cover with the header logo and its page number.
  Every component resizes by dragging its edge -- pictures and the cover
  photo from both edges, tables, runs, headings and text from the right --
  following the pointer with a live percentage, settling on 25/33/50/66/75/
  100 % as it passes, resisting past its limits; one undo step per drag.
  Word prints the width: a picture's size, a table's column widths scaled,
  a paragraph's right indent. New reports start from that report's intro: Test
  Setup, Scope of Testing, Test Parameters (an editable Parameter / Value
  table) and Unit IDs (filled from the runs), then the results and Notes.
  The logo is a report setting (Templates menu), kept with the report data
  rather than the code. Stored as one JSON
  file per product under
  `reports/` (git-ignored; `%LOCALAPPDATA%\TestConsole\reports` in the exe).
  Backend: `/reports` routes (backend/api/reports.py), new dependency
  `python-docx`.
- Charts in product reports. A Chart component plots one run's results:
  pick the run, the column across (frequency or channel to start with), the
  columns plotted (the measured value to start with) and line, points or
  bars, with a title. Drawn in the report's style (navy title, legend,
  light grid, round axis steps, Office's chart colours from the report's
  navy) and resized from both edges like a picture. The chart's settings
  float under it while it is selected, so choosing one never moves the
  page. Word gets a real Word chart of the same numbers, in the same style
  (an XY chart for line and points over frequency, so points sit at their
  true frequency): it restyles with Word's Chart Design tools and its data
  opens with Edit Data from a workbook embedded with it. A template keeps a
  chart's form but not its run; removing a run leaves its chart empty, to
  be pointed at another.
- Formatting in product reports. Any words on a report page -- text,
  headings, labels, table cells, parameter rows -- can be made bold,
  italic, underlined or coloured: select them and a format bar floats over
  them (Bold, Italic, Underline -- Ctrl+B, Ctrl+I, Ctrl+U too -- nine text
  colours and any other, Clear formatting); the colours open from one key
  as a small panel, keeping the bar compact. With the cursor in a table, the
  bar also fills the row: six light tints, No fill (which takes off a failed
  row's red and the header's blue too) or Automatic (the table's own), the
  header row included. A block's own keys now float just above it rather
  than over its first line. Word prints the same. Formatting is kept in the
  value itself as a few tags; values without it read exactly as before.
  Pasted text comes in as plain words.
- The format bar's "Other colourâ€¦" and "Other fillâ€¦" open its own colour
  picker -- a saturation and brightness square, a hue strip, the hex code
  and the colour before and after -- in place of the system dialog, and
  the custom colours used last are kept under the swatches as Recent.
  The bar follows its words while the page scrolls, on the same side of
  them, and steps out of the way when they scroll under the toolbar or out
  of view.

### Changed
- Measure reads the power (sensor or analyzer) and the DC analyzer at the
  same time rather than one after the other, so a point's reading is
  shorter and its power and current come from the same moment.
- Smith chart: switching to Working area no longer waits. The area is
  worked out (and its figure mounted) in the background as soon as the
  dialog opens and whenever its data changes, instead of only once the tab
  was opened, and the tab control answers the click at once while the
  content follows.
- The report's editable words run on TipTap (MIT) instead of the browser's
  deprecated editing commands. Formatting is applied and read the same way
  in every browser, undo works per field, a paste is cut down to plain words
  in the formatting where it lands, and Bold in a heading or table head
  turns the place's own bold off and on. Reports are stored exactly as
  before, so existing reports and the Word export are unchanged.

### Fixed
- Backend start: the DC analyzer (and any VISA instrument) no longer fails
  to connect with `VI_ERROR_LIBRARY_NFOUND` until the backend is restarted
  once or twice. VISA and the power sensor's .NET runtime were loaded on
  their first connects, on two threads at once when the page connected both
  together; they are now loaded at startup, in order, before the first
  request.
- Measurement reads (every TX page's Measure, and the automations) no
  longer fail with "dc-analyzer is not responding to a previous command"
  when they land on the DC control panel's once-a-second poll, or on
  another page's read of the power sensor. They wait their turn, up to 4 s,
  as the analyzer's own commands already did.
- Measurement card: the read after a Send no longer goes missing when the
  page redraws during the settle. Any redraw in those 400 ms cancelled the
  pending read for good, leaving "not read yet" while the DUT transmitted;
  only a newer Send now cancels it.
- A Load Pull page opened or reloaded during a run could reset the
  trombone's travel limits from its own ranges before it had learned a run
  was going, and the run's moves outside them then failed "outside soft
  limits" for the rest of it. A page now leaves the limits alone until its
  first look at the run has answered, and the run sets its own limits
  again before every trombone move, so nothing changed in between can
  refuse its positions.
- A short click on a trombone jog arrow could leave the motor jogging: start
  and stop went out together, the stop reached the backend while the start
  was still waiting for the motor to idle, and the jog that followed was never
  stopped. It ran to the soft limit, or with none set (the range dialog lifts
  them) kept going. A jog's stop is now sent only after its start has
  answered, and the backend stops any jog whose keepalives (sent every 250 ms
  while the key is held) stop for a second. Load Pull and Trombone pages.
- `publish-release.ps1` stopped before doing anything under Windows
  PowerShell 5.1: its quiet checks (`gh auth status`, the tag on origin,
  "does this release exist") write to stderr, which 5.1 turned into a fatal
  error. They now run for their exit code alone.

## [1.2.0] - 2026-11-15

### Added
- The launcher's window says not to close it: its title reads "TEST
  CONSOLE - RUNNING - DO NOT CLOSE (Ctrl+C to stop)", which stays in the
  title bar, tab and taskbar while the log scrolls, and a banner at start
  explains why and how to stop it properly.
- App icon as `frontend/public/favicon.ico` (the favicon's flask, 16 to 256
  px). The desktop shortcut to `Test Console.bat` uses it, and the next
  `build-app.ps1` gives `TestConsole.exe` it too: the spec already looked for
  this file, which did not exist.
- LTE Frequency accuracy, the LoRa page's twin under LTE: the same zoom,
  stages, per-stage and per-row tolerances and tables, keyed with the LTE CW
  page's command (EARFCN, power up to 23 dBm, no offset). Channels are typed
  as EARFCNs or MHz in the selected bands, like every LTE page, and convert
  when the unit is switched. The backend run takes `radio: "LTE"`: it powers
  the modem off and on before the first point, aborts each point's test
  after it, and powers the modem off at the end. No PA mode.
- Path loss calibration guide: "How to calibrate" in the Bench pane's path
  loss heading opens a floating sheet (not modal, the page stays usable)
  with three animated steps -- reference cable, set 0 dBm at the meter, connect
  the chain and read the loss -- for the power sensor or the spectrum analyzer.
  It docks in the bottom-right corner, over the pane, and can be dragged anywhere by its
  header (remembered; double-click the header to dock it again).
- LoRa Frequency accuracy test (spectrum analyzer only). Keys a plain CW
  carrier (the CW page's command: frequency, power, PA mode) and
  zooms in on it in stages with the carrier kept on throughout: set span, RBW
  and VBW, settle, sweep, marker to peak, marker to centre frequency, then the
  next, narrower stage. Defaults 1 MHz / 20 kHz / 1 kHz,
  ending at about a hertz per trace bin. Reports the measured frequency, the
  error in Hz and ppm, and each stage's peak; flags a peak at the edge of a
  span. Manual and Automation tabs: Automation measures a plan of
  frequencies across bands ("868.1, 902.3-927.5:0.2" per row, with its own
  powers, "0,16,30", PA mode and Ã‚Â± ppm tolerance; blank = no verdict),
  judges each point against its row's tolerance, and exports CSV. Its plan
  and the zoom stages use the Sweep table's layout from the power page
  (numbered rows, settle in the heading); the stages show three rows and
  scroll past that. Each stage has its own Ã‚Â± ppm tolerance for its peak
  (default 30 ppm, as for a sweep row); on Automation a point passes only
  when its row's tolerance and every judged stage do, on Manual when every
  judged stage does. Stages measured shows each stage's error in ppm and
  verdict. The
  DUT is stopped after every point, and one failed point does not end the run.
- R&S FSV3004 signal and spectrum analyzer over GPIB (GPIB-to-USB adapter),
  beside the FSC3 on LAN. Same driver and SCPI; the address picks the link:
  "host:port" is the FSC3 socket, a VISA resource such as
  "GPIB0::20::INSTR" goes over VISA. Discovery lists R&S analyzers VISA can
  see ahead of the FSC3's LAN address, the Instruments panel and the
  Spectrum page name the connected model and link, and a Mode Sweep that
  opens the analyzer itself does so at that address. The FSV is set to
  ASCII trace data on connect and handed back to local on disconnect. Needs
  the adapter's GPIB driver (NI-488.2 or Keysight IO Libraries) on the PC.
- Mode Sweep: Paste table, beside Add range in the advanced ranges. Paste a
  configuration table copied from Excel (Target, PA mode, Power (Set),
  PA DC, HP Max, with or without the measured P/I/error/Status columns,
  which are ignored) and each row becomes a one-step range with its own PA
  mode, so the table reruns as written: PA off and PA on rows in one run.
  The sheet shows what was read and flags any bad row before it replaces
  the ranges. The range editor gained a PA mode choice ("Run's" follows
  the page's PA mode). Backend: optional `pa_mode` per `SweepBlock`; each
  result row records the PA mode it was sent with.
- Mode Sweep: Remeasure, beside Run sweep. After a run or an imported
  workbook, pick a span of measured power -- whole tabs, grouped exactly as
  the export's per-level sheets -- and rerun just those configurations,
  with the PA mode chosen for the rerun (On by default), e.g. what measured
  0-10 dBm with the PA off, again with it on. The Run sheet records the
  source, the tabs and the configuration count.
- Spectrum analyzer as the power source on every test that measures power:
  LoRa CW, Debug and Modulated, LTE CW and Modulated (manual and automation
  tabs), and Load Pull (LoRa and LTE). Each test's Measure section has a
  Power from switch and its own span, RBW, VBW and detector, saved with the
  page; the analyzer is centred on each step's frequency and handed back
  free-running. Only settings that changed since the last read are sent
  (about a second saved per reading); anything else that changes the
  analyzer -- the Spectrum page, a reconnect, a Mode Sweep, a failed read --
  makes the next read set it all again. Mode Sweep uses the same control.
  Backend: `source=spectrum` on `/instruments/measure`, and `power_source`
  / `spectrum` on the Load Pull run config.
- When the spectrum analyzer reads power, its reference level is set from
  the requested power: the level expected at its input (requested power
  less path loss) plus 5 dB, rounded up to a whole dB and kept within
  -80 to +30 dBm, with input attenuation on auto so it follows. Per read on
  the test pages and Load Pull, per step in Mode Sweep.
- The sidebar shows the app's version (v1.1.0) at the end of the credit
  line, read from package.json, so it follows each release. It links to that
  version's release notes on GitHub.
- Load Pull Smith chart: a Working area tab. Set min/max limits on Pout,
  Icc and efficiency, and the chart fills the loads that meet all of them,
  interpolated linearly between the measured points and coloured by
  efficiency. With all frequencies selected, a load counts only where it
  passes at every one, and its readings are the worst of them. It stars the
  best-efficiency load in the area and reads the interpolated values under
  the cursor.
- Load Pull Smith chart: an Electrical delay field (ps), in the working
  area's settings, moves the VNA's reading to the PA, Z_PA = 50Ã‚Â·(Z_VNA + j50Ã‚Â·tan ÃŽÂ¸)/(50 + jÃ‚Â·Z_VNAÃ‚Â·tan ÃŽÂ¸) with
  ÃŽÂ¸ = 2Ãâ‚¬Ã‚Â·fÃ‚Â·Ãâ€ž, each point at its own frequency. Points, list, statistics
  and working area all follow it; the results table keeps the measured
  values.
- The working area is drawn as a report figure: title, labelled Smith grid,
  efficiency in bands with a colour bar, Pout contours per frequency at the
  Pout limits (dotted min, dashed middle, solid max), the measured boundary,
  the starred optimum and legends. Copy chart copies the whole figure.
  Limits, frequencies and delay apply with an Apply key that shows a
  spinner while the area is worked out in a background worker; both tabs
  stay mounted, and returning to the area with nothing changed does not
  work it out again. While it works -- on Apply and on first load -- a
  frosted "Working out the areaÃ¢â‚¬Â¦" capsule takes the figure's title, which
  steps aside, while the figure softens behind it, and Apply carries a new activity indicator (in the UI kit);
  both show at once and stay at least 450 ms, so a quick result is still
  seen to have happened -- for every change the operator makes (Apply,
  Frequencies, Contours, Colour), cached answers included. The Frequencies
  switch applies at once; the limits and the delay wait for Apply.
- Working area: Contours and Colour choices (Pout, Icc or Efficiency) in
  the dialog's strip. The contours trace the chosen quantity at its limits,
  the region is coloured by the chosen one (worst case across frequencies),
  and the colour bar, legends and title follow.
- The Smith chart's Points tab is drawn like the working area: the labelled
  grid (shared by both), hairline paths, and efficiency in the same bands,
  with a banded scale under the chart.

### Changed
- Faster UI. On the Smith chart, hovering a point redraws only that dot, its
  row and the point card (it redrew the whole dialog), and the title bar,
  point card and pickers no longer redraw for changes that are not theirs.
  Working-area results are cached by content, so reopening the dialog or
  going back to recent inputs shows them at once; the worker keeps its last
  two grid sets. App-wide, the log is split so a log line re-renders only
  the log panel rather than every page, and saves itself once lines pause;
  and at start-up the page on screen mounts first, the rest one at a time
  when the browser is idle.
- Pages publish to the assistant through a registration-only context, and a
  chat status poll that finds nothing new changes nothing: each poll (every
  20 s, 2 s while cooling) and each page mounting used to re-render every
  page. Trombone, switch and VNA status is polled only while a page that
  shows it is on screen (the Load Pull pages also mid-run), not twice a
  second from hidden pages.
- The assistant is switched off until it is built out (one flag in
  ChatContext): no /chat/status polling and no page data gathered for it.
- The trombone's identity in the Instruments dialog no longer carries its
  position: it changed every refresh while the trombone moved, re-rendering
  every page every 5 s through a run.
- LTE channel fields (LTE CW and LTE Modulated, single channel and sweep rows)
  name the value that does not resolve and its bands instead of a bare "In
  more than one selected band": "707.5: in bands 12, 17, 28 +2 more", or
  "1880: band 2 or 25, not selected". Load Pull's channel line uses the same
  wording, now shared (`channelIssues` in lib/earfcn).

## [1.1.0] - 2026-11-03

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
  reads it on (Ã‚Â±0.5 %, 897.79-906.81 MHz for 902.3), so what a point
  measures can be seen on the VNA before running. It leaves the RF switch
  where it is.
- Network Analyzer: "To path loss" (Marker readings, S21 tab) writes the last
  S21 sweep's markers into the path loss table, one row per marker at its
  frequency with the loss as a positive dB (S21 Ã¢Ë†â€™20.5 dB Ã¢â€ â€™ 20.5). A table
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
- LTE Load Pull Test (LTE Ã¢â€ â€™ Load Pull Test): the Load Pull run keyed with LTE
  CW instead of LoRa. Channels in the LTE pages' unit (EARFCN or MHz, within
  the selected bands), 0Ã¢â‚¬â€œ23 dBm, no PA mode. The modem is turned on at the
  start of the run (off, then on) and off once every cycle is done, or the
  run is stopped or fails; each point is a CW START, settle, read and ABORT. Same page as
  LoRa's with its own saved settings. The workbook's Run sheet names the
  radio, and LTE files are named `Ã¢â‚¬Â¦_lte-load-pull_Ã¢â‚¬Â¦`.
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
  outside the sensor's range, Ã¢Ë†â€™25 to +15 dBm, and its tooltip gives the raw
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
  read an older row during a run stops the jump back down, and a "Ã¢â€ â€œ N new
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
  answer from 172.16.10.1:5555 Ã¢â‚¬Â¦") instead of a bare "timed out".
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
- Load Pull reads the VNA on a span of Ã‚Â±0.5 % around each frequency (995Ã¢â‚¬â€œ1005
  MHz for 1000 MHz), one sweep per frequency per position, instead of on
  whatever span the analyzer was left at, where a marker snapped to a sweep
  point up to MHz away. Each span change waits one settle before the read,
  so a position now costs one settle per frequency.
- LTE Load Pull names the channels the selected bands cannot resolve and the
  band each needs ("725, 747.9 (band 28) Ã‚Â· 1930 (band 1 or 65)"), and has an
  Edit bands key, instead of only counting them.
- No em dashes in toasts or tooltips (run-complete toast, import errors and
  notices, meter info results, field validation, the Measurement card's
  failure tooltip, the Mode Sweep chart). Empty-value dashes are unchanged.
- Load Pull: the trombone cards' controls fill the card instead of stopping
  at 232 px with empty card to their right.
- Load Pull (LoRa and LTE): the attenuator sweep is one Att values field
  taking the same specs as DUT power, whole dB within 0Ã¢â‚¬â€œ20: a range
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
- Readout tiles show an empty value instead of a "Ã¢â‚¬â€" when there is no
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

[Unreleased]: https://github.com/YossiAbutbul/test-console/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.3.0
[1.2.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.2.0
[1.1.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.1.0
[1.0.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.0.0
