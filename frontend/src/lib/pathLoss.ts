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

/**
 * The path loss table's rows from an S21 sweep: one per marker, at the
 * marker's configured frequency (what the table is looked up by), with the
 * loss as a positive figure -- S21 of a lossy path is negative, and the table
 * holds the dB to add back to a reading (20.5, not -20.5).
 */
export function pathLossFromS21(
  markers: Array<{ requested_hz: number; mag_db: number }>,
): PathLossPoint[] {
  const byFreq = new Map<number, number>()
  for (const m of markers) {
    if (!Number.isFinite(m.mag_db)) continue
    const freqMhz = Math.round(m.requested_hz) / 1e6
    byFreq.set(freqMhz, Math.round(-m.mag_db * 100) / 100)
  }
  return [...byFreq].map(([freqMhz, db]) => ({ freqMhz, db })).sort((a, b) => a.freqMhz - b.freqMhz)
}

// ---------- The table as a file ----------
//
// Saved and loaded so a calibration outlives this browser's storage: another
// PC on the bench, a cleared profile, or going back to last week's figures
// for a cable run that has not changed. JSON, so the file says which figure
// is the default and which belong to frequencies, without a column
// convention to remember.

/** What the file says it is, so a JSON from elsewhere is refused by name. */
export const PATH_LOSS_FILE_KIND = 'test-console/path-loss'

export interface PathLossTable {
  defaultDb: number
  points: PathLossPoint[]
}

/** The table as file text. Points sorted by frequency, as the dialog saves them. */
export function pathLossToJson(table: PathLossTable, now: Date = new Date()): string {
  return JSON.stringify({
    kind: PATH_LOSS_FILE_KIND,
    version: 1,
    saved_at: now.toISOString(),
    default_db: table.defaultDb,
    points: [...table.points]
      .sort((a, b) => a.freqMhz - b.freqMhz)
      .map((p) => ({ freq_mhz: p.freqMhz, db: p.db })),
  }, null, 2) + '\n'
}

/**
 * A path loss file read back. Throws, with a message fit to show, on
 * anything that is not one: the dialog must not half-load a table.
 *
 * Takes this app's file, and also a bare list of `{freq_mhz, db}` (or
 * `freqMhz`) points, which is what someone writing one by hand produces.
 */
export function parsePathLossJson(text: string): { defaultDb: number | null; points: PathLossPoint[] } {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('Not a JSON file')
  }
  const obj = data as { kind?: unknown; default_db?: unknown; points?: unknown }
  const isObj = data != null && typeof data === 'object' && !Array.isArray(data)
  if (isObj && obj.kind != null && obj.kind !== PATH_LOSS_FILE_KIND) {
    throw new Error(`Not a path loss file (it is "${String(obj.kind)}")`)
  }
  const raw = Array.isArray(data) ? data : isObj ? obj.points : undefined
  if (!Array.isArray(raw)) throw new Error('No path loss points in the file')
  const points: PathLossPoint[] = raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    const freqMhz = Number(o.freq_mhz ?? o.freqMhz)
    const db = Number(o.db)
    if (!Number.isFinite(freqMhz) || freqMhz <= 0 || !Number.isFinite(db)) {
      throw new Error(`Point ${i + 1} needs a positive frequency and a numeric loss`)
    }
    return { freqMhz, db }
  })
  const dupes = points.map((p) => p.freqMhz).filter((f, i, all) => all.indexOf(f) !== i)
  if (dupes.length) throw new Error(`${dupes[0]} MHz is listed twice`)
  let defaultDb: number | null = null
  if (isObj && obj.default_db != null) {
    defaultDb = Number(obj.default_db)
    if (!Number.isFinite(defaultDb)) throw new Error('The default loss is not a number')
  }
  return { defaultDb, points: points.sort((a, b) => a.freqMhz - b.freqMhz) }
}
