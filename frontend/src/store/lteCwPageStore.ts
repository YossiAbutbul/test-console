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

/** Whether channel inputs are read as EARFCNs or as MHz. */
export type ChannelUnit = 'earfcn' | 'mhz'

export interface LteAutomationRow {
  /** Range spec — "18900", "18900-18910", "18900,20175". */
  earfcn: string
  /** Range spec in dBm. */
  power: string
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
  ok: boolean
  status: number | null
  error: string | null
}

export interface LteCwPageSnapshot {
  tab?: LteCwPageTab
  channelUnit?: ChannelUnit
  /**
   * The manual tab's fields, as typed.
   *
   * Kept alongside `channelUnit` rather than left to reset: the unit survived a
   * reload while the channel did not, so the page came back in MHz holding an
   * EARFCN and flagged itself invalid before anyone had touched it.
   */
  manual?: {
    channel?: string
    power?: string
    seconds?: string
    offset?: string
  }
  automation?: {
    rows?: LteAutomationRow[]
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
