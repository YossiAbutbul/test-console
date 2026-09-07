/**
 * Module-level snapshot for the TX CW page (folder still `power/`).
 *
 * Pattern: hold ephemeral per-page state outside the React tree so navigation
 * away and back doesn't reset what the user typed. Cleared on hard refresh
 * because the JS bundle is reloaded. One file per page; add siblings (e.g.
 * `loadPullPageStore.ts`) as other pages need the same semantics.
 */

export type PowerPageTab = 'manual' | 'automation'

/**
 * One line of the sweep table.
 *
 * PA mode and the pass/fail tolerance live on the row rather than beside the
 * table. They are properties of a measurement, not of a run: comparing PA
 * modes, or holding a tighter limit at one frequency than another, is the
 * point of most sweeps, and keeping them run-wide meant doing that as several
 * runs and stitching the exports together.
 */
export interface AutomationSweepRow {
  /** Range spec in MHz — "915", "900-930", "902.3,915,927.5". */
  freq: string
  /** Range spec in dBm. */
  power: string
  /** 0 = Off, 1 = On, 2 = Auto. */
  paMode: number
  /**
   * Tolerance around the set power, in dB, as typed.
   *
   * A margin rather than absolute limits, because one row can sweep several
   * powers: a fixed band would be right for one of them and wrong for the rest.
   * Blank means this row's points are not judged.
   */
  marginDb: string
}

export interface AutomationResultRow {
  freq_mhz: number
  set_power_dbm: number
  pa_mode: number
  measured_dbm: number | null
  measured_dbm_raw: number | null
  current_a: number | null
  voltage_v: number | null
  /** Tolerance this point was judged against, or null when unjudged. */
  margin_db: number | null
  /**
   * Whether the measured power met the tolerance.
   *
   * Null when there was nothing to judge — no tolerance set, or no reading.
   * Kept separate from `ok`/`error`, which say whether the *measurement*
   * worked: a point can be measured perfectly and still fail its spec.
   */
  verdict: 'pass' | 'fail' | null
  ok: boolean
  status: number | null
  error: string | null
}

export interface PowerPageSnapshot {
  /** Last opened sub-tab on the Power page (Manual / Automation). */
  tab?: PowerPageTab
  /**
   * Which instruments the manual tab reads back after a Send.
   *
   * Persisted because it describes how the bench is set up, not what is being
   * measured this minute: an operator with no DC analyzer on the rig would
   * otherwise re-clear the same box on every visit. Absent on snapshots
   * written before it existed, and the page falls back to both on.
   */
  manualMeasure?: { power: boolean; current: boolean }
  /** Automation panel state. */
  automation?: {
    /** Rows may predate the per-row PA mode and tolerance, so they are read
     *  back partially and filled in — see `normaliseRow` in the panel. */
    rows?: Array<Partial<AutomationSweepRow>>
    settleMs?: number
    results?: AutomationResultRow[]
  }
}

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<PowerPageSnapshot>(STORAGE_KEYS.powerPage, {})

export const powerPageSnapshot = store.snapshot
export const persistPowerPage = store.persist
export const flushPowerPage = store.flush
