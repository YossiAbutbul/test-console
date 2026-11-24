/**
 * One sweep, start to finish, without React: what a sweep panel's Run does
 * once preflight has passed and the table has been cleared.
 *
 * Out of `useAutomationRun` so a sweep can run with no panel on screen -- the
 * Full Run page chains several, each with its own settings, through the same
 * code the panels use. The hook keeps what is about the page (results state,
 * the top bar's pill, the header's controls) and calls this for the run.
 *
 * Pinned by each panel's characterisation test (`*AutomationPanel.test.tsx`),
 * which snapshots what a run sends the DUT and the instruments.
 */
import { tallyVerdicts } from '../../lib/verdict'
import { runSequence } from './runSequence'
import type { RunReporter } from './useRunReporter'

/** The fields every sweep's result row has. */
export interface JudgedRow {
  verdict: 'pass' | 'fail' | null
  error: string | null
}

/** Handed to a sweep's run steps. */
export interface RunContext {
  /** This run's; Stop aborts it, which also wakes the settle delay. */
  signal: AbortSignal
  reporter: RunReporter
}

/** Handed to a sweep's `measure` for the point in hand. */
export interface PointContext<Row> extends RunContext {
  /** A frequency (MHz) this run had no path-loss calibration for. Collected
   *  rather than warned per point: a 40-point sweep over one uncalibrated band
   *  would otherwise write the same line forty times. */
  noteUncalibrated: (freqMhz: number) => void
  /** Show a row before `measure` returns -- the BLE run puts the reading up
   *  while the seconds-long reconnect after it is still going. Not recorded:
   *  `runSequence` records the finished row, and a run stopped first drops it. */
  preview: (row: Row) => void
}

/**
 * What one run of a sweep does to the rig, built fresh for every run.
 *
 * Fresh because some sweeps carry state from point to point (BLE's lost-DUT
 * flag and auto tone, LTE's transmission in flight): held in the closure that
 * builds these, it starts clean each run and two runs of one test -- two steps
 * of a Full Run -- never share it.
 */
export interface RunSteps<Item, Row> {
  /** Once, before the first point (outside the step timeout). */
  before?: (ctx: RunContext) => Promise<void>
  /** Before each point, outside its step timeout. */
  beforeItem?: (item: Item, index: number, ctx: RunContext) => Promise<void>
  /** One point. Never throws: failures land in the row it returns. */
  measure: (item: Item, ctx: PointContext<Row>) => Promise<Row>
  /** Leaves the DUT idle at the end of the run, however it ended. */
  after: () => Promise<void>
  /** Called on Stop after the run's abort -- the abort only ends our side
   *  of the conversation, so this tells the DUT. */
  onStop?: (reporter: RunReporter) => void
}

export interface RunSweepArgs<Item, Row extends JudgedRow> {
  plan: Item[]
  steps: RunSteps<Item, Row>
  blankRow: (item: Item) => Row
  abort: AbortController
  reporter: RunReporter
  stepTimeoutMs: number
  /** The frequency a point measures at, in MHz. */
  freqMhz: (item: Item) => number
  /** How the uncalibrated-path-loss note lists a frequency. */
  formatFreq?: (mhz: number) => string
  /** The path loss an uncalibrated frequency fell back to, for the note. */
  defaultDb: number
  /** Every recorded row so far, after each point. */
  onRows: (rows: Row[]) => void
  onProgress?: (current: number) => void
  preview?: (row: Row) => void
}

/** Run one sweep. Returns the rows recorded; throws only when a step before a
 *  point does (a modem that will not restart, a DUT that did not come back). */
export async function runSweep<Item, Row extends JudgedRow>(a: RunSweepArgs<Item, Row>): Promise<Row[]> {
  const { steps, reporter } = a
  const uncalibrated = new Set<number>()
  let recorded: Row[] = []
  const runCtx: RunContext = { signal: a.abort.signal, reporter }
  const ctx: PointContext<Row> = {
    ...runCtx,
    noteUncalibrated: (f) => { uncalibrated.add(f) },
    preview: (row) => a.preview?.(row),
  }
  try {
    recorded = await runSequence<Item, Row>({
      items: a.plan,
      abort: a.abort,
      before: steps.before && (() => steps.before!(runCtx)),
      beforeItem: steps.beforeItem && ((item, i) => steps.beforeItem!(item, i, runCtx)),
      measure: (item) => steps.measure(item, ctx),
      markRowError: (item, _i, message) => ({ ...a.blankRow(item), error: message }),
      after: steps.after,
      rowHasError: (r) => !!r.error,
      judge: tallyVerdicts,
      onRows: (rows) => { recorded = rows; a.onRows(rows) },
      onProgress: a.onProgress,
      // The settle delay is operator-set and can be long; the guard has to
      // sit above it or it would fire on every point.
      stepTimeoutMs: a.stepTimeoutMs,
      reporter,
    })
    return recorded
  } finally {
    // Reported apart from the run's own error count: a point that measured
    // cleanly and missed its limits is a result, not a fault, and folding
    // the two together would hide whichever mattered.
    const judged = tallyVerdicts(recorded)
    if (judged.total > 0) {
      reporter.note(
        `${judged.pass}/${judged.total} points within limits`,
        judged.fail > 0 ? 'warn' : 'info',
      )
    }
    if (uncalibrated.size > 0) {
      const fmtFreq = a.formatFreq ?? String
      const list = [...uncalibrated].sort((x, y) => x - y).map(fmtFreq).join(', ')
      reporter.note(
        `path loss not calibrated at ${list} MHz — those points used the `
        + `default ${a.defaultDb} dB and their measured power is only as `
        + 'good as that figure.',
        'warn',
      )
    }
  }
}
