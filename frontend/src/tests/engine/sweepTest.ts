/**
 * A sweep test as plain data and functions: what it measures, how its
 * settings turn into a plan, and what a run of it does to the rig.
 *
 * Each sweep page's panel builds its run from one of these, and the Full Run
 * page chains several -- the same test more than once, each copy with its own
 * settings -- without any of their panels on screen. Keeping the run here,
 * rather than inside the panel component, is what lets both use one code path.
 *
 * `Raw` is the test's settings as its page snapshot stores them (rows typed as
 * strings, possibly from an older build); `R` is the same resolved: rows
 * normalised, settle clamped, power source filled in.
 */
import type { ReportEntryDraft } from '../../api/reports'
import type { SequenceStepIn, SequenceTestId, WiredStep } from '../../api/sequence'
import type { InstrumentId } from '../../context/InstrumentsContext'
import type { Protocol } from '../types'

/**
 * How the bench is cabled for a test.
 *
 * LoRa and LTE come out of the DUT's main RF output; BLE out of a different
 * one, so the cable to the sensor moves; Load Pull puts the trombone tuner in
 * the path. A Full Run pauses for the operator to re-cable wherever the next
 * step's setup differs from the bench's. Names and instructions the operator
 * sees are in `fullRun/setups.ts`.
 */
export type SetupId = 'main' | 'ble' | 'load-pull'

/** The fields every sweep's result row has. */
export interface JudgedRow {
  verdict: 'pass' | 'fail' | null
  error: string | null
}

export interface SweepTest<Raw extends object, R, Item, Row extends JudgedRow> {
  /** The test page's registry id ("power"). */
  id: string
  /** "LoRa CW". */
  label: string
  protocol: Protocol
  setup: SetupId
  /** A radio the run talks through, which the page that runs it must own. */
  needs?: 'ble-link' | 'lte-modem'
  /** A copy of the settings on the test's own page now, results left out. */
  fromPage: () => Raw
  resolve: (raw: Raw) => R
  plan: (r: R) => Item[]
  /** Why these settings cannot run (a bad row, an unusable power source),
   *  or null. An empty plan is reported apart, by its point count. */
  problem: (r: R) => string | null
  /** The planned run time, ms. */
  estimateMs: (r: R, plan: Item[]) => number
  instruments: (r: R) => InstrumentId[]
  stepTimeoutMs: (r: R) => number
  /** The frequency a point measures at, in MHz. */
  freqMhz: (item: Item) => number
  formatFreq?: (mhz: number) => string
  blankRow: (item: Item) => Row
  /** The step as the backend runs it (backend/sequence/steps.py): the plan's
   *  points in its point model, with the settle and power source. */
  wire: (r: R, plan: Item[]) => WiredStep
  /** The results as the page's Add to report writes them. */
  report: (r: R, rows: Row[]) => ReportEntryDraft
  /** The results as the page's Export writes them: header, then rows. */
  csv: (rows: Row[]) => { header: string[]; body: Array<Array<string | number | boolean | null>> }
  /** What the step measures at, in a few words: "902.3, 915, 927.5 MHz". */
  summary: (r: R, plan: Item[]) => string
}

/**
 * Where a sweep panel reads and writes its settings: the page's own snapshot
 * by default, or a Full Run step's settings when the panel is that step's
 * editor. `snap` returns one stable object, mutated in place, as the page
 * stores do (store/makePageStore.ts).
 */
export interface SweepSettingsStore<Raw extends object> {
  snap: () => Raw
  persist: () => void
}

/** A step as the backend runs it, less its id: what the test is, the setup
 *  it needs, its label for the log, and its points. */
export function wireStep<R, Item>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: SweepTest<any, R, Item, any>, r: R, label = t.label,
): Omit<SequenceStepIn, 'uid'> {
  return { test: t.id as SequenceTestId, setup: t.setup, label, ...t.wire(r, t.plan(r)) }
}

/** A sweep test whose types are not known where it is used -- the Full Run
 *  holds several kinds in one list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySweepTest = SweepTest<any, any, any, any>

/**
 * The values a step measures at, as the operator would say them: up to three
 * listed ("902.3, 915, 927.5"), more as the first and last with a count
 * ("902.3 to 927.5, 12 values"). Just the one axis a step is about -- power,
 * PA mode and the rest are in the step's own tabs.
 */
export function valuesText(values: number[], fmt: (v: number) => string = String): string {
  const u = [...new Set(values)].sort((x, y) => x - y)
  if (u.length === 0) return ''
  if (u.length <= 3) return u.map(fmt).join(', ')
  return `${fmt(u[0])} to ${fmt(u[u.length - 1])}, ${u.length} values`
}
