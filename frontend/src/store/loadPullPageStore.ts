/**
 * Module-level snapshot for the Load Pull Test page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 */

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface LoadPullResultRow {
  pos_pulses: number
  pos_mm: number
  /**
   * The (frequency, power) this point was taken at.
   *
   * A run now sweeps several of each at every trombone position, so a row is
   * only identified by all three together. Optional because rows saved before
   * the sweep existed - and rows imported from a CSV written then - carry the
   * run's single frequency in the file header instead of on the row.
   */
  freq_mhz?: number
  power_dbm_setting?: number
  /**
   * Attenuator setting the point was taken at, in dB.
   *
   * The attenuator on the trombone's second output is set by hand, so this is
   * what the operator was *asked* to dial in — the app cannot read it back.
   * Absent when the run did not sweep attenuation.
   */
  att_db?: number
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
  /** Sweep specs — "915", "900-930", "900-930:5", "902.3,915,927.5". */
  freqSpec?: string
  powerSpec?: string
  attEnabled?: boolean
  attMaxDb?: number
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
