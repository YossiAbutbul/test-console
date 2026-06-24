/**
 * Module-level snapshot for the TX Power page.
 *
 * Pattern: hold ephemeral per-page state outside the React tree so navigation
 * away and back doesn't reset what the user typed. Cleared on hard refresh
 * because the JS bundle is reloaded. One file per page; add siblings (e.g.
 * `loadPullPageStore.ts`) as other pages need the same semantics.
 */

export type PowerPageTab = 'manual' | 'automation'

export interface AutomationFreqRow {
  freq: string
  power: string
}

export interface AutomationResultRow {
  freq_mhz: number
  set_power_dbm: number
  pa_mode: number
  measured_dbm: number | null
  measured_dbm_raw: number | null
  current_a: number | null
  voltage_v: number | null
  ok: boolean
  status: number | null
  error: string | null
}

export interface PowerPageSnapshot {
  /** Last opened sub-tab on the Power page (Manual / Automation). */
  tab?: PowerPageTab
  /** Automation panel state. */
  automation?: {
    rows?: AutomationFreqRow[]
    paMode?: number
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
