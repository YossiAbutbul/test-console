/**
 * Pivot automation results into chart series.
 *
 * Kept apart from the modal so the grouping can be tested without a DOM: the
 * failure it guards against is silent. Points used to be keyed by X and the
 * other swept dimension only, so a modulated run that measured the same
 * frequency and set power under several signal configurations (LoRa SF7 and
 * SF12, LTE MCS 5 and MCS 20) kept whichever row came last and drew one tidy
 * line that was really a mixture of runs.
 */

/**
 * The only fields this chart plots.
 *
 * Declared structurally rather than taking one page's row type, because each
 * TX automation (LoRa CW, LoRa modulated, LTE CW, LTE modulated) produces its
 * own row and they all graph the same way. Callers map their row onto this.
 */
export interface GraphableRow {
  freq_mhz: number
  set_power_dbm: number
  measured_dbm: number | null
  current_a: number | null
  /**
   * What else distinguishes this point besides frequency and set power — the
   * signal configuration, as a readable label ("LoRa · 125 kHz · SF7"). Rows
   * with different labels never share a series. Omit when the page has no such
   * dimension.
   */
  series?: string
  /**
   * How to name this row's frequency, when MHz alone undersells it. LTE passes
   * band and EARFCN ("B2 · 18900 · 1880.0 MHz") because that is what the
   * operator typed. Falls back to "<freq> MHz".
   */
  point?: string
}

export type Axis = 'set' | 'freq'

export interface SeriesDef {
  /** Stable recharts `dataKey`. Not the label: two labels may legitimately
   *  read alike, and a dataKey collision would merge their lines again. */
  key: string
  label: string
}

export interface SeriesPoint {
  x: number
  [seriesKey: string]: number | null
}

export interface BuiltSeries {
  series: SeriesDef[]
  data: SeriesPoint[]
  xLabel: string
  /** Tooltip text for an X value: band/EARFCN on a frequency axis where the
   *  rows carry it, otherwise the bare number. Too long for tick labels, which
   *  stay numeric. */
  xText: (x: number) => string
}

export const freqText = (mhz: number): string => `${mhz.toFixed(1)} MHz`
const powerText = (dbm: number): string => `${dbm} dBm`

/**
 * Which dimension goes on X: whichever has more distinct values. Ties keep the
 * historical default (Set on X).
 */
export function pickAxis(results: GraphableRow[]): Axis {
  const freqs = new Set(results.map((r) => r.freq_mhz)).size
  const powers = new Set(results.map((r) => r.set_power_dbm)).size
  return freqs > powers ? 'freq' : 'set'
}

/**
 * Pivot the result list into recharts-friendly rows.
 *
 * `axis` picks X (set power or frequency). Series are the *other* dimension
 * crossed with `row.series`, so every signal configuration gets its own line.
 * The configuration is only spelled out in the legend when there is more than
 * one of it — a single-configuration run keeps the short "915.0 MHz" label.
 */
export function buildSeries(
  results: GraphableRow[],
  pick: (r: GraphableRow) => number | null,
  axis: Axis,
): BuiltSeries {
  const xOf = axis === 'set' ? (r: GraphableRow) => r.set_power_dbm
                             : (r: GraphableRow) => r.freq_mhz
  const groupOf = axis === 'set' ? (r: GraphableRow) => r.freq_mhz
                                 : (r: GraphableRow) => r.set_power_dbm

  // First label seen per frequency wins. A frequency only ever has one band
  // and EARFCN, so these agree in practice.
  const pointText = new Map<number, string>()
  for (const r of results) {
    if (r.point && !pointText.has(r.freq_mhz)) pointText.set(r.freq_mhz, r.point)
  }
  const freqName = (mhz: number) => pointText.get(mhz) ?? freqText(mhz)

  // Configuration order is first appearance, i.e. the order the operator
  // listed the rows in, which is how they think about them.
  const configs: string[] = []
  for (const r of results) {
    const s = r.series ?? ''
    if (!configs.includes(s)) configs.push(s)
  }
  const showConfig = configs.length > 1

  interface Group { g: number; cfg: string; key: string; label: string }
  const groups = new Map<string, Group>()
  const groupId = (g: number, cfg: string) => `${g}\u0000${cfg}`
  for (const r of results) {
    const g = groupOf(r)
    const cfg = r.series ?? ''
    const id = groupId(g, cfg)
    if (groups.has(id)) continue
    const base = axis === 'set' ? freqName(g) : powerText(g)
    const label = showConfig ? `${base} · ${cfg || '—'}` : base
    groups.set(id, { g, cfg, key: '', label })
  }
  const ordered = [...groups.values()].sort(
    (a, b) => a.g - b.g || configs.indexOf(a.cfg) - configs.indexOf(b.cfg),
  )
  ordered.forEach((grp, i) => { grp.key = `s${i}` })

  const byPoint = new Map<string, number | null>()
  for (const r of results) {
    // A repeated point (same X, group and configuration) is a re-measurement;
    // the latest reading stands, as it does in the table.
    byPoint.set(`${xOf(r)}\u0000${groupId(groupOf(r), r.series ?? '')}`, pick(r))
  }

  const xs = Array.from(new Set(results.map(xOf))).sort((a, b) => a - b)
  const data: SeriesPoint[] = xs.map((x) => {
    const row: SeriesPoint = { x }
    for (const grp of ordered) {
      const v = byPoint.get(`${x}\u0000${groupId(grp.g, grp.cfg)}`)
      row[grp.key] = v == null ? null : v
    }
    return row
  })

  return {
    series: ordered.map(({ key, label }) => ({ key, label })),
    data,
    xLabel: axis === 'set' ? 'Set (dBm)' : 'Freq (MHz)',
    xText: axis === 'set' ? (x) => String(x) : (x) => pointText.get(x) ?? x.toFixed(1),
  }
}

/** `GraphableRow.point` for an LTE channel: "B2 · 18900 · 1880.0 MHz", or
 *  without the band when the EARFCN maps to none we know. Shared by both LTE
 *  automations so their legends read the same. */
export function lteChannelPoint(band: number | null, earfcn: number, mhz: number): string {
  return `${band != null ? `B${band} · ` : ''}${earfcn} · ${freqText(mhz)}`
}
