---
name: Test Console
description: Anodized — the aluminium rack. Baseline captured before the impeccable redesign.
colors:
  ground: "#2E3236"
  panel: "#35393E"
  rail: "#24272B"
  log-well: "#26292D"
  hairline: "#41464B"
  ink: "#E4E7EA"
  ink-dim: "#A9AFB5"
  ink-quiet: "#A6ACB2"
  brushed-graphite: "#C6CED5"
  lamp-ok: "#58C07A"
  lamp-warn: "#E2A63F"
  lamp-bad: "#F7968F"
  lamp-off: "#5D646A"
  connect-fill: "#4CC17C"
  glyph-on-bright: "#1B1F23"
  series-1: "#6EA8FE"
  series-2: "#EDB04F"
  series-3: "#B49AF7"
  series-4: "#4CC9DE"
  series-5: "#F17FB6"
  series-6: "#C9A86A"
  series-7: "#AEB8C4"
  series-8: "#4FD1C0"
typography:
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
  section:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
  section-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.5px"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  eyebrow:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.5px"
  hint:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
  readout:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "24px"
    fontWeight: 600
    fontFeature: "tnum"
  stat-value:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  dense:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  chip: "4px"
  base: "6px"
  pill: "12px"
spacing:
  grid-gap: "8px"
  card-pad: "12px"
  tile-pad: "12px"
  main-gutter: "24px"
components:
  button-run:
    backgroundColor: "{colors.brushed-graphite}"
    textColor: "{colors.glyph-on-bright}"
    rounded: "{rounded.base}"
    height: "36px"
    width: "148px"
  button-stop:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    height: "36px"
    width: "96px"
  button-connect:
    backgroundColor: "{colors.connect-fill}"
    textColor: "{colors.glyph-on-bright}"
    rounded: "{rounded.base}"
    height: "36px"
    width: "120px"
  button-scan:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    height: "36px"
  button-emergency-stop:
    backgroundColor: "{colors.lamp-bad}"
    textColor: "#FFFFFF"
    rounded: "50%"
    size: "36px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    height: "36px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.base}"
    padding: "12px"
  stat-tile:
    backgroundColor: "{colors.panel}"
    typography: "{typography.stat-value}"
    padding: "10px 12px"
  status-chip:
    textColor: "{colors.lamp-ok}"
    typography: "{typography.dense}"
    rounded: "{rounded.chip}"
  live-pill:
    textColor: "{colors.lamp-bad}"
    rounded: "{rounded.pill}"
    height: "24px"
  sidebar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink}"
    width: "300px"
---

# Design System: Test Console

> Started as a baseline of the system at commit 026a66c, before the impeccable
> redesign on `new-design`; updated as each redesign pass lands (layout: the
> check course, bench lamps, no DUT row; simplify: no duplicate status, press
> feedback, system font, translucent top bar). Values in the frontmatter are the
> **Mid** theme, the default. Light and Dark values are in
> `.impeccable/design.json` (`colorMeta.*.modes`) and in
> `frontend/src/theme.ts`, which is the source of truth.

## Overview

**Creative North Star: "Anodized — the aluminium rack"**

The console is styled as a piece of bench equipment: aluminium panels a step
above their bezel, graphite keys, hairline rules and lamps. There is
deliberately **no accent hue**. Selection, focus and the Run button are
graphite and brushed metal, which leaves the ok / warn / bad triad as the only
colour on most screens — if something is coloured, a measurement or a link is
telling you something.

Density is tuned for information per screen rather than breathing room: 12 px
inside a panel, 8 px between panels, 36 px controls. Numbers are the content,
set in a monospace face with tabular figures; chrome around them is kept to
one hairline.

The three themes are **ambient light levels**, not arbitrary skins: Light for
daylight on the bench, Mid (default) for a lit lab, Dark for a dim room and
unattended overnight runs. Every semantic colour keeps its hue across the three
and shifts only lightness, so switching theme mid-shift never re-teaches what a
colour means.

**Key Characteristics:**
- Near-true grey neutrals with a faint cool cast (aluminium, not paper).
- Colour only for state: connection, live output, measurement verdict, data series.
- Flat hairline panels; shadows only on things that float.
- Monospace, tabular readouts; uppercase micro-labels above values.
- Bright fills carry near-black glyphs in Mid and Dark, as high-visibility
  controls do on hardware.

## Colors

A graphite-and-aluminium neutral field with three annunciator lamps and an
eight-hue series set reserved for charts.

