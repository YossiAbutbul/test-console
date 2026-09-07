/**
 * What a manual Send should read back after it keys the PA.
 *
 * Both off is a real choice, not an empty one: it means "just transmit". A
 * manual send used to always drag the power sensor and the DC analyzer up with
 * it, which is a VISA session apiece and a preflight dialog in the way — all
 * of it wasted when the operator only wants the DUT radiating so they can look
 * at it on their own bench kit.
 *
 * Kept apart from `MeasureOptions.tsx` so that file exports only a component:
 * mixing the two trips `react-refresh/only-export-components`.
 */
import type { InstrumentId } from '../context/InstrumentsContext'

export interface MeasureSelection {
  /** Power sensor — TX power. */
  power: boolean
  /** DC analyzer — current consumption. */
  current: boolean
}

export const MEASURE_ALL: MeasureSelection = { power: true, current: true }

/**
 * The instruments a selection needs up, for `useInstrumentPreflight`.
 *
 * Empty when nothing is being measured, and callers are expected to skip
 * preflight entirely on an empty list rather than call it with one: preflight
 * with nothing to connect still puts a dialog between the operator and the
 * transmit they asked for.
 */
export function requiredInstruments(sel: MeasureSelection): InstrumentId[] {
  const ids: InstrumentId[] = []
  if (sel.power) ids.push('power-sensor')
  if (sel.current) ids.push('dc-analyzer')
  return ids
}

/** True when a send should measure anything at all. */
export function measuresAnything(sel: MeasureSelection): boolean {
  return sel.power || sel.current
}
