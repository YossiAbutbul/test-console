/**
 * Generic measurement-sweep driver shared by automated tests (Load Pull,
 * Power, …). It owns the boilerplate every sweep repeats:
 *
 *   reset → optional pre-step → for each item { abort-check, progress,
 *   measure, accumulate } → optional post-step → completion notification.
 *
 * Each test supplies only its plan (`items`) and a per-item `measure()` that
 * returns a result row. `measure()` MUST NOT throw — it owns its own
 * try/catch and records failures in `row` (detected via `rowHasError`).
 */

export interface AbortRef { stop: boolean }

export interface CompleteNotifier {
  complete: (opts: { severity?: 'success' | 'warning' | 'error'; title?: string; message: string }) => void
}

/** Channel-bound logger: the caller pre-binds its log source. */
export type LogFn = (message: string, level?: 'info' | 'warn' | 'error') => void

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
  /** Display name used in the completion modal title. */
  name: string
  /** Plural unit word ("points"). */
  unit?: string
  /** Channel-bound logger (caller binds its log source). */
  log: LogFn
  notify: CompleteNotifier
}

/** Run a sweep to completion (or abort). Returns the rows collected. */
export async function runSequence<Item, Row>(a: RunSequenceArgs<Item, Row>): Promise<Row[]> {
  const { items, abortRef, measure, rowHasError, onRows, onProgress } = a
  const unit = a.unit ?? 'points'
  const total = items.length

  if (a.before) await a.before()

  const collected: Row[] = []
  for (let i = 0; i < items.length; i++) {
    if (abortRef.stop) { a.log('stopped by user', 'warn'); break }
    onProgress?.(i + 1)
    const row = await measure(items[i], i)
    collected.push(row)
    onRows([...collected])
  }

  if (a.after) {
    try { await a.after() } catch { /* best-effort */ }
  }

  const errCount = collected.filter(rowHasError).length
  if (abortRef.stop) {
    a.notify.complete({
      severity: 'warning',
      title: `${a.name} cancelled`,
      message: `Stopped at ${collected.length}/${total} ${unit}`,
    })
  } else if (errCount > 0) {
    a.notify.complete({
      severity: 'warning',
      title: `${a.name} done`,
      message: `Finished with ${errCount} error${errCount === 1 ? '' : 's'} (${collected.length}/${total} ${unit})`,
    })
  } else {
    a.notify.complete({
      severity: 'success',
      title: `${a.name} done`,
      message: `${collected.length} ${collected.length === 1 ? unit.replace(/s$/, '') : unit} measured`,
    })
  }

  return collected
}
