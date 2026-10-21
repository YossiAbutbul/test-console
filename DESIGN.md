---
name: Test Console
description: Inspector — a macOS-style instrument app. Sidebar, window toolbar, inspector; one blue accent.
colors:
  ground: "#2F2F33"
  paper: "#3B3B40"
  toolbar: "#313135"
  sidebar: "#28282C"
  hairline: "#505055"
  ink: "#F2F2F7"
  ink-dim: "#C2C2C8"
  ink-quiet: "#A6A6AC"
  accent: "#5AA9FF"
  accent-fill: "#0071E3"
  on-accent: "#FFFFFF"
  key-grey: "#4A4A50"
  lamp-ok: "#4CD26A"
  lamp-warn: "#FFB54A"
  lamp-bad: "#FF8F88"
  lamp-off: "#5E5E63"
  disconnect-bg: "#4A3130"
  series-1: "#4DA3FF"
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
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  dialog:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
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
    fontWeight: 600
  hint:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
  readout:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "24px"
    fontWeight: 600
    fontFeature: "tnum"
rounded:
  control: "8px"
  field: "7px"
  menu-row: "6px"
  card: "12px"
  dialog: "14px"
spacing:
  grid-gap: "12px"
  card-pad: "16px"
  tile-pad: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.key-grey}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
  button-disconnect:
    backgroundColor: "{colors.disconnect-bg}"
    textColor: "{colors.lamp-bad}"
    rounded: "{rounded.control}"
    height: "32px"
  input:
    backgroundColor: "rgba(118,118,128,0.18)"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "32px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "16px"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.ink}"
    width: "240px"
---

# Design System: Test Console

> Rewritten for the Inspector redesign (October 2026). Values in the
> frontmatter are the **Mid** theme, the default; Light and Dark are in
> `frontend/src/theme.ts`, which is the source of truth for every colour, and
> `frontend/src/ui/tokens.ts` for sizes. The earlier "Anodized" system this
> replaces is in git history before commit `fd51a2e`.

## Overview

**Creative North Star: "Inspector — a Mac instrument app"**

The console is laid out like a macOS document app: a full-height **sidebar**
of pages, a translucent **window toolbar** with the page's title and its keys,
the page itself in the middle, and an **inspector** on the right holding what
is true on every page (the DUT, path loss, the instruments, the log). One
accent — system blue — marks the primary key and what is selected; everything
else is a grey key on a white (or graphite) card.

Numbers are the content: every measurement is monospace with tabular figures,
its unit muted beside it. Chrome around them is one hairline, and nothing on
screen changes size when its state changes.

The three themes are ambient light levels: **Light** for daylight on the
bench, **Mid** (default, graphite) for a lit lab, **Dark** for a dim room and
overnight runs. Semantic colours keep their hue across all three and shift
only lightness.

**Key characteristics:**
- One accent hue, system blue: the filled primary key is `#0071E3` in every
  theme (white on it clears 4.5:1); text and selection use a per-theme blue.
- Colour for state only: connection, verdict, warning, data series.
- Grey keys, grey field wells, white cards; shadows only on what floats.
- Every icon is a Material *Rounded* glyph.
- The platform's own UI font; no bundled face.

## Colors

### Accent
- **Accent fill** (`accent-fill`, `#0071E3`): Run / Send, Connect, an "on"
  LatchingKey, a selected segment's text. One filled accent key per view.
- **Accent** (`accent`, per theme: `#0066CC` Light, `#5AA9FF` Mid, `#4DA3FF`
  Dark): text buttons, links, selection, the focused field's edge (at half
  strength), the page glyphs in the sidebar.

### Neutral
- **Ground** (`contentBg`): behind the cards.
- **Paper**: cards, dialogs, the inspector.
- **Toolbar**: the ground at 80 % with a 20 px blur, so content scrolls under it.
- **Sidebar**: the page list, a step off the ground.
- **Key grey** (`actions.scan`): every secondary key — Stop, Scan, Read,
  Capture, an "off" LatchingKey.
- **Ink / Ink dim / Ink quiet**: primary, secondary and the quietest text
  still meant to be read (units, sub-lines), each clearing 4.5:1 on paper.

### Semantic (the lamps)
- **OK** green: connected, PASS, within tolerance.
- **Warn** amber: Required-but-missing, uncalibrated path loss, marginal.
  An annunciator: text, a dot or a faint wash, never a key.
