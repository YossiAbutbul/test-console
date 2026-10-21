# Test Console redesign: summary

Done with the impeccable skill on the branch cut from `new-design`. The
passes ran in this order:

1. init (PRODUCT.md)
2. document (DESIGN.md baseline)
3. critique
4. shape
5. layout
6. typeset
7. colorize
8. clarify
9. harden
10. polish
11. audit

The work is presentation only: the same pages, tests, controls, data and
backend calls. Every pass was checked with:

- `tsc -b`;
- the 275 unit tests;
- ESLint at the 34-error / 2-warning baseline;
- pytest.

No control that transmits, moves the trombone, switches the RF path or powers
the DUT was pressed. Screenshots ran in throwaway browser profiles with
example data, and DUT and instrument state were mocked in the browser.

## Screenshots

- `docs/design/shots/before/` — the app at 026a66c, in Mid, Dark and Light, 1920 × 1080.
- `docs/design/shots/after/` — the same pages after the audit.
- `docs/design/shots/after-1280/` — laptop width, 1280 × 800.

Files are named per page. `*-connected` means the DUT is mocked as connected,
`*--full` is the full scroll height, and `live-rf` shows the RF ON pill.
`docs/design/shots/shape/` holds the three structures that were considered.
The intermediate per-pass sets were removed from the tree to keep it light;
they stay in git history at each pass's commit.

## What changed, and why

