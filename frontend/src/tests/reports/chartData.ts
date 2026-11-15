/**
 * A run's results as chart data: which columns are numbers, sensible axes to
 * start from, and round axis ticks.
 */
import type { ReportCell, ReportEntry } from '../../api/reports'

export function num(v: ReportCell | undefined): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/** Columns with at least one number and no words (blanks allowed). */
export function numericColumns(e: ReportEntry): number[] {
  return e.columns.map((_, i) => i).filter((i) => {
    let seen = false
    for (const r of e.rows) {
      const v = r[i]
      if (v === null || v === undefined || v === '') continue
      if (num(v) === null) return false
      seen = true
    }
    return seen
  })
}

/** Where a chart of this run starts: frequency (or channel) across, the
 *  measured value up -- what the lab's charts plot. */
export function defaultAxes(e: ReportEntry): { x: number; ys: number[] } {
  const nums = numericColumns(e)
  const find = (re: RegExp) => e.columns.findIndex((c) => re.test(c))
  let x = find(/freq|earfcn|channel/i)
  if (x < 0) x = nums[0] ?? 0
  let ys = e.columns.map((_, i) => i).filter((i) => /measured|error/i.test(e.columns[i]) && !/raw/i.test(e.columns[i]) && nums.includes(i))
  if (!ys.length) ys = nums.filter((i) => i !== x).slice(0, 1)
  return { x, ys }
}

/** Round tick values covering [lo, hi]: steps of 1, 2 or 5 times a power of
 *  ten, about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (lo === hi) { lo -= 1; hi += 1 }
  const raw = (hi - lo) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const start = Math.floor(lo / step) * step
  const out: number[] = []
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  if (out[out.length - 1] < hi) out.push(Number((out[out.length - 1] + step).toFixed(10)))
  return out
}

export interface ChartData {
  /** X values: numbers, or row labels when the X column is not numeric. */
  xs: Array<number | string>
  numericX: boolean
  /** One array per plotted column, aligned with `xs`. */
  ys: Array<Array<number | null>>
  names: string[]
}

/** The plotted columns, rows sorted along X when X is numeric. */
export function chartData(e: ReportEntry, x: number, ys: number[]): ChartData {
  const numericX = numericColumns(e).includes(x)
  let rows = e.rows.map((r) => r)
  if (numericX) rows = rows.filter((r) => num(r[x]) !== null).sort((a, b) => num(a[x])! - num(b[x])!)
  return {
    xs: rows.map((r) => (numericX ? num(r[x])! : String(r[x] ?? ''))),
    numericX,
    ys: ys.map((c) => rows.map((r) => num(r[c]))),
    names: ys.map((c) => e.columns[c] ?? `Column ${c + 1}`),
  }
}