- **Bad** red: error, FAIL, Disconnect's text, E-Stop.
- **Off** grey: an unlit status dot.

### Data series
Eight hues — blue, amber, violet, cyan, pink, ochre, slate, teal — assigned
in order and cycled. **No red and no green**: those are PASS and FAIL. The
Smith chart's efficiency ramp is viridis-like, ordered by lightness.

### Named rules
**The One Accent Rule.** Blue is the only hue that is not a state. One filled
blue key per view; everything else secondary is grey.

**The Annunciator Rule.** Amber always means something wants attention, so it
is never a surface or a button fill.

## Typography

**Body:** `system-ui` (Segoe UI Variable on the bench PC). **Mono:**
`ui-monospace, SFMono-Regular, Menlo, monospace`. Tabular figures app-wide.

### Hierarchy
- **Floor: 12 px.** Nothing is set smaller.
- **Page title** (700, 15 px, −0.01em) in the window toolbar, with the
  sidebar section (12 px, secondary) under it.
- **Card title** (600, 15 px, −0.01em, sentence case) on a Section.
- **Dialog title** (700, 17 px).
- **Body** 14.5 px · **Field label** 500 13 px · **Eyebrow** 600 12 px ·
  **Hint** 12 px.
- **Readout** (mono 600, 24 px, tabular) for a measurement; unit 13 px muted.
- **Table heading** 12.5 px with its unit inline in brackets — `Power [dBm]` —
  on one line; every column left-aligned; numbers mono and tabular.

**The Mono Number Rule.** A measured or set value is monospace with tabular
figures and a muted unit.

## Layout

The shell (`App.tsx`):
- **Sidebar**, full height, 240 px (224 px below a 1200 px window). The app
  name and the Settings gear at its top; foldable sections LoRa / LTE /
  Components, each row a page glyph and its name; the **DC supply** key and
  voltage in its footer.
- **Window toolbar**, 52 px, translucent (the ground at 80 %, 20 px blur and
  180 % saturation; solid under `prefers-reduced-transparency`). Three slots that
  pages portal into (`ui/toolbarSlot.ts`): the page title, the page's keys,
  and the bar the run progress draws on. The inspector toggle sits at its
  right end.
- **Inspector**, a right drawer with a segmented switch **Bench | Log |
  Assistant**. Bench holds the DUT connection, the path loss (Default field
  and the calibrated frequencies) and the instruments list with **Manage**.
- **Below 1200 px** the sidebar and inspector float over the page and close
  on click-outside or Escape; the app logo in the toolbar toggles the sidebar.

Pages are one file per test under `frontend/src/tests/<id>/`, composed from
the kit in `frontend/src/ui/`. A page opens with **PageHeader** (which portals
into the toolbar), then **PageBody**, which picks a width — form 760, panel
900, grid 1040, full 1180, or fluid — and owns a container query so grids
stack when *their* box runs out of room. **TwoCol** splits config and live
results; **FieldGrid** lays out labelled fields (its `lead` option widens the
first column for a long hint).

Spacing: 12 px between cards, 16 px inside a card, 12 px inside a tile.

## Elevation & depth

Cards are flat: paper, a 1 px divider and a 12 px radius. Only floating
surfaces lift — menus, popovers, the autocomplete list and dialogs — with a
soft two-layer shadow. Dialogs open just below the toolbar, fade in with a
small scale, over a light scrim.

**The Flat Card Rule.** Depth is for things that float. A card in the page is
a hairline and a tone.

## Shapes

Controls 8 px, fields 7 px, menu rows and chips 6 px, cards 12 px, dialogs
14 px. Status dots are 8 px circles.

## Motion

- **Press:** no ripple; a pressed key scales to 0.97 on pointer-down
  (`PRESS_SX`), icon keys likewise.
- **Menus and selects** settle out of their field: a short fade with a 3 %
  scale and 4 px drop from the top edge; the chevron rotates on open.
- **Reduced motion** (`prefers-reduced-motion`): the theme replaces every
  transition with none; programmatic scrolls jump.

## Components

### Keys (buttons)
- 32 px tall (`CONTROL_H.md`), 8 px radius, sentence case, no elevation.
- **Fixed widths** (`ACTION_W` 96 / 120 / 148 / 176) so "Run" → "Running
  3/40" → "Needs DUT" never moves a neighbour.
- **Primary** (Run, Send, Connect): accent fill. **Secondary**: key grey.
  **Disconnect**: red text on a red-tinted grey.
