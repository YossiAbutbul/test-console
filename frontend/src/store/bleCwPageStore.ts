/**
 * Module-level snapshot for the BLE CW page.
 *
 * Sibling of `lteCwPageStore` -- same pattern, same reasons: hold what the
 * operator typed outside the React tree so navigating away and back does not
 * reset it.
 *
 * Deliberately holds no radio state -- not the tone power the DUT is on, not
 * a tone on air. Those are facts about the hardware, and restoring a stale
 * "power 20" from a previous session would let the next Send skip the reset
 * it needs and measure at whatever power the DUT happens to be on.
 */

export type BleCwPageTab = 'manual' | 'automation'

/** Channel fields are read as BLE channel numbers or as MHz. */
export type BleChannelUnit = 'channel' | 'mhz'

export interface BleAutomationRow {
  /** Range spec in whichever unit is selected -- "0-39:2", "2402-2480". */
  channel: string
  /** Range spec of tone power params, 6-31. */
  power: string
  /**
   * Pass band for the measured power, dBm, as typed. Absolute rather than a
   * margin around the set power, because the set power is a firmware param,
   * not a level -- there is nothing to put a margin around. Either may be
   * blank; both blank means this row's points are not judged.
   */
  minDbm: string
  maxDbm: string
}

export interface BleAutomationResultRow {
  channel: number
  freq_mhz: number
  /** Tone power param the point was taken at. */
  power_param: number
  measured_dbm: number | null
  measured_dbm_raw: number | null
  current_a: number | null
  voltage_v: number | null
  min_dbm: number | null
  max_dbm: number | null
  /**
   * Whether the measured power fell inside the row's limits.
   *
   * Null when there was nothing to judge -- no limits, or no reading. Kept
   * apart from `ok`/`error`, which say whether the *measurement* worked.
   */
  verdict: 'pass' | 'fail' | null
  /**
   * The tone start's reply status, or null when it went unanswered. An
   * unanswered start is the expected shape (the link goes with the tone), so
   * null here is not an error by itself.
   */
  status: number | null
  ok: boolean
  error: string | null
}

export interface BleCwPageSnapshot {
  tab?: BleCwPageTab
  /** Page-wide, so both tabs agree on what a number in a channel field means. */
  unit?: BleChannelUnit
  manualPowerSource?: Partial<PowerSourceState>
  manualMeasure?: { power: boolean; current: boolean }
  manual?: {
    channel?: string
    power?: string
    seconds?: string
    offset?: string
  }
  automation?: {
    rows?: Array<Partial<BleAutomationRow>>
    settleMs?: number
    /**
     * Per-point tone duration in seconds as typed, or '' for auto (sized from
     * the measurement -- see `autoToneSeconds`).
     *
     * Not `toneSeconds`, which the first version saved: it saved the old
     * default '5' on first mount, and reading it back would have pinned every
     * existing page to a fixed 5 s tone and never let auto take over.
     */
    toneFixedSeconds?: string
    powerSource?: Partial<PowerSourceState>
    results?: BleAutomationResultRow[]
  }
}

import type { PowerSourceState } from '../lib/powerSource'
import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<BleCwPageSnapshot>(STORAGE_KEYS.bleCwPage, {})

export const bleCwPageSnapshot = store.snapshot
export const persistBleCwPage = store.persist
export const flushBleCwPage = store.flush
