/**
 * A test sequence's verdicts and re-cabling, as the page shows them.
 *
 * The run itself is the backend's (backend/sequence/runner.py), which keeps
 * the same rules: strictly one step at a time; a pause to re-cable before a
 * step whose setup differs from the bench's (not twice for two steps on one
 * setup, nor before the first if the bench is on it already); a step that
 * missed its limits is a result and the run carries on, while one that cannot
 * go on ends it; Stop leaves every later step "not run".
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
