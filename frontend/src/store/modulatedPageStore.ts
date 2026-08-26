/**
 * Module-level snapshot for the LoRa Modulated page.
 *
 * Sibling of `powerPageStore` — same pattern, same reasons: hold what the
 * operator typed outside the React tree so navigating away and back, or
 * switching tabs, does not reset it.
 */

export type ModulatedPageTab = 'manual' | 'automation'

/**
 * One line of the sweep table.
 *
 * Modem, bandwidth and datarate live on the row rather than beside the table.
 * They are properties of a signal, not of a run: comparing SF7 against SF12,
 * or LoRa against FSK, is the point of most modulated sweeps, and holding them
 * run-wide meant doing that as several runs and stitching the exports together.
 */
export interface ModulatedSweepRow {
  /** Range spec in MHz — "915", "900-930", "902.3,915,927.5". */
  freq: string
  /** Range spec in dBm. */
  power: string
  /** 0 = FSK, 1 = LoRa. */
  modem: number
  /** 0 = 125 kHz, 1 = 250 kHz, 2 = 500 kHz. Forced to 0 for FSK. */
  bandwidth: number
  /** Spreading factor for LoRa, bits per second for FSK. */
  datarate: number
  /**
   * Tolerance around the set power, in dB, as typed.
   *
   * A margin rather than absolute limits, because one row can sweep several
   * powers: a fixed band would be right for one of them and wrong for the rest.
   * Always applied — every measured point gets a verdict — so a blank or
   * negative value is an error rather than a way to opt out.
   */
  marginDb: string
}

export interface ModulatedResultRow {
  freq_mhz: number
  set_power_dbm: number
  modem: number
  bandwidth: number
  datarate: number
  measured_dbm: number | null
  measured_dbm_raw: number | null
  current_a: number | null
  voltage_v: number | null
  /** Tolerance this point was judged against, or null when unjudged. */
  margin_db: number | null
  /**
   * Whether the measured power met the limits.
   *
   * Null when there was nothing to judge — no limits set, or no reading. Kept
   * separate from `ok`/`error`, which say whether the *measurement* worked: a
   * point can be measured perfectly and still fail its spec.
   */
  verdict: 'pass' | 'fail' | null
  ok: boolean
  status: number | null
  error: string | null
}

export interface ModulatedPageSnapshot {
  tab?: ModulatedPageTab
  automation?: {
    /** Rows may predate the per-row signal fields, so they are read back
     *  partially and filled in — see `normaliseRow` in the panel. */
    rows?: Array<Partial<ModulatedSweepRow>>
    settleMs?: number
    results?: ModulatedResultRow[]
  }
}

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<ModulatedPageSnapshot>(STORAGE_KEYS.modulatedPage, {})

export const modulatedPageSnapshot = store.snapshot
export const persistModulatedPage = store.persist
export const flushModulatedPage = store.flush
