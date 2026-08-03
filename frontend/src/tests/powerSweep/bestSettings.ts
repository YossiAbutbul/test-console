/**
 * Ranking the sweep's rows by what they cost.
 *
 * The sweep exists to answer one question — which combination of settings
 * holds a given power for the least current — so the rows are grouped by the
 * power they actually reached and ordered within each group by current.
 *
 * Grouping matches the workbook (`backend/sweep/export.py`): rounded *measured*
 * power, ignoring the sensor's under-range sentinel, so the export and the app
 * cannot disagree about what a run found.
 */
import type { ResultRow } from '../../types/models'

/** Matches `UNDER_RANGE_DBM` in backend/sweep/export.py. */
export const UNDER_RANGE_DBM = -50

/** Current in milliamps, or null when the row has no reading. */
export const milliamps = (r: ResultRow): number | null =>
  r.current_a == null ? null : r.current_a * 1000

/**
 * The settings that produced a row, as one short label.
 *
 * `power` is the value the PA was commanded with, not what came out of it —
 * the measured figure sits beside this label wherever it is shown. The two
 * differing is the reason the sweep exists.
 */
export const comboLabel = (r: ResultRow): string =>
  `hp ${r.hp_max} · duty ${r.pa_duty_cycle} · power ${r.power_dbm_setting}`

export interface Level {
  /** Rounded measured power, in dBm. */
  power: number
  /** Every row that reached this power, cheapest current first. */
  rows: ResultRow[]
  /** Cheapest row here, or null if none of them reported a current. */
  best: ResultRow | null
  bestMa: number | null
}

/** Group rows by the power they reached, strongest level first. */
export function buildLevels(rows: ResultRow[]): Level[] {
  const byPower = new Map<number, ResultRow[]>()
  for (const r of rows) {
    if (r.tx_power_dbm == null || r.tx_power_dbm < UNDER_RANGE_DBM) continue
    const k = Math.round(r.tx_power_dbm)
    const list = byPower.get(k)
    if (list) list.push(r)
    else byPower.set(k, [r])
  }

  return Array.from(byPower.entries())
    .map(([power, group]) => {
      // Rank on current alone: every row here already reached this power, so
      // what is left to choose between them is what it cost. Rows with no
      // reading sort last — a missing current is not a low one, and putting
      // one first would recommend the combination we know least about.
      const rows = [...group].sort((a, b) => {
        const ca = milliamps(a)
        const cb = milliamps(b)
        if (ca == null) return cb == null ? 0 : 1
        if (cb == null) return -1
        return ca - cb
      })
      const best = rows.find((r) => milliamps(r) != null) ?? null
      return { power, rows, best, bestMa: best ? milliamps(best) : null }
    })
    .sort((a, b) => b.power - a.power)
}
