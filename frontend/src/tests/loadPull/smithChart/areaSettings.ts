import type { Bound } from '../workingArea'

/** The working area's limits as typed, kept between sessions. Text rather
 *  than numbers so a half-typed "-" or "28." survives a re-render. */
export interface AreaSettings {
  pout: [string, string]
  icc: [string, string]
  eff: [string, string]
  /** Every frequency at once (a load must pass at each), or the one shown. */
  allFreqs: boolean
}
export const AREA_DEFAULT: AreaSettings = { pout: ['', ''], icc: ['', ''], eff: ['', ''], allFreqs: true }

export const LIMIT_ROWS = [
  { key: 'pout', label: 'Pout', unit: 'dBm' },
  { key: 'icc', label: 'Icc', unit: 'mA' },
  { key: 'eff', label: 'Efficiency', unit: '%' },
] as const

/** Blank is no limit; anything else that is not a number is an error. */
export const limitNum = (s: string): number | null | undefined => {
  const t = s.trim()
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : undefined
}
export const toBound = ([lo, hi]: [string, string]): Bound => [limitNum(lo) ?? null, limitNum(hi) ?? null]
