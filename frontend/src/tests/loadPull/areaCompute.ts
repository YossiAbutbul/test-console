/**
 * The working area's whole computation, as one step the worker runs: the
 * fields from the samples, the area under the limits, the measured
 * boundary and the contours of the chosen quantity. Pure, so the hook can also run it in
 * place where there is no Worker (the tests).
 */
import {
  isoLines, measuredBoundary, rasterise, workingArea,
  type Area, type FieldGrid, type G, type Limits, type Sample,
} from './workingArea'

/** Cells per side of the interpolation grid over Γ ∈ [-1, 1]: about one
 *  per pixel of the chart. At 200 a cell was 2.4 px and the region's edge
 *  showed as stairs. */
export const AREA_GRID = 480

/** A quantity the figure can contour or colour by. */
export type Quantity = 'pout' | 'icc' | 'eff'

/** How each is named and read. `worst` is what the worst case of several
 *  frequencies is for it: the lowest output, the highest current. */
/** `inline` is the name inside a sentence: Pout and Icc keep their
 *  capitals, efficiency is an ordinary word. */
export const QUANTITY: Record<Quantity, { label: string; inline: string; unit: string; worst: string; digits: number }> = {
  pout: { label: 'Pout', inline: 'Pout', unit: 'dBm', worst: 'lowest', digits: 1 },
  icc: { label: 'Icc', inline: 'Icc', unit: 'mA', worst: 'highest', digits: 0 },
  eff: { label: 'Efficiency', inline: 'efficiency', unit: '%', worst: 'lowest', digits: 1 },
}

/** Levels to contour, from that quantity's limits: min dotted, the middle
 *  dashed, max solid -- line style is the level, colour the frequency. */
export function contourLevels(limits: Limits, key: Quantity): Array<{ v: number; dash?: string }> {
  const [lo, hi] = limits[key]
  const out: Array<{ v: number; dash?: string }> = []
  if (lo != null) out.push({ v: lo, dash: '0.8 2' })
  if (lo != null && hi != null && hi > lo) out.push({ v: (lo + hi) / 2, dash: '5 3' })
  if (hi != null) out.push({ v: hi })
  return out
}

export interface AreaResult {
  area: Area | null
  /** Where every field was measured. */
  boundary: G[]
  /** Per field, per level of `contourKey`, the contour lines. */
  contours: G[][][][]
  contourKey: Quantity
  /** Per field, its measured points (one per spot). */
  pts: Sample[][]
  /** The limits it was computed under: the contours are one per level of
   *  these, not of whatever has been typed since. */
  limits: Limits
}

export function buildFields(samples: Sample[][]): FieldGrid[] {
  return samples.map((s) => rasterise(s, AREA_GRID))
}

export function computeArea(fields: FieldGrid[], limits: Limits, contourKey: Quantity = 'pout'): AreaResult {
  const levels = contourLevels(limits, contourKey)
  return {
    area: fields.length ? workingArea(fields, limits) : null,
    boundary: measuredBoundary(fields),
    contours: fields.map((f) => levels.map((l) => isoLines(f.pts, f.tri, contourKey, l.v))),
    contourKey,
    pts: fields.map((f) => f.pts),
    limits,
  }
}
