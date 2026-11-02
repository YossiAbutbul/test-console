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
 *   ""            → `fallback` as a single-element list, or `[]`
 *   "12"          → [12]
 *   "0-14"        → 0..14 step 1
 *   "0-14:2"      → 0, 2, 4, …, 14
 *   "0,5,10,14"   → [0, 5, 10, 14]
 *   "0-5, 8, 20"  → [0, 1, 2, 3, 4, 5, 8, 20]  (ranges and values mixed)
 *
 * Values come out in the order typed. Returns `[]` on a bad range (zero
 * step) so the caller can flag the offending row rather than aborting the
 * whole plan.
 */
export function parseRangeSpec(raw: string, fallback: number | null = null): number[] {
  // Normalise en-dash/em-dash/minus to a plain hyphen, so a value pasted from
  // a document that auto-corrected the dash still parses.
  const s = raw.trim().replace(/[‐-―−]/g, '-')
  if (!s) return fallback == null ? [] : [fallback]

  const out: number[] = []
  // Commas split first, so "0 - 5" with spaces round the dash stays one
  // range; only a segment that is not a range is split again on spaces.
  for (const seg of s.split(',')) {
    const pieces = RANGE.test(seg.trim()) ? [seg.trim()] : seg.split(/\s+/)
    for (const piece of pieces) {
      // Empty pieces are dropped *before* Number() sees them. `Number('')` is
      // 0, not NaN, so a half-typed list — "915," — otherwise parses as
      // [915, 0] and the 0 survives the isFinite filter. Harmless-looking,
      // but in a power spec it silently adds a 0 dBm point to the sweep.
      if (piece === '') continue
      const range = expandRange(piece)
      if (range === null) return []
      if (range) out.push(...range)
      else if (Number.isFinite(Number(piece))) out.push(Number(piece))
    }
  }
  return out
}

const RANGE = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(-?\d+(?:\.\d+)?))?$/

/** A "from-to" or "from-to:step" piece as its values; `undefined` when the
 *  piece is not a range, `null` when it is one that cannot be expanded. */
function expandRange(piece: string): number[] | null | undefined {
  const m = piece.match(RANGE)
  if (!m) return undefined
  const from = Number(m[1])
  const to = Number(m[2])
  const step = Math.abs(Number(m[3] ?? 1))
  if (!Number.isFinite(from) || !Number.isFinite(to) || step <= 0) return null
  const out: number[] = []
  // Accumulate in floating point, then round, so 0.1 steps don't drift.
  if (from <= to) for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(6)))
  else for (let v = from; v >= to - 1e-9; v -= step) out.push(Number(v.toFixed(6)))
  return out
}
