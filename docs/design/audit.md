# Audit — Test Console redesign (impeccable audit)

Run 2026-10-21 on branch `claude/reverent-goldwasser-8aa000`, after the polish
pass. Everything here was measured in headless Chrome against the dev build,
with example data. `/ble/status` was answered "connected" in the browser and
every other DUT call refused. No instrument control was pressed.

The probes are in `docs/design/tools/`:

- `audit-probe.cjs` — runs the impeccable detector on each page, checks
  target sizes and viewport overflow, walks the tab order, and times a
  2000-row results table;
- `layout-shift-check.cjs` — connects a mocked DUT and checks that nothing on
  the page moves;
- `capture-redesign.cjs` — the screenshots.

## Audit health score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | AA contrast met on 7 pages × 3 themes. The only findings left are disabled controls, which are exempt. Every tab stop shows focus. Screen-reader pass not done. |
| 2 | Performance | 3 | A 2000-row results table renders with the app (~3.5 s from a cold load) and scrolls at 60 fps (median 16.7 ms per frame). It is not virtualised. |
| 3 | Theming | 4 | Every colour comes from `theme.ts`. Outside it there are only shadow tints, the setup diagram's white plate and one chat tint. |
| 4 | Responsive | 3 | No viewport overflow at 1280 × 800. With the log docked, LoRa CW and Modulated sweep rows scroll sideways inside their panel. |
| 5 | Implementation integrity | 4 | Detector clean on source. Kit components own every shared pattern. The layout-shift check moves 0 px. |
| **Total** | | **17/20** | **Good** |

## Implementation integrity verdict

**Pass.** The pages are composed from one kit (`frontend/src/ui`):

- the check course;
- hazard keys;
- `HeadCell`, `NUM_CELL_SX`, `VerdictMark` and `VerdictTally`;
- `InstrumentError`;
- one set of tokens.

The detector reports no findings on source. In the rendered pages it reports
only:

- `overused-font` — intentional; the system uses one family;
- `nested-cards` — the readout strips inside instrument panels, a deliberate
  instrument pattern.

## Fixed during this audit

| Finding | Where | Fix |
|---|---|---|
| Mid: secondary text 4.1:1 and red Δ 4.3:1 on a FAIL row's wash | results tables | FAIL wash 9 % → 6 %; Mid `textDim` #A0A6AC → #A9AFB5; Mid bad #F58A82 → #F7968F; Mid `textDisabled` → #A6ACB2 |
| Dark: secondary text 4.0–4.3:1 on tinted surfaces | theme | Dark `textDim` #838A90 → #8E959B; `textDisabled` → #8A9197 |
| Status chips 2.8–3.1:1 in Mid, 4.2–4.49:1 in Light ("Disconnected", "Idle") | `ui/Readout` StatusChip | outlined on the panel instead of MUI's filled grey |
| Open check step: summary 4.1:1 on its selected tint | `ui/CheckRail` | the open step's summary uses primary ink |
| "coming soon" protocol at 3.8:1 in Light (50 % opacity on a clickable row) | Sidebar | quiet by colour (`text.disabled`) instead of opacity |
| Copy-MAC button had no accessible name | DUT controls | `aria-label`, 26 px target |
| Search box: focus visible only as a border change | SearchBar | 2 px focus ring |
| Targets under 24 px: Load Pull clear-capture (20 px), EARFCN/MHz toggle (20 px), copy/nickname icons (22 px) | Load Pull, SegmentedChoice, DUT controls | 28 / 24 / 26 px |
| Capture / Recapture changed the key's width | Load Pull | fixed 112 px (No-Shift Rule) |
| 1280 px: search placeholder squeezed to "Searcl"; results note wrapping to two lines | SearchBar, results panels | shortcut hint hides in a narrow bar; note truncates, full text in a tooltip |

## Open findings

- **[P2] Sweep rows scroll sideways at 1280 px with the log docked.**
  - Where: LoRa CW and LoRa / LTE Modulated automation.
  - Cause: the panel is 552 px there; the rows need 616 (CW) to 868 px (Modulated).
  - Current behaviour: in-panel horizontal scroll, which is by design (see `MIN_TABLE_W`).
  - Options: wrap the row into two lines under a container query, or float the log drawer on laptop widths. The breakpoint is `SHELL_NARROW_W`. Raising it also hides the sidebar by default, so it needs a decision.
  - Command: `/impeccable adapt`.
- **[P2] Mode Sweep range-slider thumbs are about 14 px.**
  - The probe flags their hidden 7 px inputs; the visible thumb is MUI's.
  - The number fields beside each slider are full-size alternatives, so WCAG 2.5.8's equivalent-control exception applies.
  - Command: `/impeccable adapt`.
- **[P3] Results tables are not virtualised.**
  - At 2000 rows they still scroll at 60 fps; Mode Sweep's 616-step default is well inside that.
  - Recommendation: virtualise only if runs of 5,000+ points become normal.
  - Command: `/impeccable optimize`.
- **[P3] The log drawer's download and clear icons are disabled when the log is empty.**
  - They are at 2.0–2.8:1, which is exempt as disabled.
  - Command: none needed.
- **[P3] Not done: screen-reader pass, 200 % zoom, touch.** The bench is mouse and keyboard.

## Positive findings

- Every state carries a glyph or word as well as colour: check marks, verdict marks, live-output glyphs and the Instruments panel words. This meets the colour-blind requirement in PRODUCT.md.
- Tab order follows the visual order: search → lamps → sidebar → header keys → check course → DUT controls → tabs → fields. There are no traps.
- `prefers-reduced-motion` stops the live-pill pulse.
- Nothing changes size on a state change. The shift check measures 0 px for title, keys, rail, tabs, panels, lamps and the sidebar footer.
