import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { efficiency } from './smith'

/** One extreme, with the run index of the row it came from (idx + 1 is the
 *  results table's #), so the chart can point at it. */
export interface Extreme {
  v: number
  idx: number
}

export interface MetricStats {
  min: Extreme
  max: Extreme
  avg: number
  n: number
}

export interface PointStats {
  pout: MetricStats | null
  eff: MetricStats | null
  /** Amps, as on the row; shown in mA. */
  cc: MetricStats | null
}

function statsOf(values: Array<{ v: number | null | undefined; idx: number }>): MetricStats | null {
  let min: Extreme | null = null
  let max: Extreme | null = null
  let sum = 0
  let n = 0
  for (const { v, idx } of values) {
    if (v == null || !Number.isFinite(v)) continue
    if (!min || v < min.v) min = { v, idx }
    if (!max || v > max.v) max = { v, idx }
    sum += v
    n++
  }
  return min && max ? { min, max, avg: sum / n, n } : null
}

/**
 * Min, max and average of output power, efficiency and current over `rows`.
 *
 * A failed row is left out whole: its partial readings are a point that did
 * not measure, not a low one. Power is averaged as read, in dBm -- the mean of
 * the figures in the table, which is what is being compared, not the mean
 * power in watts.
 */
export function pointStats(rows: Array<{ row: LoadPullResultRow; idx: number }>): PointStats {
  const ok = rows.filter(({ row }) => !row.error)
  return {
    pout: statsOf(ok.map(({ row, idx }) => ({ v: row.power_dbm, idx }))),
    eff: statsOf(ok.map(({ row, idx }) => ({ v: efficiency(row), idx }))),
    cc: statsOf(ok.map(({ row, idx }) => ({ v: row.current_a, idx }))),
  }
}
