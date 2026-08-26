/**
 * Module-level snapshot for the LTE CW page.
 *
 * Sibling of `powerPageStore` — same pattern, same reasons: hold what the
 * operator typed outside the React tree so navigating away and back does not
 * reset it.
 *
 * Deliberately holds no modem power state. That is a fact about the hardware,
 * not about the page, and restoring a stale "modem on" from a previous session
 * would make the next Send skip a MODEM_ON it needs.
 */

export type LteCwPageTab = 'manual' | 'automation'

export interface LteAutomationRow {
  /** Range spec in whichever unit is selected — "18900", "1850-1910". */
  earfcn: string
  /** Range spec in dBm. */
  power: string
  /**
   * Tolerance around the set power, in dB, as typed.
   *
   * A margin rather than absolute limits, because one row can sweep several
   * powers: a fixed band would be right for one of them and wrong for the rest.
   * Blank means this row's points are not judged.
   */
  marginDb: string
}

export interface LteAutomationResultRow {
  earfcn: number
  band: number | null
  /** Uplink frequency for `earfcn`. Points are only planned for EARFCNs we can
   *  resolve, so this is always a real number by the time a row exists. */
  freq_mhz: number
  set_power_dbm: number
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

export interface LteCwPageSnapshot {
  tab?: LteCwPageTab
  /**
   * The manual tab's fields, as typed.
   *
   * Kept even though the channel unit lives elsewhere (see `tests/lte/channel`)
   * rather than left to reset: the unit survived a reload while the channel did
   * not, so the page came back in MHz holding an EARFCN and flagged itself
   * invalid before anyone had touched it.
   */
  manual?: {
    channel?: string
    power?: string
    seconds?: string
    offset?: string
  }
  automation?: {
    /** Rows may predate the per-row tolerance, so they are read back
     *  partially and filled in — see `normaliseRow` in the panel. */
    rows?: Array<Partial<LteAutomationRow>>
    settleMs?: number
    results?: LteAutomationResultRow[]
  }
}

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<LteCwPageSnapshot>(STORAGE_KEYS.lteCwPage, {})

export const lteCwPageSnapshot = store.snapshot
export const persistLteCwPage = store.persist
export const flushLteCwPage = store.flush
