import { alpha, type Theme } from '@mui/material/styles'
import { MONO } from './tokens'

/**
 * Body cell style for a measured or set number.
 *
 * Right-aligned with tabular figures, so a column of 9.60 / 11.42 / 13.24
 * lines up on the decimal and a short value never reads as a different
 * magnitude. Results tables used to set these left-aligned, which made a
 * column of dBm values a ragged edge to compare by eye.
 */
export const NUM_CELL_SX = {
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
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
