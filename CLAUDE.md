# Working on this repo

## Branching

There is no `dev` branch. Work lands on `main`.

- **By default, commit straight to `main`.**
- **Only when the operator asks for a branch**, create a feature branch off
  `main` (e.g. `feat/<name>`), do the work there, and merge it back into
  `main` when told to.
- Do not reintroduce a long-lived integration branch without being asked.

## Committing

- Commit only when asked. Push only when asked.
- Run the checks first and report the real result:

```bash
.venv\Scripts\python.exe -m pytest -q
cd frontend; npx tsc -b; npm test; npx eslint src
```

- ESLint has a standing baseline of pre-existing errors. Compare against it
  rather than treating a non-zero count as a regression; only new errors matter.
- Say what was left out or is still failing. Do not report a task complete on a
  suite that did not pass.

## Running the app

Use the **"Backend"** launch config (no `--reload`) or a terminal:

```bash
.venv\Scripts\uvicorn.exe backend.main:app --timeout-graceful-shutdown 3 --port 8000
```

```bash
cd frontend; npm run dev
```

`--reload` spawns the worker under the base interpreter rather than the venv,
which loses the instrument wrappers and makes VISA fail with
`VI_ERROR_LIBRARY_NFOUND`. The interpreter must be spelled out — a bare
`python` picks up whichever is first on PATH.

**Backend changes need a restart.** Without `--reload` nothing is picked up
until the process is restarted, and a stale process is the usual explanation for
a route answering 404/405/422 or an instrument failing to enumerate.

## The rig

Hardware is attached and live. Treat anything that moves the trombone, keys the
PA, or drives the RF switch as a real-world action:

- Do not start a run, transmit, or move the motor without being asked to.
- Read-only checks — status endpoints, discovery, reading a workbook — are fine.
- Instrument sessions are exclusive. Two callers on one VISA session desync it,
  which is why every instrument route goes through its per-instrument bus.

## Conventions worth keeping

- Comments explain **why**, especially where the code looks odd — most of them
  record a specific failure that shaped it. Do not delete one without knowing
  what it was protecting against.
- A page is one file per test under `frontend/src/tests/<id>/`, composed from
  the shared kit in `frontend/src/ui/`. Prefer extending the kit over inventing
  a local variant.
- Constants that must agree across the stack (settle floor, sweep ranges, path
  loss) are defined once per side with each pointing at the other.
