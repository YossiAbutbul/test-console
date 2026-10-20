# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

RF engineers and test operators working alone at an RF test bench. They know
dBm, settle time and path loss and do not want to read paragraphs. A session
runs for hours: they connect the DUT and instruments once, then run test
after test, reading, graphing and exporting results.

The console usually drives a **large monitor at the bench** (24–32"), placed
next to the instruments. During a run the operator steps away and glances at
the screen from one to two metres. A 1280 px laptop is the secondary case and
must still work.

At a glance, from that distance, they need to know:

- is the DUT connected;
- which instruments are up, and which are in error;
- is anything transmitting or powered (RF on, DC on, LTE TX, a run going);
- is the run going, how far it has got, and did it pass.

## Product Purpose

Test Console tests the power amplifier in a meter, the **DUT** (device under
test). It talks to the DUT over Bluetooth (Cat-M2 framed protocol), tells it
to transmit, and measures what comes out on bench instruments over VISA, USB
and serial. Each test page composes some subset of: send a DUT command, wait
(settle), measure, judge, record and export.

Success is a result the operator trusts: the right setting was transmitted,
the reading was taken at the DUT (path loss applied), the verdict is
unmistakable, and the export traces back to the unit, instruments and
settings it came from.

## Positioning

A single-operator desk tool built around one bench and one DUT family, not a
general instrument-control suite. It knows the DUT's command set and the
bench's cabling, so a test is "set the list, press Run, read the verdict"
instead of scripting instruments by hand.

## Operating Context

- **Bench instruments:** Mini-Circuits power sensor, Keysight N6705 DC power
  analyzer (powers the DUT and measures current), Keysight E5061B network
  analyzer, R&S FSC3 spectrum analyzer, signal generator, Arduino-driven RF
  switch (VNA / PCB path), Arcus trombone motor for load pull.
- **Tests:** LoRa CW (Manual and Automation), LoRa Modulated, LoRa Debug,
  Mode Sweep, Load Pull; LTE CW and LTE Modulated (Manual and Automation,
  with the Modem key). Components pages control each instrument directly.
- **Daily ritual** (Testing Guide, `docs/manual/testing-guide/`): cable the
  bench, connect instruments from the Instruments panel, power the DUT from
  Settings or the DC Analyzer page, scan and connect the DUT, enter path loss
  per frequency, then run tests. End of day: Stop anything transmitting, turn
  the LTE modem off, RF Off on the signal generator.
- **Common pattern on test pages:** Manual tab sends one setting and shows a
  measurement card (Target, Measured, Error, Current); Automation tab runs a
  list of settings, judges each PASS / FAIL / N/A against a tolerance, and
  fills a results table with Graph, Export and Import.
- **Exports:** CSV for LoRa/LTE automation, Excel workbooks for Mode Sweep
  and Load Pull, file names led by the DUT MAC address. The Log drawer is
  downloaded and attached to fault reports.

## Capabilities and Constraints

- **The rig is live.** These act at once, with no confirmation:
  - **transmit RF:** Send and Run on every test page, RF On on the Signal
    Generator page;
  - **move the trombone:** Move, Step, Go min/max (Trombone page); Jog, Go to
    Zero/End and Run (Load Pull);
  - **switch the RF path:** Go VNA / Go PCB (Switch page), VNA / PCB (Load
    Pull);
  - **power the DUT:** Output On (DC Analyzer), the supply switch in
    Settings, the LTE Modem key.
- **Some outputs latch:** a manual LoRa Send transmits until Stop; the LTE
  modem stays on until its key is turned off; disconnecting the signal
  generator does not switch its RF off. Live outputs must stay visible from
  every page.
- Load Pull has an always-available Emergency stop (motor, then run, then
  transmitter).
- Instrument sessions are exclusive; every instrument call goes through a
  per-instrument bus.
- "Complete" at the end of a run means every point was measured, not that
  every point passed.
- Results persist across page changes and reloads; Mode Sweep results are
  lost on backend restart.
- **Stack:** FastAPI backend; React 19 + MUI 6 + Recharts frontend with a
  shared UI kit in `frontend/src/ui/`. Three themes: Dark, Mid (default),
  Light (`frontend/src/theme.ts`).
- **Terminology** (use as written on screen): DUT, path loss, settle, PA
  Mode, PA Duty Cycle, HP Max, tolerance, verdict (PASS / FAIL / N/A),
  EARFCN, Modem key, Zero / End, Delta X, uncalibrated.

## Brand Commitments

Internal tool. Keep the name "Test Console". No logo, corporate palette or
typeface to honour.

## Evidence on Hand

- Operator Testing Guide: `docs/manual/testing-guide/` (and `.docx`).
- User manual: `docs/manual/Test-Console-User-Manual.docx`.
- Current screenshots of every page: `docs/manual/img/`.
- Architecture and conventions: `docs/architecture.md`, `CLAUDE.md`.
- Screenshots that show results use example data; real run data must come
  from the rig and is not to be fabricated as genuine.

## Product Principles

1. **Live is never quiet.** Anything transmitting, powered or moving is
   obvious from any page and from across the bench.
2. **Trust in the number.** Readings say what they are (at the DUT, path loss
   applied, uncalibrated when it is), in consistent units and precision.
3. **The verdict is the outcome.** A run's pass/fail result is unmistakable;
   "measured" and "passed" are never confused.
4. **Dangerous looks different.** Actions that transmit, move or power are
   visibly distinct from ones that only read, graph or export.
5. **One way of working.** Every test page behaves and reads the same, so an
   operator learns it once.

## Accessibility & Inclusion

- **Colour-blind safe (hard requirement):** status, live outputs and
  PASS / FAIL never rely on colour alone; each also carries text, shape or
  icon.
- Must read at one to two metres on a large monitor, and still work down to a
  1280 px laptop.
