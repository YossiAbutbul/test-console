/**
 * Path loss lookup.
 *
 * Pure and React-free so it can be unit-tested, and so the context file exports
 * only components (a mixed file breaks fast refresh).
 */

/** One calibrated point: the loss measured for the path at this frequency. */
export interface PathLossPoint {
  freqMhz: number
  db: number
}

export interface PathLossAt {
  db: number
  /**
   * False when the frequency was not in the table and `db` is the default.
   * Callers surface this — a figure carried over from another frequency is a
   * guess, and a reading corrected by a guess looks exactly like a measured one.
   */
  calibrated: boolean
}

/**
 * Frequencies within this many MHz are the same point.
 *
 * Not a search radius — it exists so 902.3 typed into the table still matches
 * 902.3 arrived at through `freq_hz / 1e6`. Anything genuinely between two
 * calibrated points falls back to the default rather than being interpolated:
 * the loss of a real cable run is not linear, and inventing a value would hide
 * exactly the calibration gap this is meant to expose.
 */
const MATCH_MHZ = 0.001

export function findLoss(
  points: PathLossPoint[],
  defaultDb: number,
  freqMhz: number | null | undefined,
): PathLossAt {
  if (freqMhz == null || !Number.isFinite(freqMhz)) {
    return { db: defaultDb, calibrated: false }
  }
  const hit = points.find(
    (p) => Number.isFinite(p.freqMhz) && Math.abs(p.freqMhz - freqMhz) <= MATCH_MHZ,
  )
  return hit ? { db: hit.db, calibrated: true } : { db: defaultDb, calibrated: false }
}
