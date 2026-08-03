/**
 * Module-level snapshot for the Load Pull Test page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 */

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface LoadPullResultRow {
  pos_pulses: number
  pos_mm: number
  power_dbm: number | null
  current_a: number | null
  r_ohm: number | null
  x_ohm: number | null
  s11_db: number | null
  error: string | null
}

export interface LoadPullPageSnapshot {
  freqMhz?: number
  powerDbm?: number
  paMode?: number
  settleMs?: number
  deltaXmm?: number
  jogSpeed?: number
  zeroPulses?: number | null
  endPulses?: number | null
  results?: LoadPullResultRow[]
  // `pathAck` is deliberately absent. Confirming the RF path asserts how the
  // bench is cabled right now — the one precondition the app cannot check for
  // itself — so it is held in component state and starts false every session.
  // Persisted, a tick from a previous sitting would vouch for a rig that has
  // since been unplugged.
}

const store = makePageStore<LoadPullPageSnapshot>(STORAGE_KEYS.loadPullPage, {})

export const loadPullPageSnapshot = store.snapshot
export const persistLoadPullPage = store.persist
export const flushLoadPullPage = store.flush
