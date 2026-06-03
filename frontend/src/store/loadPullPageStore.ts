/**
 * Module-level snapshot for the Load Pull Test page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 */

import { storage } from './persistent'
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
  pathAck?: boolean
  results?: LoadPullResultRow[]
}

export const loadPullPageSnapshot: LoadPullPageSnapshot =
  storage.get<LoadPullPageSnapshot>(STORAGE_KEYS.loadPullPage, {})

const FLUSH_MS = 300
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  storage.set(STORAGE_KEYS.loadPullPage, loadPullPageSnapshot)
}

export function persistLoadPullPage(): void {
  if (flushTimer) return
  flushTimer = setTimeout(flushNow, FLUSH_MS)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushNow)
}
