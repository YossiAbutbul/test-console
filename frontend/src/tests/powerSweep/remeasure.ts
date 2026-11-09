/**
 * Picking a Mode Sweep's configurations by the power they measured, for a
 * remeasure: typically the ones that came out in 0-10 dBm with the PA off,
 * run again with it on, so the power into the PA stays inside its limit.
 *
 * Grouped exactly as the export's per-level tabs are
 * (`_bucket_by_measured_power` in backend/sweep/export.py), so choosing
 * "0 to 10 dBm" takes every row the workbook shows on the 0 dBm to 10 dBm
 * tabs -- 10.2 included, since it is on the 10 dBm tab. The two must agree.
 */
import type { ResultRow, SweepBlock } from '../../types/models'

/** Readings at or below this are the sensor's under-range sentinel and get
 *  no tab. Mirrors UNDER_RANGE_DBM in backend/sweep/export.py. */
export const UNDER_RANGE_DBM = -50

/**
 * Python's round(): half to even, so 10.5 goes to the 10 tab and 11.5 to
 * the 12. Math.round would send both up and put a few rows on a different
 * tab than the workbook does. `x - floor(x)` is exact for these magnitudes,
 * so the halfway test is too.
 */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

/** The tab a row is on, or null when it measured nothing usable. */
export function tabOf(row: Pick<ResultRow, 'tx_power_dbm'>): number | null {
  const v = row.tx_power_dbm
  if (v == null || !Number.isFinite(v) || v < UNDER_RANGE_DBM) return null
  return roundHalfEven(v)
}

/** Rows per tab, lowest tab first. */
export function tabCounts(rows: Array<Pick<ResultRow, 'tx_power_dbm'>>): Array<{ tab: number; count: number }> {
  const m = new Map<number, number>()
  for (const r of rows) {
    const t = tabOf(r)
    if (t != null) m.set(t, (m.get(t) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([tab, count]) => ({ tab, count }))
}

export interface SweepConfigPoint {
  power: number
  duty: number
  hp: number
}

/**
 * The configurations whose measured power is on a tab from `from` to `to`
 * (inclusive, either order), each once and in the order the run took them.
 * A configuration measured more than once is taken if any of its readings
 * is in range.
 */
export function configsInTabs(
  rows: Array<Pick<ResultRow, 'tx_power_dbm' | 'power_dbm_setting' | 'pa_duty_cycle' | 'hp_max'>>,
  from: number, to: number,
): SweepConfigPoint[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const seen = new Set<string>()
  const out: SweepConfigPoint[] = []
  for (const r of rows) {
    const t = tabOf(r)
    if (t == null || t < lo || t > hi) continue
    const key = `${r.power_dbm_setting}/${r.pa_duty_cycle}/${r.hp_max}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ power: r.power_dbm_setting, duty: r.pa_duty_cycle, hp: r.hp_max })
  }
  return out
}

/** One single-step block per configuration: the run walks them in order. */
export function remeasureBlocks(configs: SweepConfigPoint[]): SweepBlock[] {
  return configs.map((c) => ({ power_values: [c.power], duty_values: [c.duty], hp_values: [c.hp] }))
}