| Problem (critique) | Now |
|---|---|
| A run full of FAILs ended on a green "complete" | The end-of-run modal leads with the verdict: "LoRa CW: 7 of 18 FAIL" (error) or "all 18 PASS". The results panel opens with a ✓ PASS / ✕ FAIL tally. FAIL rows are tinted, and their Δ is red. |
| Status scattered: DUT in the sidebar footer, instruments behind a modal, small live pills | **Top bar on every page:** DUT and Instruments n/7 lamps, plus larger live-output pills with a glyph per kind (RF, DC, LTE, Run).<br>**Test pages:** a **check course** — DUT · Instruments · Path loss · Settings · Run — with each check's state as a mark plus words. |
| The DUT row on every page pushed content down | The row is gone. Its controls live in the DUT check (test pages) and the DUT lamp's popover (everywhere). Components pages start with their instrument bar. |
| Dangerous and harmless keys looked alike | Hazard keys (send/run, power, move, path) carry their glyph and a red ring while enabled. E-STOP is a labelled key. Safe exits and read-only actions have neither. |
| Results tables: wrapping headers, left-aligned numbers, no measured − set, weak FAILs | Units sit on a second header line, numbers are right-aligned tabular mono, there is a new Δ dB column, and the verdict is ✓ PASS / ✕ FAIL at 12.5 px. |
| Load Pull: a long scroll of five numbered steps and a fading "Before running" toast | A seven-step rail says which step blocks Run, Run names its blocker ("Needs RF path"), and the toast is gone. |
| Inconsistencies between pages | One results-action order (Graph · Export · Import \| Clear), one instrument-error shape, one Stop style, one table heading, and fonts and colours from tokens. |
| Text down to 10 px; contrast failures in Mid and Light | A 12 px floor. Mid secondary text, FAIL red and the quiet text tone were lifted to clear 4.5:1 on panels and FAIL rows. Chart series no longer use red or green, and the Smith chart uses a lightness-ordered ramp. |
| UI changing size on state changes (operator's rule) | Fixed-width keys, spinners in place of label changes, constant-width lamps and chips, and no panels opening or closing on their own. `docs/design/tools/layout-shift-check.cjs` measures 0 px movement on connecting the DUT. |

DESIGN.md records the resulting system. Its named rules are:

- Lamp
- Annunciator
- Twelve Floor
- Mono Number
- Flat Panel
- No-Shift
- hazard keys

## Simplify pass (after the operator's feedback)

Guided by the apple-design skill: show each fact once, and keep the parts that
are left responsive.

| Removed (said twice, or unused) | Why it went |
|---|---|
| Sidebar "Instruments" entry | The top-bar Instruments lamp opens the same panel. |
| Sidebar BLE "coming soon" group | It had no pages. |
| DUT, Settings and Run steps on the check course, plus the course's detail panel | The top bar shows the DUT, the Run key names its blocker, and settings are on the page. The steps that are left are shortcuts. |
| Path-loss chips and "power at the DUT = sensor + path loss" notes | The Path loss check and the top-bar field already show it. |
| DUT scan-time field in the top bar | Set once, so it is in Settings now. |
| Button ripple | Replaced by press feedback. |

| Added | Detail |
|---|---|
| Press feedback | Buttons scale to 0.97 and icon buttons to 0.92 on press, over 120 ms. Off under reduced motion. |
| System font | `system-ui` first (Segoe UI Variable on the bench PC). Titles have -0.02em tracking. |
| Top-bar material | 82 % ground with an 18 px blur and a hairline. Solid under reduced transparency. |
| One-line page title | When the title and the keys do not fit on one line (Load Pull at 1280 px), the keys drop to a line of their own, so the title no longer stacks three lines deep. |

Screenshots are in `docs/design/shots/simplify/`: `before` is e4b66d5 and
`after` is this pass, each at 1920 px and in `*-1280`. The layout-shift
check still measures 0 px.

## Inspector pass (apple-design, October 2026)

A full redesign on top of the passes above, which are kept as history: some of
what they added (the check course, the bench lamps, the live-output pills, the
hazard rings, units on a second header line) is gone again. DESIGN.md is
rewritten for this system.

| Area | Now |
|---|---|
| Shell | Full-height sidebar with foldable sections (Components too) and the DC supply in its footer; a translucent window toolbar that pages portal their title and keys into; a right **inspector** (Bench, Log, Assistant). Below 1200 px the sidebar and inspector float and close on click-outside or Escape. |
| Status | Each fact said once: the DUT, path loss and instruments live in the inspector's Bench tab. No live-output pills, no bench lamp, no check course; Load Pull keeps a compact "N of 6 connected" checklist. |
| Colour | One accent, system blue (`#0071E3` fill in every theme); grey secondary keys; the hazard ring retired, the glyph kept; E-Stop a red-tinted labelled key. |
| Controls | 32 px controls; filled field wells with a half-strength accent edge on focus; LatchingKey off in a translucent grey that reads on any surface; macOS-style menus, switches and sliders; press feedback; reduced motion honoured by the theme. |
| Tables | Units inline in `[brackets]`, everything left-aligned, a narrow `#` column, an empty table drawn blank; PASS / FAIL tally counts filter the rows. |
| Instruments dialog | One panel per group with hairline rows, status dots, a one-line status with model and serial, Re-scan inside the address field, one key per row. |
| Load Pull | The trombone step as three cards — Move trombone, Controls, Sweep bounds — with the shared JogPad. |
| Trombone page | Travel bar removed; hold-to-jog with Slow / Medium / Fast added (its own hook, so soft limits set elsewhere are not touched). |
| LTE | MHz is the default channel unit and listed first; RB fields named "Number of RB allocation" and "Position of RB allocation". |
| Settings | "Select text on focus", off by default. |

The only behaviour changes were the ones the operator asked for: the tally
filter, the hold-to-jog on the Trombone page, the select-on-focus setting
(and its default), and MHz as the default LTE unit. Checks at the end:
`tsc -b`, the 275 unit tests, pytest, and ESLint at its 33-error / 2-warning
baseline.

## Recommended but not done

- **Sweep rows at 1280 px with the log docked** still scroll sideways inside the panel. The fix is either a two-line row under a container query or floating the log on laptop widths. The second needs a decision, because the current shell breakpoint would also hide the sidebar.
- **Results graph:** a y = x reference line and a ± tolerance band, with failing points marked. This is new chart content, so it was out of scope for a presentation pass.
- **Smith chart:** efficiency uses a fixed 3.6 V. Using the measured supply voltage is a data change.
- **Fonts:** done in the simplify pass — the stack now starts at `system-ui`, with no named-but-missing Inter.
- **Log drawer:** superseded — the log is a tab of the inspector now.
- **Accessibility:** a screen-reader pass and 200 % zoom were not done (see `audit.md`).
- **Testing Guide and manual:** the text and the images in `docs/manual/img/` still describe the old design. Sections to rewrite:
  - "The row along the top of every page is for the DUT" (1.4);
  - "Path loss … at the top left" (1.5);
  - the round red Emergency stop;
  - "Before running" notice;
  - "Connection panel".

  Regenerate the images with `docs/manual/tools/capture-screenshots.cjs`, then rebuild the `.docx` files. Only the Smith-chart colour wording was updated during the redesign.
