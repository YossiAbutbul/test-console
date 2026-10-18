/**
 * View options every chart frame offers, and how they map onto Recharts.
 *
 * Pure so the axis rules can be tested without rendering. Kept apart from the
 * component file because mixing exports trips
 * `react-refresh/only-export-components`.
 */

export interface ChartOptions {
  /** null = auto. */
  yMin: number | null
  /** null = auto. */
  yMax: number | null
  showGrid: boolean
  showLegend: boolean
}

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  yMin: null,
  yMax: null,
  showGrid: true,
  showLegend: true,
}

export type DomainBound = number | 'auto' | 'dataMin' | 'dataMax'

/**
 * Y domain for the current options.
 *
 * A typed-but-unfinished bound ("-", "1e") parses to NaN; that falls back to
 * the automatic bound rather than handing Recharts a NaN, which blanks the
 * whole chart while the operator is still typing.
 */
export function yDomain(
  opts: Pick<ChartOptions, 'yMin' | 'yMax'>,
  fallback: [DomainBound, DomainBound] = ['dataMin', 'dataMax'],
): [DomainBound, DomainBound] {
  const ok = (v: number | null): v is number => v != null && Number.isFinite(v)
  return [ok(opts.yMin) ? opts.yMin : fallback[0], ok(opts.yMax) ? opts.yMax : fallback[1]]
}

/** Text-field value → bound. Blank means auto. */
export function parseBound(raw: string): number | null {
  const s = raw.trim()
  return s === '' ? null : Number(s)
}
