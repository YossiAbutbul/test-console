/**
 * Module-level snapshot for the Power Meter component page.
 *
 * Sibling of `powerPageStore` — same pattern, same reason: hold what the
 * operator typed outside the React tree so navigating away and back does not
 * reset it.
 *
 * Holds no samples. A trace is a record of what the sensor saw at a moment on
 * a bench that has since been re-cabled; restoring one would put stale numbers
 * under a live "Reading" heading.
 */
export type PowerMeterTab = 'read' | 'continuous'

export interface PowerMeterPageSnapshot {
  /** Last opened sub-tab. */
  tab?: PowerMeterTab
  /** Continuous interval, in ms, as typed. */
  intervalMs?: string
}

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

const store = makePageStore<PowerMeterPageSnapshot>(STORAGE_KEYS.powerMeterPage, {})

export const powerMeterPageSnapshot = store.snapshot
export const persistPowerMeterPage = store.persist
export const flushPowerMeterPage = store.flush
