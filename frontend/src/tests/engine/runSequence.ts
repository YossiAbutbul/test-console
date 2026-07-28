/**
 * Generic measurement-sweep driver for tests whose loop runs in the browser
 * (Load Pull, TX Power automation). It owns the boilerplate every sweep
 * repeats:
 *
 *   announce start → optional pre-step → for each item { abort-check,
 *   progress, measure, accumulate } → optional post-step → announce outcome.
 *
 * Each test supplies only its plan (`items`) and a per-item `measure()` that
 * returns a result row. `measure()` MUST NOT throw — it owns its own
 * try/catch and records failures in `row` (detected via `rowHasError`).
 *
 * Tests whose loop runs on the backend use `useBackendRun` instead; both
 * report through the same `RunReporter`, so the two kinds of test are
 * indistinguishable to the user.
 */
import type { RunReporter } from './useRunReporter'

export interface AbortRef { stop: boolean }

export interface RunSequenceArgs<Item, Row> {
  /** Ordered work list. */
  items: Item[]
  /** Shared mutable abort flag — set `.stop = true` to cancel mid-sweep. */
  abortRef: AbortRef
  /** Build one row for one item. Must not throw; record errors in the row. */
  measure: (item: Item, index: number) => Promise<Row>
  /** True when a row failed — drives the completion summary. */
  rowHasError: (row: Row) => boolean
  /** Push the accumulated rows after each point (for live table updates). */
  onRows: (rows: Row[]) => void
  /** 1-based index of the point currently being measured. */
  onProgress?: (current: number) => void
  /** Runs once before the loop (e.g. set VNA markers). May throw → aborts. */
  before?: () => Promise<void>
  /** Runs once after the loop, always (best-effort cleanup, e.g. TX off). */
  after?: () => Promise<void>
  /** Lifecycle announcer — see `useRunReporter`. */
  reporter: RunReporter
}

/** Run a sweep to completion (or abort). Returns the rows collected. */
export async function runSequence<Item, Row>(
  a: RunSequenceArgs<Item, Row>,
): Promise<Row[]> {
  const { items, abortRef, measure, rowHasError, onRows, onProgress, reporter } = a
  const total = items.length

  reporter.started(total)

  if (a.before) await a.before()

  const collected: Row[] = []
  for (let i = 0; i < total; i++) {
    if (abortRef.stop) break
    onProgress?.(i + 1)
    collected.push(await measure(items[i], i))
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
  if (abortRef.stop) reporter.stopped(summary)
  else reporter.finished(summary)

  return collected
}
