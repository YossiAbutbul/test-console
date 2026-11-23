import type { LoadPullResultRow } from '../../../store/loadPullPageStore'

export interface Pt {
  x: number; y: number
  gr: number; gi: number
  idx: number // index in the whole run, so idx + 1 matches the results table's #
  row: LoadPullResultRow
  eff: number | null // drain efficiency (fraction), null if not computable
}

/** How the chart is drawn, kept between sessions. */
export interface SmithStyle {
  /** The trombone path joining each attenuator setting's points. */
  lines: boolean
  /** The constant-R and constant-X circles. */
  grid: boolean
  dot: 's' | 'm' | 'l'
  /** Efficiency ramp, Pout ramp, or one colour per attenuator setting. */
  color: 'eff' | 'pout' | 'att'
}
export const STYLE_DEFAULT: SmithStyle = { lines: true, grid: true, dot: 'm', color: 'eff' }

/** An empty reading in the point card. */
export const DASH_TXT = '—'
