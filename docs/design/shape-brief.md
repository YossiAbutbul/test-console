# Shape brief: the "check course" shell and test-page template

Confirmed by the operator on 2026-10-20. Chosen from three structures
(sketches in `.impeccable/mocks/decision/`, renders in `docs/design/shots/shape/`):
the **Preflight course, without numbers**. The palette stays Anodized; the
sidebar tree and the centred top-bar search stay as they are.

## Job and audience
A single operator at the bench, reading a large monitor from up to 2 m during
a run. On every test page they need, in order: what still blocks Run, what is
live, how the run is going, whether it passed.

## Direction
- Under the page title, every test page shows a rail of check steps:
  **DUT · Instruments · Path loss · Settings · Run**.
- **No step numbers anywhere.** Each step carries a status mark instead:
  - ✓ in a filled ring: passed;
  - ! in an amber ring: blocking;
  - ○ empty ring: to do.
- Every mark has a word and a one-line summary beside it (colour-blind safe).
- Finished steps fold to one summary line. The blocking step stays open, with
  its reason inline.
- The Run key names what blocks it ("Run · blocked by Path loss").
- Each page's rail shows only the steps it needs:
  - Manual pages: DUT, instruments, path loss.
  - Automation: adds Settings.
  - Load Pull: Instruments · RF path · Test point · Trombone · Run. This
    replaces its numbered sections and the fading "Before running" toast.
- **Top bar, every page:**
  - live-output pills (RF ON, DC ON, LTE TX, RUN), larger, each with a glyph,
    a word and its detail;
  - compact **DUT ●** and **Instruments n/7** lamps, so Components pages always
    show bench status.
- The DUT connection row moves into the DUT step: the same fields and
  controls, still on the page. On Components pages it is gone; the DUT lamp
  stands in.
- The opacity dimming of a gated page goes. The open, blocking DUT step
  explains why.
- `Section` step numbering ("1. Instruments") goes.

## Folded in from the critique (later passes)
- Hazard style for actions that transmit, move or power.
- Results verdict strip (✓ PASS / ✕ FAIL); an end-of-run modal that leads with
  the verdict.
- Right-aligned tabular numbers, units in a header sub-line, a Δ dB column.
- One results-action order: Graph · Export · Import · Clear.

## States
- Each step: passed, blocking, to do, error (an instrument failure, shown with
  its title and hint).
- A run in progress folds the setup steps and opens Results.
- On the Manual tab after Send, the measurement card leads.
- Long values (MAC, IDN, error text) truncate, with the full text in a
  tooltip.

## Constraints
- No behaviour changes: the same controls and backend calls, only moved and
  restyled.
- Kit first: a new `CheckRail` / `CheckStep` in `frontend/src/ui/`; `Section`
  gains a folded summary state.
- Dark, Mid and Light themes all kept (check Light first).
- Works down to 1280 px: the rail drops its summary lines before it wraps.
