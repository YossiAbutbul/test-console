/**
 * Module-level snapshot for the Mode Sweep page.
 *
 * Same pattern as `powerPageStore`: hold what the operator configured outside
 * the React tree so a reload or navigating away does not reset the plan.
 *
 * Holds the run configuration only. Results come from the backend's run
 * status (or an imported workbook), and running state belongs to the backend;
 * restoring either here would show a sweep that is not the one on the bench.
 */
import type { BlockDraft } from '../tests/powerSweep/blocks'
import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface PowerSweepPageSnapshot {
  freqMhz?: string
  powerLo?: number
  powerHi?: number
  dutyLo?: number
  dutyHi?: number
  hpLo?: number
  hpHi?: number
  /** Advanced range list. Ids are re-issued on restore -- see the page. */
  advBlocks?: BlockDraft[]
  settleMs?: number
  paMode?: number
  measureCurrent?: boolean
  powerSource?: 'sensor' | 'spectrum'
  /** Spectrum settings as typed, in kHz. */
  specSpanKhz?: string
  specRbwKhz?: string
  specVbwKhz?: string
  specDetector?: string
}

const store = makePageStore<PowerSweepPageSnapshot>(STORAGE_KEYS.powerSweepPage, {})

export const powerSweepPageSnapshot = store.snapshot
export const persistPowerSweepPage = store.persist
export const flushPowerSweepPage = store.flush
