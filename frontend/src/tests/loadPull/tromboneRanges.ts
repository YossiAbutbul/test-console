/**
 * Trombone travel captured per frequency.
 *
 * The load a trombone presents rotates with frequency, so one Zero/End pair
 * only sweeps the part of the Smith chart that matters at one of them. This
 * holds a captured Start and Stop per frequency; a frequency without both
 * falls back to the page's Zero/End, as path loss falls back to its default.
 *
 * Pure and React-free, like lib/pathLoss.ts, so it can be unit-tested and the
 * modal file exports only a component.
 *
 * Backend counterpart: `TromboneRange` in backend/loadpull/models.py, and
 * `_freqs_by_position` in backend/loadpull/runner.py, which reads on the VNA
 * only the frequencies a position is planned for.
 */

/** One frequency's captured ends, in pulses. Either may be unset mid-capture. */
export interface FreqRange {
  freqMhz: number
  startPulses: number | null
  stopPulses: number | null
}

/** The range a frequency is swept over, and whether it is its own. */
export interface TromboneRangeAt {
  startPulses: number
  stopPulses: number
  /** False when it is the page's Zero/End. */
  own: boolean
}

/** Same tolerance as path loss (lib/pathLoss.ts MATCH_MHZ): 902.3 typed and
 *  902.3 arrived at through an EARFCN are one frequency. */
const MATCH_MHZ = 0.001

export const sameFreq = (a: number, b: number) => Math.abs(a - b) <= MATCH_MHZ

/** The stored entry for `freqMhz`, complete or not. */
export function findRange(ranges: FreqRange[], freqMhz: number): FreqRange | undefined {
  return ranges.find((r) => Number.isFinite(r.freqMhz) && sameFreq(r.freqMhz, freqMhz))
}

/** Both ends captured. A half-captured range is not used: half of it would
 *  be the other range's end, which is a range nobody chose. */
export const isComplete = (r: FreqRange | undefined): r is FreqRange & { startPulses: number; stopPulses: number } =>
  r != null && r.startPulses != null && r.stopPulses != null

/** What `freqMhz` is swept over, or null when it has no range of its own and
 *  Zero/End are not both captured. */
export function rangeAt(
  ranges: FreqRange[],
  zeroPulses: number | null,
  endPulses: number | null,
  freqMhz: number,
): TromboneRangeAt | null {
  const r = findRange(ranges, freqMhz)
  if (isComplete(r)) return { startPulses: r.startPulses, stopPulses: r.stopPulses, own: true }
  if (zeroPulses == null || endPulses == null) return null
  return { startPulses: zeroPulses, stopPulses: endPulses, own: false }
}

export interface TrombonePlan {
  /** Every position visited, in the order the run visits them. */
  positions: number[]
  /** Per position, the indexes (into the frequencies given) measured there. */
  at: Map<number, number[]>
  /** Per frequency, the range used (null: none, and it is left out). */
  ranges: Array<TromboneRangeAt | null>
}

/**
 * The grid points, `anchor + k * delta`, inside [lo, hi]. A range narrower
 * than one step that holds none gets the grid point nearest its middle, so a
 * frequency with a range is never silently left out of the run.
 */
export function gridPositions(anchor: number, delta: number, a: number, b: number): number[] {
  if (delta <= 0) return []
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const out: number[] = []
  for (let k = Math.ceil((lo - anchor) / delta); anchor + k * delta <= hi; k++) {
    out.push(Math.round(anchor + k * delta))
    if (out.length > 5000) break // safety, as planPositions
  }
  if (out.length === 0) out.push(Math.round(anchor + Math.round(((lo + hi) / 2 - anchor) / delta) * delta))
  return out
}

/**
 * Positions for a plan whose frequencies may each have their own range.
 *
 * Still position-major: the trombone is the slow axis, so each position is
 * visited once and every frequency whose range reaches it is taken there.
 *
 * Every frequency steps on one shared grid, `deltaPulses` apart, and is
 * measured at the grid points inside its own range. Each used to step from
 * its own Start, and Starts captured by hand never line up: a run of seven
 * frequencies with a range each visited 124 positions per cycle, each for a
 * single point, where the shared grid visits 34. The price is that a
 * frequency's first and last points sit up to one step inside its captured
 * ends rather than on them.
 *
 * The grid is anchored on Zero (the All frequencies Start) whenever any
 * frequency uses that range, so a run with no per-frequency ranges measures
 * exactly the points `planPositions` gave over Zero/End; otherwise on the
 * lowest captured end.
 *
 * Visited in one direction: Zero toward End when both are captured,
 * otherwise the first frequency's Start toward its Stop.
 */
export function planTrombone(
  freqsMhz: number[],
  ranges: FreqRange[],
  zeroPulses: number | null,
  endPulses: number | null,
  deltaPulses: number,
): TrombonePlan {
  const resolved = freqsMhz.map((f) => rangeAt(ranges, zeroPulses, endPulses, f))
  const used = resolved.filter((r): r is TromboneRangeAt => r != null)
  const anchor = used.some((r) => !r.own) && zeroPulses != null
    ? zeroPulses
    : used.length ? Math.min(...used.map((r) => Math.min(r.startPulses, r.stopPulses))) : 0
  const at = new Map<number, number[]>()
  resolved.forEach((r, i) => {
    if (!r) return
    for (const pos of gridPositions(anchor, deltaPulses, r.startPulses, r.stopPulses)) {
      const list = at.get(pos)
      if (list) { if (!list.includes(i)) list.push(i) } else at.set(pos, [i])
    }
  })
  const first = used[0]
  const descending = zeroPulses != null && endPulses != null
    ? zeroPulses > endPulses
    : first != null && first.startPulses > first.stopPulses
  const positions = [...at.keys()].sort((a, b) => (descending ? b - a : a - b))
  return { positions, at, ranges: resolved }
}

/** `ranges` with `freqMhz`'s entry replaced by `patch` (added when absent),
 *  and dropped once both ends are cleared. */
export function withRange(
  ranges: FreqRange[],
  freqMhz: number,
  patch: Partial<Pick<FreqRange, 'startPulses' | 'stopPulses'>>,
): FreqRange[] {
  const cur = findRange(ranges, freqMhz) ?? { freqMhz, startPulses: null, stopPulses: null }
  const next = { ...cur, ...patch }
  const rest = ranges.filter((r) => r !== cur)
  if (next.startPulses == null && next.stopPulses == null) return rest
  return [...rest, next].sort((a, b) => a.freqMhz - b.freqMhz)
}
