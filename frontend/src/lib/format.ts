/**
 * Value formatting.
 *
 * Every page used to carry its own `fmt`, with a different default precision
 * per file, so the same quantity rendered differently depending on where you
 * looked at it. These are the shared ones.
 */

/** Placeholder for "no reading". */
export const DASH = '—'

/** Fixed-precision number, or `—` when the value is missing or non-finite. */
export function fmt(n: number | null | undefined, digits = 2): string {
  return n == null || !Number.isFinite(n) ? DASH : n.toFixed(digits)
}

/** As `fmt`, with a unit appended. Falls back to a bare `—` (no unit). */
export function fmtUnit(
  n: number | null | undefined,
  digits: number,
  unit: string,
): string {
  return n == null || !Number.isFinite(n) ? DASH : `${n.toFixed(digits)} ${unit}`
}

/**
 * Hz as MHz, always. Use in tables and columns, where `fmtHz`'s unit switching
 * would make neighbouring rows incomparable at a glance.
 */
export function fmtMhz(hz: number | null | undefined, digits = 3): string {
  return hz == null || !Number.isFinite(hz) ? DASH : (hz / 1e6).toFixed(digits)
}

/** Hz rendered in the largest unit that keeps it readable. For prose. */
export function fmtHz(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz)) return DASH
  if (Math.abs(hz) >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`
  if (Math.abs(hz) >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`
  if (Math.abs(hz) >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`
  return `${hz} Hz`
}

/**
 * Number for machine-readable output (CSV): rounded to `digits`, then stripped
 * of trailing zeros so `1.50` exports as `1.5` and `1.00` as `1`.
 */
export function num(n: number | null | undefined, digits = 3): string {
  return n == null || !Number.isFinite(n) ? '' : String(parseFloat(n.toFixed(digits)))
}

/** Pluralise a unit against a count: `plural(1, 'point') === 'point'`. */
export function plural(count: number, unit: string): string {
  return count === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit
}

/**
 * Elapsed wall time as `hh:mm:ss`.
 *
 * Always zero-padded to three parts, including hours, so a run that took two
 * minutes and one that took two hours are the same width in a modal and can be
 * compared at a glance.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}
