/**
 * Module-level snapshot for the DC Analyzer page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 *
 * The output state is deliberately absent. It belongs to the instrument, is
 * read back from it, and a remembered "on" from a previous sitting would be a
 * page claiming a powered DUT it has not checked.
 */

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface DcAnalyzerPageSnapshot {
  /** What is typed in the fields, as typed — not what the instrument holds. */
  voltageV?: string
  currentLimitA?: string
}

const store = makePageStore<DcAnalyzerPageSnapshot>(STORAGE_KEYS.dcAnalyzerPage, {})

export const dcAnalyzerPageSnapshot = store.snapshot
export const persistDcAnalyzerPage = store.persist
export const flushDcAnalyzerPage = store.flush
