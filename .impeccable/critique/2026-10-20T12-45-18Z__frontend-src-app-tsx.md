---
target: shell + LoRa CW, Mode Sweep, Load Pull, LTE CW, Instruments, DC Analyzer
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\RF\\Documents\\GitHub\\test-console\\.claude\\worktrees\\reverent-goldwasser-8aa000\\frontend\\src\\App.tsx"
target_fingerprint: "sha256:330b0fec5df4377bef22182e61f3c2bcf39beb2e1982dba3138d866750d49fd0"
target_path: "C:\\Users\\RF\\Documents\\GitHub\\test-console\\.claude\\worktrees\\reverent-goldwasser-8aa000\\frontend\\src\\App.tsx"
timestamp: 2026-10-20T12-45-18Z
slug: frontend-src-app-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent)

Target: shell + LoRa CW (Manual, Automation with results, Graph), Mode Sweep, Load Pull (+ Smith), LTE CW, Instruments panel, DC Analyzer. Baseline commit 026a66c. Screenshots: docs/design/shots/before/{mid,dark,light}/ at 1920x1080.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Status split over sidebar footer, an "any instrument" dot, a modal and 11.5px pills; FAIL-heavy run ends green "complete" |
| 2 | Match system / real world | 3 | Domain terms right; "Status: ok" beside Verdict, unlabelled "Disconnected" |
| 3 | User control and freedom | 3 | Stop/E-stop always there; Clear wipes results with no guard, between Import and Graph |
| 4 | Consistency and standards | 2 | Results actions in 3 orders, 3 Connect looks, per-page error styling, hand-built type |
| 5 | Error prevention | 2 | Transmit/move/power actions look like harmless ones; E-stop unlabelled next to Stop |
| 6 | Recognition rather than recall | 3 | Instrument state needs the modal; Load Pull blockers in a toast |
| 7 | Flexibility and efficiency | 2 | No Run/Stop/Send keys, no failures-only filter or jump-to-FAIL |
| 8 | Aesthetic and minimalist | 3 | Calm, but DUT row on every page, empty docked log, redundant ok column |
| 9 | Error recovery | 3 | Good FailureNote in modal; inconsistent elsewhere; gate unexplained |
| 10 | Help and documentation | 3 | Good guide, but it has to warn "complete ≠ passed" |
| Total | | 26/40 | Acceptable |

## Priority issues
1. [P1] End of run hides the verdict (useRunReporter.ts:106-110 green "complete" from transport errors only; tally only logged).
2. [P1] Bench status scattered and partly falsely reassuring or colour-only (Sidebar.tsx:296 any-connected dot; InstrumentsModal dot without word; pills 24px/11.5px).
3. [P1] Dangerous vs harmless actions look alike (Send/Run/Output On/Confirm path/Read share primary; Jog/Go to/VNA/PCB = Recapture/Speed; E-stop icon-only).
4. [P1] Gated and disabled states unexplained; opacity gate (App.tsx:97-117) drops contrast and makes Light disabled Run look live; inputs have no focus indicator (theme.ts focused border = hairline).
5. [P2] Results tables hard to scan (left-aligned numbers, no Δ column, 10px verdict, redundant ok column, header wrap at 1280).
6. [P2] Load Pull long scroll; blockers in a fading toast detached from steps.
7. [P2] DUT connection row on every page incl. Components (App.tsx:558).
8. [P2] Cross-page inconsistencies; PathLossChip is a filled warn surface (breaks Annunciator Rule); Smith chart hardcodes off-theme colours.

## Detector evidence
CLI detect: 0 findings (static scan does not read MUI sx). Browser overlay (Mid): power 2, power-sweep 7, load-pull 37, lte-cw 9, dc-analyzer 20. Rules: low-contrast, undersized-ui-text (10.5px eyebrows), tiny-text (11–11.5px), straggler, overused-font (FP), kicker-above-heading, nested-cards (likely FP).
Contrast failures: Mid textDim on paper 4.09; Mid data.bad on paper 4.00; MUI text.disabled on paper Light 2.68 (78 uses), Mid 4.22; Mid "Disconnected" chip 3.1.

## Persona red flags
Alex: no keyboard Run/Stop/Send; modal round-trip for instrument health; no failures filter; Clear next to Graph with no undo.
Sam: modal status dot colour-only; Smith rainbow ramp; chart series 2/3 red/green collide with FAIL/PASS; no input focus ring; 10px verdict.
Operator at 2 m: biggest text is page title "CW"; progress in a 14px button label; RF ON pill 11.5px; DUT drop shown as 13px footer word.

## Questions
- What would a page look like whose largest element is "RUNNING 7/18 · 3 FAIL · RF ON"?
- Should "complete" ever be green when Verdict contains a FAIL?
- Could a test page be one never-scrolling status strip with configuration in a drawer?
- If hazard keys were the only coloured fills, what would they look like?
