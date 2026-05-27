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

import { storage } from './persistent'
import { STORAGE_KEYS } from './keys'

// Loaded once at module init from localStorage so the data survives a hard
// refresh. Components keep mutating this same object directly; after each
// change they must call `persistPowerPage()` to push the snapshot back to
// storage. Cleared automatically when the user hits Run again or Clear.
export const powerPageSnapshot: PowerPageSnapshot =
  storage.get<PowerPageSnapshot>(STORAGE_KEYS.powerPage, {})

// `JSON.stringify(localStorage.setItem)` on every keystroke / measurement
// stalls the main thread. Coalesce writes into a single timer.
const FLUSH_MS = 300
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  storage.set(STORAGE_KEYS.powerPage, powerPageSnapshot)
}

export function persistPowerPage(): void {
  if (flushTimer) return // already scheduled
  flushTimer = setTimeout(flushNow, FLUSH_MS)
}

export function flushPowerPage(): void {
  flushNow()
}

if (typeof window !== 'undefined') {
  // Guarantee the latest snapshot makes it to disk on tab close / reload.
  window.addEventListener('beforeunload', flushNow)
}
