/**
 * Module-level snapshot for the Spectrum Analyzer page.
 * Mirrors `powerPageStore.ts` — see it for the full pattern rationale.
 *
 * Only how the page reads, never what the analyzer is set to: the settings
 * belong to the instrument and are read back from it on connect.
 */

import { makePageStore } from './makePageStore'
import { STORAGE_KEYS } from './keys'

export interface SpectrumPageSnapshot {
  /** Live refresh period in seconds — a load dial on the analyzer, see the page. */
  periodS?: number
  /** Marker table shown under the trace. */
  showTable?: boolean
  /** Marker panel height in px, set by dragging the divider above it. */
  markersH?: number
}

const store = makePageStore<SpectrumPageSnapshot>(STORAGE_KEYS.spectrumPage, {})

export const spectrumPageSnapshot = store.snapshot
export const persistSpectrumPage = store.persist
