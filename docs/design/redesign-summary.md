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

## Recommended but not done

- **Sweep rows at 1280 px with the log docked** still scroll sideways inside the panel. The fix is either a two-line row under a container query or floating the log on laptop widths. The second needs a decision, because the current shell breakpoint would also hide the sidebar.
- **Results graph:** a y = x reference line and a ± tolerance band, with failing points marked. This is new chart content, so it was out of scope for a presentation pass.
- **Smith chart:** efficiency uses a fixed 3.6 V. Using the measured supply voltage is a data change.
- **Fonts:** "Inter" is named in the font stack but never loaded, so the bench PC renders Segoe UI. Bundle Inter or drop it from the stack, so every machine matches.
- **Log drawer:** it docks open and empty on wide windows. Making it start closed is a behaviour default, so I left it.
- **Accessibility:** a screen-reader pass and 200 % zoom were not done (see `audit.md`).
- **Testing Guide and manual:** the text and the images in `docs/manual/img/` still describe the old design. Sections to rewrite:
  - "The row along the top of every page is for the DUT" (1.4);
  - "Path loss … at the top left" (1.5);
  - the round red Emergency stop;
  - "Before running" notice;
  - "Connection panel".

  Regenerate the images with `docs/manual/tools/capture-screenshots.cjs`, then rebuild the `.docx` files. Only the Smith-chart colour wording was updated during the redesign.
