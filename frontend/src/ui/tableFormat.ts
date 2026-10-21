import { alpha, type Theme } from '@mui/material/styles'
import { MONO } from './tokens'

/**
 * Body cell style for a measured or set number.
 *
 * Left-aligned, as the operator asked, under a left-aligned heading: every
 * column of every table starts on one edge. Mono with tabular figures, so
 * values with the same number of places still line up digit for digit (a
 * ragged left edge was the reason they were once right-aligned).
 */
export const NUM_CELL_SX = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'left',
  whiteSpace: 'nowrap',
} as const

/**
 * Measured minus set, signed, two decimals — or "—" when either is missing.
 * A true minus sign, so a negative error is as wide as a positive one.
 */
export function deltaText(measured: number | null | undefined, set: number | null | undefined): string {
  if (measured == null || set == null || !Number.isFinite(measured) || !Number.isFinite(set)) return '—'
  const d = measured - set
  const s = Math.abs(d).toFixed(2)
  return d > 0.004 ? `+${s}` : d < -0.004 ? `−${s}` : s
}

/**
 * Row wash for a FAIL, so a failure stands out of a long run before the
 * Verdict column is read. A background tint only -- no coloured edge -- and
 * never the only signal: the row also carries the ✕ FAIL mark.
 */
export const FAIL_ROW_SX = {
  // 6 %: at 9 % the red delta and the secondary text on the row fell
  // under 4.5:1 in Mid.
  '& > td': { bgcolor: (t: Theme) => alpha(t.palette.error.main, 0.06) },
} as const
