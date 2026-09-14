/**
 * Module-level snapshot for the Signal Generator page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 *
 * The RF output state is deliberately absent. It belongs to the instrument, is
 * read back from it, and a remembered "on" from a previous sitting would be a
 * page claiming a live output it has not checked.
 */

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface SignalGeneratorPageSnapshot {
  /** Serial port, e.g. "COM7". */
  port?: string
  /** Rate the instrument is set to under Utilities - System - RS232. */
  baud?: number
  /** What is typed in the fields, as typed — not what the instrument holds. */
  freqMhz?: string
  levelDbm?: string
}

const store = makePageStore<SignalGeneratorPageSnapshot>(
  STORAGE_KEYS.signalGeneratorPage, {},
)

export const signalGeneratorPageSnapshot = store.snapshot
export const persistSignalGeneratorPage = store.persist
export const flushSignalGeneratorPage = store.flush
