/**
 * Module-level snapshot for the LTE Modulated page.
 *
 * Sibling of `lteCwPageStore` — same pattern, same reasons: hold what the
 * operator typed outside the React tree so navigating away and back does not
 * reset it.
 *
 * Deliberately holds no modem power state. That is a fact about the hardware,
 * not about the page, and restoring a stale "modem on" from a previous session
 * would make the next Send skip a MODEM_ON it needs.
 *
 * The channel unit and the bands list are *not* here either: both describe the
 * lab rather than a page, so they live in `lteCwPageStore` / `STORAGE_KEYS`
 * and both LTE pages read the same value. Switching to MHz on one page and
 * finding EARFCNs on the other would be a bug, not a feature.
 */

export type LteModulatedPageTab = 'manual' | 'automation'

export interface LteModulatedRow {
  /** Range spec in whichever unit is selected — "18900", "1850-1910". */
  earfcn: string
  /** Range spec in dBm. */
  power: string
  /** Channel bandwidth, as the wire numbers it. */
  bandwidth: number
  /** PUSCH modulation and coding scheme, 0..28. */
  mcs: number
  /** Resource blocks allocated. Bounded by the bandwidth's own count. */
  rbCount: number
  /**
   * Tolerance around the set power, in dB, as typed.
   *
   * A margin rather than absolute limits, because one row can sweep several
   * powers: a fixed band would be right for one of them and wrong for the rest.
   * Blank means this row's points are not judged.
   */
  marginDb: string
}

export interface LteModulatedResultRow {
  earfcn: number
  band: number | null
  /** Uplink frequency for `earfcn`. Points are only planned for EARFCNs we can
   *  resolve, so this is always a real number by the time a row exists. */
  freq_mhz: number
  set_power_dbm: number
  bandwidth: number
  mcs: number
  rb_count: number
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

export interface LteModulatedPageSnapshot {
  tab?: LteModulatedPageTab
  /**
   * The manual tab's fields, as typed.
   *
   * Kept alongside the page-level channel unit rather than left to reset: on
   * the CW page the unit survived a reload while the channel did not, so the
   * page came back in MHz holding an EARFCN and flagged itself invalid before
   * anyone had touched it.
   */
  manual?: {
    channel?: string
    power?: string
    seconds?: string
    bandwidth?: number
    mcs?: number
    rbCount?: number
    rbStart?: number
  }
  automation?: {
    /** Rows are read back partially and filled in — see `normaliseRow` in the
     *  panel — so a snapshot predating a column still loads. */
    rows?: Array<Partial<LteModulatedRow>>
    settleMs?: number
    results?: LteModulatedResultRow[]
  }
}

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<LteModulatedPageSnapshot>(STORAGE_KEYS.lteModulatedPage, {})

export const lteModulatedPageSnapshot = store.snapshot
export const persistLteModulatedPage = store.persist
export const flushLteModulatedPage = store.flush
