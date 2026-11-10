import type { FreqStage } from '../../api/freqAccuracy'
import { parseRangeSpec } from '../../lib/numericList'
import { MIN_SETTLE_MS } from '../../lib/settle'

/**
 * Widest first. Stage 1 must catch a crystal 20 ppm off (+-18 kHz at 900 MHz)
 * with room to spare; each later stage re-centres on the previous peak, so its
 * span only has to cover the previous stage's bin. The last one, 1 kHz across
 * ~1000 trace points, resolves about a hertz.
 */
export const DEFAULT_STAGES: FreqStage[] = [
  { span_hz: 1_000_000, rbw_hz: 10_000, vbw_hz: 10_000 },
  { span_hz: 20_000, rbw_hz: 300, vbw_hz: 300 },
  { span_hz: 1_000, rbw_hz: 10, vbw_hz: 10 },
]

export const MAX_STAGES = 6

/** Problems with a stage list, for the Run button's reason. Empty when fine. */
export function stageProblems(stages: FreqStage[]): string[] {
  const out: string[] = []
  if (stages.length === 0) out.push('Add at least one stage')
  stages.forEach((s, i) => {
    const n = i + 1
    if (!(s.span_hz > 0) || !(s.rbw_hz > 0) || !(s.vbw_hz > 0)) {
      out.push(`Stage ${n}: span, RBW and VBW must be positive`)
    } else if (s.rbw_hz >= s.span_hz) {
      out.push(`Stage ${n}: RBW must be narrower than the span`)
    }
    const prev = stages[i - 1]
    if (prev && s.span_hz >= prev.span_hz) out.push(`Stage ${n}: span must be narrower than stage ${i}`)
  })
  return out
}

/** "1 MHz", "20 kHz", "10 Hz" -- a span or bandwidth as typed on an analyzer. */
export function formatHz(hz: number): string {
  const a = Math.abs(hz)
  const [div, unit] = a >= 1e9 ? [1e9, 'GHz'] : a >= 1e6 ? [1e6, 'MHz'] : a >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz']
  return `${Number((hz / div).toPrecision(6))} ${unit}`
}

/** The measured frequency in MHz to the hertz: 902.300 172. The last stage
 *  resolves about a hertz per trace bin, so a tenth would be false precision. */
export function formatMhzToHz(hz: number): string {
  const [int, frac] = (Math.round(hz) / 1e6).toFixed(6).split('.')
  return `${int}.${frac.slice(0, 3)} ${frac.slice(3)}`
}

/** MHz to the hertz, plain, for tables, the log and CSV: 902.300172. */
export function mhzToHz(hz: number): string {
  return (Math.round(hz) / 1e6).toFixed(6)
}

/** Signed error in whole hertz: "+4 322". Rounded before the sign is taken,
 *  so −0.4 Hz reads 0 rather than −0. */
export function formatErrorHz(hz: number): string {
  const r = Math.round(hz)
  const sign = r > 0 ? '+' : r < 0 ? '−' : ''
  return `${sign}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

export const PA_MODE_LABEL: Record<number, string> = { 0: 'Off', 1: 'On', 2: 'Auto' }

/** Pass when the error is inside ± `limitPpm`; null with no limit to judge by. */
export function ppmVerdict(errorPpm: number | null | undefined, limitPpm: number | null): 'pass' | 'fail' | null {
  if (errorPpm == null || limitPpm == null) return null
  return Math.abs(errorPpm) <= limitPpm ? 'pass' : 'fail'
}

/** One row of the Automation tab's plan: a frequency spec ("868.1, 902.3-927.5:0.2")
 *  with the power and PA mode it is sent at. */
export interface PlanRow {
  freq: string
  power: string
  paMode: number
}

export interface PlanPoint {
  freqMhz: number
  power: number
  paMode: number
}

/** A row's frequencies, or null when its spec does not parse. */
export function rowFreqs(r: PlanRow): number[] | null {
  if (r.freq.trim() === '') return []
  const f = parseRangeSpec(r.freq).filter((x) => x > 0)
  return f.length ? f : null
}

/** A row's power, or null unless it is a whole dBm the DUT takes (0..255). */
export function rowPower(r: PlanRow): number | null {
  const p = Number(r.power)
  return r.power.trim() !== '' && Number.isInteger(p) && p >= 0 && p <= 255 ? p : null
}

/** Every point the plan measures, in table order. Rows that do not parse
 *  contribute nothing; the page marks them and blocks Run. */
export function planPoints(rows: PlanRow[]): PlanPoint[] {
  const out: PlanPoint[] = []
  for (const r of rows) {
    const freqs = rowFreqs(r)
    const power = rowPower(r)
    if (!freqs || power == null) continue
    for (const f of freqs) out.push({ freqMhz: f, power, paMode: r.paMode })
  }
  return out
}

export const DEFAULT_ROWS: PlanRow[] = [
  { freq: '902.3', power: '14', paMode: 2 },
  { freq: '915', power: '14', paMode: 2 },
  { freq: '927.5', power: '14', paMode: 2 },
]

/** Settle in ms: a whole number at or above the rig's floor (lib/settle.ts),
 *  and not past the backend's 10 s ceiling. */
export function settleValid(raw: string): boolean {
  const v = Number(raw)
  return raw.trim() !== '' && Number.isFinite(v) && v >= MIN_SETTLE_MS && v <= 10_000
}

export function limitValid(raw: string): boolean {
  return raw.trim() === '' || (Number.isFinite(Number(raw)) && Number(raw) > 0)
}

export function limitOf(raw: string): number | null {
  return raw.trim() === '' || !limitValid(raw) ? null : Number(raw)
}
