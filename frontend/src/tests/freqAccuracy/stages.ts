import type { FreqStage } from '../../api/freqAccuracy'
import { LORA, powersOf, resolveSpec, type Channel, type Radio } from './radio'
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
 *  with the power and PA mode it is sent at, and the +- ppm its points must be
 *  within (blank: measured, not judged). */
export interface PlanRow {
  freq: string
  power: string
  paMode: number
  tolPpm: string
}

export interface PlanPoint {
  freqMhz: number
  /** LTE: the channel keyed; `freqMhz` is its uplink centre. */
  earfcn?: number
  power: number
  paMode: number
  limitPpm: number | null
}

export const DEFAULT_TOL_PPM = '30'

/** A row read back from storage: rows saved before the tolerance moved onto
 *  the row have none, and take the old run-wide default. */
export function normaliseRow(r: Partial<PlanRow>): PlanRow {
  return { freq: r.freq ?? '', power: r.power ?? '14', paMode: r.paMode ?? 2, tolPpm: r.tolPpm ?? DEFAULT_TOL_PPM }
}

/** A row's channels (for LoRa, its frequencies; for LTE, EARFCNs or MHz as
 *  the unit reads them), or null when its spec does not resolve. */
export function rowChannels(r: PlanRow, radio: Radio = LORA): Channel[] | null {
  return resolveSpec(r.freq, radio)
}

/** A row's powers ("14", "0,16,30", "10-20:5"), or null unless every one is
 *  one the radio takes (LoRa a whole dBm 0..255, LTE up to 23 dBm). */
export function rowPowers(r: PlanRow, radio: Radio = LORA): number[] | null {
  return powersOf(r.power, radio)
}

/** Points one row expands to: each channel at each power. */
export function rowPointCount(r: PlanRow, radio: Radio = LORA): number {
  return (rowChannels(r, radio)?.length ?? 0) * (rowPowers(r, radio)?.length ?? 0)
}

/** Every point the plan measures, in table order: each channel at each of its
 *  row's powers. Rows that do not resolve contribute nothing; the page marks
 *  them and blocks Run. */
export function planPoints(rows: PlanRow[], radio: Radio = LORA): PlanPoint[] {
  const out: PlanPoint[] = []
  for (const r of rows) {
    const chans = rowChannels(r, radio)
    const powers = rowPowers(r, radio)
    if (!chans || !powers) continue
    const limitPpm = limitOf(r.tolPpm)
    for (const c of chans) {
      for (const power of powers) {
        out.push({ freqMhz: c.freqMhz, earfcn: c.earfcn, power, paMode: r.paMode, limitPpm })
      }
    }
  }
  return out
}

/** Rough run time for `points`, shown before Run: per point the CW command and
 *  key-off, then per stage the settle and a sweep (narrow RBWs sweep slowest). */
export function estimateRunMs(points: number, stages: FreqStage[], settleMs: number): number {
  const perStage = stages.reduce((t, s) => t + settleMs + (s.rbw_hz < 100 ? 1500 : 500), 0)
  return points * (1000 + perStage)
}

export const DEFAULT_ROWS: PlanRow[] = [
  { freq: '902.3', power: '14', paMode: 2, tolPpm: DEFAULT_TOL_PPM },
  { freq: '915', power: '14', paMode: 2, tolPpm: DEFAULT_TOL_PPM },
  { freq: '927.5', power: '14', paMode: 2, tolPpm: DEFAULT_TOL_PPM },
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

/** A stage's peak as an error in ppm of the nominal frequency. */
export function stagePpm(markerHz: number, nominalHz: number): number {
  return ((markerHz - nominalHz) / nominalHz) * 1e6
}

/** One verdict from several: any fail fails; a pass needs at least one
 *  judged check and no fail; nothing judged is no verdict. */
export function combineVerdicts(vs: ('pass' | 'fail' | null)[]): 'pass' | 'fail' | null {
  if (vs.includes('fail')) return 'fail'
  return vs.includes('pass') ? 'pass' : null
}

/** A point's verdict: its final error against its own tolerance, and each
 *  stage's peak against that stage's tolerance. */
export function pointVerdict(
  finalPpm: number | null | undefined, limitPpm: number | null,
  stagePpms: number[], stageLimits: (number | null)[],
): 'pass' | 'fail' | null {
  if (finalPpm == null) return null
  return combineVerdicts([
    ppmVerdict(finalPpm, limitPpm),
    ...stagePpms.map((p, i) => ppmVerdict(p, stageLimits[i] ?? null)),
  ])
}

/** The stage tolerances, one per stage: saved settings from before stages
 *  had one, or a list out of step after an edit, are padded with the default. */
export function stageTols(raw: string[] | undefined, n: number): string[] {
  return Array.from({ length: n }, (_, i) => raw?.[i] ?? DEFAULT_TOL_PPM)
}

export function limitOf(raw: string): number | null {
  return raw.trim() === '' || !limitValid(raw) ? null : Number(raw)
}