### Primary
- **Brushed Graphite** (`brushed-graphite`): the "accent" that is not a hue.
  Fill of the Run button, selected sidebar item tint, focus. In Light it is a
  dark graphite (#3A4249) with white text; in Mid and Dark a light metal with
  dark text.

### Neutral
- **Bezel Ground** (`ground`): content background and top bar.
- **Panel Aluminium** (`panel`): paper for panels, inputs, the Stop / Scan /
  Config buttons.
- **Rack Rail** (`rail`): sidebar background and table header fill.
- **Log Well** (`log-well`): the recessed log drawer.
- **Hairline** (`hairline`): every border, divider and disabled fill.
- **Ink** / **Ink Dim** (`ink`, `ink-dim`): primary and secondary text.
- **Ink Quiet** (`ink-quiet`): the quietest text that is still read -- sub-lines,
  hints, units (MUI `text.disabled`). Set per theme to clear 4.5:1 on paper;
  MUI's translucent default was 2.7:1 on Light.

### Semantic (the lamps)
- **Lamp OK** (`lamp-ok`): connected, PASS, within tolerance, a lit Modem key.
- **Lamp Warn** (`lamp-warn`): marginal, uncalibrated path loss, a run in progress pill.
- **Lamp Bad** (`lamp-bad`): error, FAIL, RF / DC / LTE live pills, Disconnect, Emergency stop.
- **Lamp Off** (`lamp-off`): an unlit indicator.
- **Connect Fill** (`connect-fill`): the Connect button — green, a sibling of Lamp OK.

### Data series
- **Series 1–8** (`series-1` … `series-8`): blue, amber, violet, cyan, pink,
  ochre, slate, teal -- assigned in order and cycled. **No red and no green**:
  those are PASS and FAIL. Order is fixed across themes; only lightness shifts.
- **Efficiency ramp** (Smith chart): viridis-like, deep violet → teal →
  yellow, ordered by lightness so it reads in greyscale and to a red/green
  colour-blind eye.

### Where colour goes (colorize pass)
- **Verdict:** ✓ PASS green, ✕ FAIL red, always with the mark and the word. A
  FAIL row takes a faint red wash (9%) and its Δ dB turns red; no coloured
  edge.
- **Status column:** "ok" is neutral text; only an error is red.
- **Live outputs:** each pill carries its kind's glyph (antenna RF, power DC,
  tower LTE, play Run), so red there is "this is live", not "this failed".
- **Path loss uncalibrated:** an outlined amber chip with a warning glyph,
  never a filled amber block.
- **Instruments panel "Required":** outlined amber, not the Disconnect red.

### Named Rules
**The Lamp Rule.** Colour appears only when it means something the operator
must read: connection, live output, verdict, or a data series. No decorative
colour anywhere.

**The Annunciator Rule.** Warn is a lamp, never a surface or a button. Seeing
amber always means something wants attention.

**The Quiet Scan Rule.** Scan stays an outline. With no accent hue, Connect and
Run are the only filled controls, and a filled Scan would outrank both.

## Typography

