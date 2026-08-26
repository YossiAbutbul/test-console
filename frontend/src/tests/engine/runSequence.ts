/**
 * Generic measurement-sweep driver for tests whose loop runs in the browser
 * (Load Pull, TX CW automation). It owns the boilerplate every sweep
 * repeats:
 *
 *   announce start → optional pre-step → for each item { abort-check,
 *   progress, measure, accumulate } → optional post-step → announce outcome.
 *
 * Each test supplies only its plan (`items`) and a per-item `measure()` that
 * returns a result row. `measure()` MUST NOT throw — it owns its own
 * try/catch and records failures in `row` (detected via `rowHasError`).
 *
 * Cancellation is a real `AbortSignal`, not a polled flag: `measure()` is
 * expected to pass `abort.signal` into its requests and its `sleep()` calls so
 * that Stop takes effect immediately rather than after the current point.
 *
 * Tests whose loop runs on the backend use `useBackendRun` instead; both
 * report through the same `RunReporter`, so the two kinds of test look the
 * same to the operator.
 */
import { TimeoutError, withTimeout } from '../../lib/async'
import type { RunReporter } from './useRunReporter'

/** Hard ceiling for one point, so a wedged instrument can't stall the run. */
export const DEFAULT_STEP_TIMEOUT_MS = 120_000

export interface RunSequenceArgs<Item, Row> {
  /** Ordered work list. */
  items: Item[]
  /** Cancels the run. Abort it from the Stop handler. */
  abort: AbortController
  /** Build one row for one item. Must not throw; record errors in the row. */
  measure: (item: Item, index: number) => Promise<Row>
  /** True when a row failed — drives the completion summary. */
  rowHasError: (row: Row) => boolean
  /** Record an error on a row the driver had to abandon (timeout). */
  markRowError: (item: Item, index: number, message: string) => Row
  /** Push the accumulated rows after each point (for live table updates). */
  onRows: (rows: Row[]) => void
  /** 1-based index of the point currently being measured. */
  onProgress?: (current: number) => void
  /** Runs once before the loop (e.g. set VNA markers). May throw → aborts. */
  before?: () => Promise<void>
  /**
   * Runs before each point, *outside* the step timeout.
   *
   * For work that legitimately takes unbounded time — anything that waits on a
   * person, like asking the operator to set a manual attenuator. Inside
   * `measure` that wait counts against `stepTimeoutMs`, and a point was failed
   * with "timed out after 92s" while the run was simply waiting to be answered.
   */
  beforeItem?: (item: Item, index: number) => Promise<void>
  /** Runs once after the loop, always (best-effort cleanup, e.g. TX off). */
  after?: () => Promise<void>
  /** Max wall time for one point. Should exceed the settle delay. */
  stepTimeoutMs?: number
  /** Lifecycle announcer — see `useRunReporter`. */
  reporter: RunReporter
}

/** Run a sweep to completion (or abort). Returns the rows collected. */
export async function runSequence<Item, Row>(
  a: RunSequenceArgs<Item, Row>,
): Promise<Row[]> {
  const {
    items, abort, measure, rowHasError, markRowError, onRows, onProgress, reporter,
  } = a
  const total = items.length
  const stepTimeoutMs = a.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS

  reporter.started(total)

  if (a.before) await a.before()

  const collected: Row[] = []
  for (let i = 0; i < total; i++) {
    if (abort.signal.aborted) break
    onProgress?.(i + 1)

    // Deliberately untimed — see `beforeItem`.
    if (a.beforeItem) await a.beforeItem(items[i], i)
    if (abort.signal.aborted) break

    let row: Row
    try {
      row = await withTimeout(measure(items[i], i), stepTimeoutMs, `point ${i + 1}`)
    } catch (e) {
      // measure() is contracted not to throw, so this is the timeout guard
      // firing. Record it and carry on to the next point.
      const message = e instanceof TimeoutError ? e.message : (e as Error).message
      reporter.note(`point ${i + 1}: ${message}`, 'error')
      row = markRowError(items[i], i, message)
    }

    // Stopped while this point was in flight, so whatever `measure` returned is
    // partial — it never finished being measured. Recording it would leave a
    // row of blanks in the results that reads as a failed measurement rather
    // than as the point the operator interrupted.
    if (abort.signal.aborted) break

    collected.push(row)
    onRows([...collected])
  }

  if (a.after) {
    try { await a.after() } catch { /* best-effort cleanup */ }
  }

  const summary = {
    completed: collected.length,
    total,
    errors: collected.filter(rowHasError).length,
  }
  if (abort.signal.aborted) reporter.stopped(summary)
  else reporter.finished(summary)

  return collected
}
