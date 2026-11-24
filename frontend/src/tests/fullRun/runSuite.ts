/**
 * A test sequence: several tests, one after another, from one click.
 *
 * Pure -- no React, no requests of its own. What a step does to the rig is
 * `runStep`'s business (a sweep through `runSweep`, later a backend run);
 * this decides the order, the re-cabling pauses, and what Stop and a failure
 * mean for the steps still to come.
 *
 *  - Strictly one step at a time: the backend refuses a second run of its own
 *    (409), and two sweeps on one VISA session would desync it.
 *  - Before a step whose setup differs from the bench's, the run waits for the
 *    operator to re-cable (`confirmSetup`). Two steps in a row on one setup
 *    do not ask twice; nor does the first step, if the bench is already on it.
 *  - A step that measured and missed its limits is a result: the run carries
 *    on. A step that throws -- a modem that will not restart, a DUT that did
 *    not come back -- ends the run, because the next step would meet the same
 *    DUT.
 *  - Stop aborts the step in flight and answers an open prompt; every step
 *    after it is "not run".
 */
import type { SetupId } from '../engine/sweepTest'

export type StepVerdict = 'pass' | 'fail' | 'na' | 'error' | 'stopped' | 'not-run'

/** How one step ended. */
export interface StepOutcome {
  verdict: StepVerdict
  pass: number
  fail: number
  /** Points measured. */
  measured: number
  /** Points planned. */
  planned: number
  /** Points whose measurement failed. */
  errors: number
  ms: number
  /** Why the step ended the run, for `error`. */
  message?: string
}

export interface SuiteStep {
  uid: string
  setup: SetupId
}

/** Where the run is, for the page. */
export type SuiteState =
  | { kind: 'running'; index: number }
  | { kind: 'recable'; index: number; from: SetupId | null; to: SetupId }
  | { kind: 'done'; index: number; outcome: StepOutcome }

export interface RunSuiteArgs<S extends SuiteStep> {
  steps: S[]
  /** The setup the bench is on as the run starts, if known. */
  bench: SetupId | null
  abort: AbortController
  /**
   * Ask the operator to re-cable for `step`. Resolves true once they confirm;
   * false if they decline. Untimed: it waits on a person. Stop answers it
   * through `abort`, so it should resolve (false) when the signal aborts.
   */
  confirmSetup: (from: SetupId | null, to: SetupId, step: S, index: number, signal: AbortSignal) => Promise<boolean>
  /** Run one step. Throws only when the run cannot go on after it. */
  runStep: (step: S, index: number, signal: AbortSignal) => Promise<Omit<StepOutcome, 'ms'>>
  /** The bench is now on `setup` -- for the page to remember. */
  onBench?: (setup: SetupId) => void
  onState?: (s: SuiteState) => void
  now?: () => number
}

export interface SuiteResult {
  outcomes: StepOutcome[]
  /** True when every step ran to the end of its plan. */
  completed: boolean
  /** Why the run ended early: 'stopped', 'declined', or a step's error. */
  ended?: 'stopped' | 'declined' | 'error'
}

const notRun = (): StepOutcome => ({
  verdict: 'not-run', pass: 0, fail: 0, measured: 0, planned: 0, errors: 0, ms: 0,
})

/** The verdict a step's tally earns. FAIL leads: a step with one FAIL is a
 *  failed step whatever else it holds. */
export function stepVerdict(t: { pass: number; fail: number; errors: number; measured: number }): StepVerdict {
  if (t.fail > 0) return 'fail'
  if (t.errors > 0) return 'error'
  if (t.pass > 0) return 'pass'
  return 'na'
}

/** Where the plan changes setup: the indices of steps that need a re-cable
 *  before them, given the bench's setup at the start. */
export function recablePoints(steps: SuiteStep[], bench: SetupId | null): number[] {
  const out: number[] = []
  let on = bench
  steps.forEach((s, i) => {
    if (s.setup !== on) out.push(i)
    on = s.setup
  })
  return out
}


export async function runSuite<S extends SuiteStep>(a: RunSuiteArgs<S>): Promise<SuiteResult> {
  const now = a.now ?? (() => Date.now())
  const { signal } = a.abort
  const outcomes: StepOutcome[] = a.steps.map(notRun)
  let bench = a.bench
  let ended: SuiteResult['ended']

  for (let i = 0; i < a.steps.length; i++) {
    const step = a.steps[i]
    if (signal.aborted) { ended = 'stopped'; break }

    if (step.setup !== bench) {
      a.onState?.({ kind: 'recable', index: i, from: bench, to: step.setup })
      const ok = await a.confirmSetup(bench, step.setup, step, i, signal)
      if (signal.aborted) { ended = 'stopped'; break }
      if (!ok) { ended = 'declined'; break }
      bench = step.setup
      a.onBench?.(bench)
    }

    a.onState?.({ kind: 'running', index: i })
    const t0 = now()
    let outcome: StepOutcome
    try {
      const r = await a.runStep(step, i, signal)
      outcome = { ...r, ms: now() - t0 }
      // Stopped part-way: what it measured stands, but it did not finish.
      if (signal.aborted && r.measured < r.planned) outcome.verdict = 'stopped'
    } catch (e) {
      outcome = { ...notRun(), verdict: 'error', ms: now() - t0, message: (e as Error).message }
      if (signal.aborted) outcome.verdict = 'stopped'
    }
    outcomes[i] = outcome
    a.onState?.({ kind: 'done', index: i, outcome })

    if (outcome.verdict === 'stopped' || signal.aborted) { ended = 'stopped'; break }
    if (outcome.message) { ended = 'error'; break }
  }

  return { outcomes, completed: ended == null, ended }
}
