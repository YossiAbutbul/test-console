/**
 * Numeric list/range parsing for sweep inputs.
 *
 * There used to be two unrelated parsers under `tests/` with the same name and
 * different semantics — one live, one dead but tested. This is the live one.
 */

/** Inclusive integer range, ascending regardless of argument order. */
export function range(lo: number, hi: number): number[] {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

/**
 * Parse a frequency/power spec.
 *
 *   ""          → `fallback` as a single-element list, or `[]`
 *   "12"        → [12]
 *   "0-14"      → 0..14 step 1
 *   "0-14:2"    → 0, 2, 4, …, 14
 *   "0,5,10,14" → [0, 5, 10, 14]
 *
 * Returns `[]` on a syntax error so the caller can flag the offending row
 * rather than aborting the whole plan.
 */
export function parseRangeSpec(raw: string, fallback: number | null = null): number[] {
  // Normalise en-dash/em-dash/minus to a plain hyphen, so a value pasted from
  // a document that auto-corrected the dash still parses.
  const s = raw.trim().replace(/[‐-―−]/g, '-')
  if (!s) return fallback == null ? [] : [fallback]

  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(-?\d+(?:\.\d+)?))?$/)
  if (m) {
    const from = Number(m[1])
    const to = Number(m[2])
    const step = Math.abs(Number(m[3] ?? 1))
    if (!Number.isFinite(from) || !Number.isFinite(to) || step <= 0) return []
    const out: number[] = []
    // Accumulate in floating point, then round, so 0.1 steps don't drift.
    if (from <= to) for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(6)))
    else for (let v = from; v >= to - 1e-9; v -= step) out.push(Number(v.toFixed(6)))
    return out
  }

  // Empty segments are dropped *before* Number() sees them. `Number('')` is 0,
  // not NaN, so a half-typed list — "915," — otherwise parses as [915, 0] and
  // the 0 survives the isFinite filter. Harmless-looking, but in a power spec
  // it silently adds a 0 dBm point to the sweep.
  return s.split(/[,\s]+/).filter((x) => x !== '').map(Number).filter(Number.isFinite)
}
