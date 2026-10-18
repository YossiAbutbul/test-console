/**
 * Run-time estimates: how long a run will take before it starts, and how long
 * it has left once it has.
 *
 * Pure so it can be tested without a clock; `ui/RunTiming` owns the clock and
 * feeds it in.
 */

/**
 * How many steps of evidence it takes before the measured rate counts for as
 * much as the planned one.
 *
 * The planned per-step time is a guess (settle plus a fixed overhead), and the
 * first measured step is not much better -- it carries the run's one-off
 * set-up (preflight, modem boot, first trombone move). Blending the two keeps
 * the first few readings from swinging wildly either way, and by a dozen steps
 * the guess has faded to almost nothing.
 */
const PRIOR_WEIGHT = 3

/** Time a run of `steps` steps is planned to take, plus any one-off cost. */
export function estimateRunMs(steps: number, perStepMs: number, fixedMs = 0): number {
  if (!(steps > 0)) return 0
  return Math.max(0, steps * Math.max(0, perStepMs) + Math.max(0, fixedMs))
}

export interface EtaInput {
  /** Steps finished so far. */
  completed: number
  /** Steps in the whole run. */
  total: number
  /** Time since the run started. */
  elapsedMs: number
  /**
   * Time since the last step finished (or since the start, before the first).
   * Lets the countdown keep ticking between steps instead of jumping once per
   * step. Defaults to 0, i.e. as if a step had just finished.
   */
  sinceStepMs?: number
  /** The pre-run estimate for the whole run, if there was one. */
  plannedTotalMs?: number | null
}

export interface Eta {
  elapsedMs: number
  /** Null until there is anything to base it on: no plan and no step done. */
  remainingMs: number | null
  /** The blended per-step time the remaining figure was worked out from. */
  perStepMs: number | null
}

/**
 * Elapsed and remaining time for a run in progress.
 *
 * Remaining is the per-step time times the steps still to go, less the time
 * already spent on the step in hand. That subtraction never takes it below the
 * cost of the steps after the current one: a step that overruns holds the
 * countdown still rather than running it past what is left.
 */
export function computeEta({
  completed, total, elapsedMs, sinceStepMs = 0, plannedTotalMs = null,
}: EtaInput): Eta {
  const elapsed = Math.max(0, elapsedMs)
  const done = Math.max(0, Math.min(completed, total))
  if (!(total > 0)) return { elapsedMs: elapsed, remainingMs: null, perStepMs: null }
  if (done >= total) return { elapsedMs: elapsed, remainingMs: 0, perStepMs: null }

  const planned = plannedTotalMs != null && plannedTotalMs > 0 ? plannedTotalMs / total : null
  // The time the finished steps actually took, not counting the one in hand.
  const since = Math.max(0, Math.min(sinceStepMs, elapsed))
  const measured = done > 0 ? (elapsed - since) / done : null

  let perStep: number | null
  if (measured != null && planned != null) {
    const w = done / (done + PRIOR_WEIGHT)
    perStep = w * measured + (1 - w) * planned
  } else {
    perStep = measured ?? planned
  }
  if (perStep == null) return { elapsedMs: elapsed, remainingMs: null, perStepMs: null }

  const left = total - done
  const remaining = Math.max(perStep * left - since, perStep * (left - 1), 0)
  return { elapsedMs: elapsed, remainingMs: remaining, perStepMs: perStep }
}