- **Disabled:** one look for every variant, primary included: a faded grey
  key with greyed words, no hover and no pointer. A disabled Run/Send says
  why on the key ("Needs DUT") rather than in a tooltip.
- **MiniAction:** 28 px text key for card-heading actions; `tone="destructive"`
  for Clear.
- **Header order:** Stop, then Run/Send; Clear is always last and apart.

### Hazard glyphs
Every control that acts on the bench carries the glyph for what it does —
antenna (transmits), power (powers), arrows (moves the trombone), route
(switches the RF path). The red ring that used to surround them is retired
(`hazardRingSx` is a no-op); the glyph is the mark.

### E-Stop
A red-tinted "E-Stop" key (disconnect colours, 600 weight) at the left of
the Load Pull header; tooltip "Stops motor, run and RF". Never disabled.

### LatchingKey
A key that holds its state ("Off" / "On", "Modem off" / "Modem on"). Off is a
translucent grey (so it reads on the sidebar as on a card), on is the accent
fill. One width for both states; a spinner in place of the glyph while the
request is pending. Labels state what *is*, not what a click does.

### Inputs
- Filled wells: a translucent grey (8 % Light, 18 % Mid/Dark), no border,
  a little darker on hover.
- **Focus:** the well keeps its fill and gains a 1 px accent edge at half
  strength. No outer ring.
- **Error:** a red edge. **Disabled:** a fainter well, greyed text.
- 32 px tall, 7 px radius; the label sits above (LabeledField), never
  floating; label and hint stay on one line and the hint truncates.
- Number fields have no spinners. Browser autocomplete is off everywhere.
- **Select text on focus** is a setting (Settings popover), off by default;
  every field reads it through `lib/selectOnFocus.ts`.

### Selects and menus
Rows 28 px, pointer cursor, hover the accent fill with its text white; the
selected row's ✓ sits at the right and turns white with the row.

### SegmentedChoice / DenseTabs
A grey track with a white raised thumb for the selected segment. One weight
for every segment; `fullWidth` divides the track evenly.

### Status
- **StatusChip:** dot + word, outlined (`plain` drops the outline for a card
  header that already carries a reading). ok green, busy amber with a
  spinner, off grey, error red.
- **Status dot:** 8 px, the same colours, used in the inspector's instruments
  list and the Instruments dialog. Always beside the state in words.

### Instruments dialog
One white panel per group (RF measurement, DC supply, …) on a grey ground,
rows divided by hairlines, as in System Settings. A row is: status dot, name,
a one-line status ("Connected · N6705B · serial · firmware", "· Required" in
amber with a faint amber wash when the test needs it), the address field with
Re-scan inside its right end, and one Connect/Disconnect key. Footer:
Connect all / Disconnect all.

### Tables
Headers carry their unit in brackets on one line; content left-aligned; a
narrow `#` column; numbers mono. An empty table shows its header and a blank
body, not a placeholder. **Verdict tally** above a judged table: "✓ N PASS",
"✕ N FAIL" — each a filter key for the rows.

### Stat tiles
Readouts sharing one hairline-divided surface: eyebrow, mono value with a
muted unit, one fixed-height sub-line.

### JogPad
The trombone's press-and-hold jog (`ui/JogPad.tsx`), shared by Load Pull and
the Trombone page: ← "Hold to jog" →, focusable so the arrow keys jog; blur
or release stops. A Slow / Medium / Fast SegmentedChoice beside it sets the
speed.

### The No-Shift Rule
**Nothing changes width or height when its state changes.** Keys have fixed
widths; readouts use tabular figures and reserved widths; hint and plan lines
keep their space when empty; a pending action swaps its glyph for a spinner
in place. `docs/design/tools/layout-shift-check.cjs` measures it.

## Do's and don'ts

### Do
- **Do** take every colour from `theme.ts` so the three themes move together.
- **Do** keep one filled accent key per view.
- **Do** set measurements in mono with tabular figures and a muted unit.
- **Do** give a control one size for all its states.
- **Do** extend the kit in `frontend/src/ui/` rather than styling a local variant.
- **Do** use `*Rounded` Material icons.

### Don't
- **Don't** add a second accent hue.
- **Don't** use amber as a surface or a key.
- **Don't** put shadows on in-page cards.
- **Don't** hardcode colours in pages or charts.
- **Don't** use red or green for a data series.
- **Don't** let a status line wrap a row taller; truncate with a tooltip.