**Body Font:** the platform's system face (`system-ui`; Segoe UI Variable on
the bench PC). Nothing is bundled, so every machine renders its own tuned UI
face instead of a named-but-missing Inter. The 26 px page title carries
-0.02em tracking; body text stays at 0.
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, monospace` (Consolas on Windows).

**Character:** a plain UI sans for labels and copy, with every measurement in
monospace so digits line up and read as instrument output.

### Hierarchy
- **Floor: 12 px.** Nothing in the UI is set smaller; the old 10–11.5 px
  eyebrows, chips and footnotes were raised to 12.
- **Title** (700, 26 px, 1.15): page title in PageHeader, with the section path
  (14 px, secondary, "LoRa · TX") on the same baseline after it -- never as a
  kicker above.
- **Section** (700, 17 px): section heading inside a page; dialog title.
- **Section title** (700, 12 px, 0.5 px tracking, uppercase): the label Section draws over a panel.
- **Body** (400, 14.5 px): MUI base size.
- **Label** (500, 13 px): field label above an input.
- **Eyebrow** (700, 12 px, 0.5 px tracking, uppercase): micro-label above a value.
- **Readout / Stat value** (mono 600, 24 px, tabular): the measurement itself;
  unit 13 px muted beside it.
- **Table heading** (600, 12.5 px) with its unit on a second line (12 px), so
  headers never wrap mid-label; numeric columns right-aligned.
- **Table number** (mono, tabular, right-aligned): every measured or set value
  in a results table (`NUM_CELL_SX`).
- **Verdict** (700, 12.5 px, with a ✓ / ✕ icon): PASS / FAIL; N/A in secondary.
- **Hint** (12 px) / **Dense** (600, 12 px) / **Micro** (12 px): helper copy, chip text, footnotes.

Tabular figures are on for the whole body, so counters ("11/18", "1m 12s")
and labels never shift width as they change.

### Named Rules
**The Mono Number Rule.** A measured or set value is monospace with tabular
figures; its unit is smaller and muted beside it (or under the column
heading in a table), and a column of them is right-aligned.

**The Twelve Floor Rule.** No text below 12 px. A label too small to read from
the bench is not a label.

## Layout

A three-column shell: a 300 px sidebar (232 px below a 1200 px window), the
content area, and an optional 340 px log drawer that docks on wide windows and
floats over content below 1200 px. The top bar is 56 px: a translucent
material (ground at 82 % with an 18 px backdrop blur and a hairline below),
solid under `prefers-reduced-transparency`.

The top bar holds the **DUT connection and its configuration** on every page,
always visible: device type, MAC, meter info, Scan, Connect, and
the default path loss (with the per-frequency table behind its icon). It is
left-aligned so status appearing on the right never moves it; on the right
sit the Instruments lamp (n/7), the live-output pills and the Log/Assistant
buttons, which are always shown. There is no page search. The DUT scan
time is a set-once value and lives in the Settings popover. Below 1600 px the
logo column shrinks to the logo and the status goes to its short form. The
log drawer carries its own tab strip inside the panel.

The sidebar footer holds the **DC supply** -- an Off/On latching key (a
hazard key while it would power the DUT) and the voltage -- beside the
Settings gear, so the supply is in view on every page.

Every test page opens with PageHeader (title + actions; the title never wraps -- when the two cannot
share a line the keys drop to their own line, right-aligned), then its **check
course**: a CheckRail of only what the top bar and header do not already
say -- Instruments · Path loss (Load Pull adds RF path · Test point ·
Trombone). DUT is the top bar's; Run's blocker is on the Run key itself.
Each step is a shortcut: Instruments opens the Instruments panel, Path loss
opens the per-frequency table, and a page step scrolls to its section. There
is no detail panel. Components pages have no course;
their InstrumentBar comes straight after the header. PageBody then
picks a width -- form 760, panel 900, grid 1040, full 1180, or fluid -- and
owns a container query so grids stack when *their* box runs out of room
rather than the window's. TwoCol splits config left / live results right and
stacks below two `minCol` columns.

Spacing rhythm: 8 px grid gap, 12 px panel padding, 24 px main gutter.

## Elevation & Depth

Flat by default. Panels, tiles and the sidebar are separated by 1 px hairlines
and tonal steps (ground → panel → rail), never by shadow. Only floating
surfaces lift: menus, popovers and the autocomplete list use
`0 10px 25px -8px rgba(0,0,0,0.18), 0 4px 10px -4px rgba(0,0,0,0.10)`.
Dialogs use MUI's default elevation with a larger radius.

### Named Rules
**The Flat Panel Rule.** Depth is reserved for things that float. A panel in the
page is a hairline and a tone, never a shadow.

## Shapes

Gently squared corners throughout (6 px base radius); chips tighter (4 px);
dialogs softer (12 px). Status dots are 8 px circles; the LatchingKey lamp is
an 8 px square with 2 px corners; live-output pills are full capsules. The
Emergency stop is the only round button in the app.

## Components

### Buttons
- **Shape:** 6 px radius, 36 px tall, no elevation, sentence-case labels.
- **Run / Send (primary):** Brushed Graphite fill, fixed width (148 / 96 px) so
  "Run" → "Running 3/40" does not reflow the header.
- **Stop:** outlined, left of Run (Stop then Run on every page).
- **Connect:** green fill; **Disconnect:** outlined once connected.
- **Scan / Config:** quiet outline.
- **Disabled:** hairline fill, dim text, no pointer events. A Run or Send held
  by the page's DUT gate (or Load Pull's first unmet check) says so on the
  button: "Needs DUT", "Needs RF path".
- **MiniAction:** 24 px text button for panel-heading actions (Add, Apply).
- **Press feedback:** no ripple. A pressed button scales to 0.97 (icon
  buttons 0.92) over 120 ms, on press rather than release; reduced motion
  drops the scale.

### Hazard keys
Every control that acts on the bench -- Send, Run, RF On, Output On, the
Modem key, Jog, Go to, Move/Step, VNA/PCB -- carries the glyph for what it
does (antenna = transmits, power = powers, arrows = moves the trombone, route
= switches the RF path) and, while enabled, a 1 px half-strength red ring
drawn inside the key (2 px at full strength read as too loud). Read-only actions (Graph, Export, Import, Read, Recapture) carry neither.
The safe way out (Stop, Output Off, RF Off) has no ring.

### Emergency stop
A labelled "E-STOP" key, 112 px, red fill with a darker inner ring, behind a
vertical divider at the left of the Load Pull header. Never disabled.

### The No-Shift Rule
**Nothing changes size when its state changes.** Header keys have fixed
widths that hold their longest label ("Running 312/616", "Stopping…",
"Disconnect"); a pending export keeps its label and swaps its icon for a
spinner; lamps, status chips and countdowns have fixed or floor widths; the
check course has no detail panel to open or close;
hint and footer lines are always present, with different words per state.
`docs/design/tools/layout-shift-check.cjs` measures it: connect the DUT on a
page and report any element that moved.

### LatchingKey
A key that holds its state with a lamp beside it ("Modem off" / "Modem on").
Labels state what *is*, not what a click does. When on, the lamp glows (two
rings) and the border tints green.

### Check rail (CheckRail / CheckStep / CheckMark)
A page's checks on one hairline strip, divided like a StatRow. Each step is a
mark, a 14 px label and a 12.5 px one-line summary; clicking opens the panel
or table that settles it, or scrolls to its section. The
mark's shape carries the state as well as its colour: filled disc with a tick
(done), filled amber disc with "!" (blocking), open amber ring with "!" (check,
does not block), open red ring with a cross (error), empty ring (not done yet),
spinner (in progress). Summaries drop out below a 760 px container before the
rail wraps. Sections no longer carry step numbers.

### Bench lamp
One 30 px outlined lamp in the top bar, Instruments n/7, which opens the
Instruments panel. Mark plus words, never a bare dot; ticked only with the
whole rig up.

### Verdict tally
Above every judged results table: "✓ 11 PASS" and "✕ 7 FAIL" as 16 px bold
framed counts, then N/A and "n of N measured". FAIL takes its red frame only
when it is above zero. The end-of-run modal leads with the same verdict
("LoRa CW: 7 of 18 FAIL", error severity); "complete" is kept for a run with
no tolerance, and says no verdict was given.

### Results actions
One order on every results panel: Graph (or Smith chart) · Export · Import,
a divider, then Clear -- the one action that throws results away, last and
apart.

### Status chip / dot
Dot + label chip used for every instrument and connection state: ok green,
busy amber (with spinner), off disabled grey, error red. Outlined on the
panel, never MUI's filled grey (coloured text on that fill failed AA).

### Live-output pills
30 px capsules (13 px bold) in the top bar for every live output (RF ON, DC
ON, LTE TX with countdown, Run). Red for radiating or powering, amber for a run. A pulsing dot,
click to open the controlling page.

### Panels (Section)
One heading rhythm, two looks: a bordered `panel` or a flat heading with a
bottom rule. Uppercase 12 px section title, optional step index ("1. Instruments"),
right-aligned actions, optional collapse.

### Stat tile / Stat row
Readouts sharing one hairline-divided surface. Eyebrow label, 20 px mono value
with a muted unit, one sub-line. Tone colours the value only (ok / warn / bad);
`off` greys it.

### InstrumentBar
The connection row at the top of each Components page: status chip, name +
model, the settings Connect will use (mono), Config dialog, Connect.

### Instrument error
One shape on every Components page (`InstrumentError`): an error glyph, a
13 px red title ("The instrument reported an error", or the classified
failure's title) and the detail in secondary text -- mono when it is the
instrument's own words, with a leading "RuntimeError: " dropped.

### Inputs
36 px outlined fields on panel paper, hairline border that does not change on
hover or focus, no floating label (label sits above via LabeledField),
browser autocomplete disabled everywhere.

### Tabs
DenseTabs at 36 px (page sub-tabs) or 28 px (in-panel view switch).

### Navigation (Sidebar)
Protocol tree (LoRa / LTE / Components) -- groups with no pages yet are not
listed -- and Settings. The Instruments panel opens from the top-bar lamp, not
a sidebar entry. Selected item: soft graphite tint and 600 weight. Footer:
DC supply key and voltage, Settings gear.

## Do's and Don'ts

### Do:
- **Do** take every colour from `theme.ts` palettes so all three themes move together.
- **Do** keep semantic hues constant across themes and shift only lightness.
- **Do** set measurements in mono with tabular figures and a muted unit.
- **Do** use bright fills with near-black glyphs in Mid and Dark.
- **Do** separate panels with a hairline and a tonal step.
- **Do** give a control one size for all its states (the No-Shift Rule).
- **Do** mark every bench-acting control as a hazard key.

### Don't:
- **Don't** introduce an accent hue for brand or decoration.
- **Don't** use warn as a surface or button fill.
- **Don't** fill Scan or any other secondary action.
- **Don't** put shadows on in-page panels.
- **Don't** hardcode colours in pages or charts; the Smith chart's grid, ink
  and ground now come from the theme like every other chart.
- **Don't** use red or green for a data series.
