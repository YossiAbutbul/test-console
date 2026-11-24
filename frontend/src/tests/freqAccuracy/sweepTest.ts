/**
 * Frequency accuracy as a Test Sequence step (LoRa, LTE): settings → plan →
 * what the backend runs (backend/sequence/steps.py `_FreqAccuracy`), and the
 * results as the page's own table, export and report have them.
 *
 * The page (FreqAccuracyPage) runs its plan through its own backend route;
 * a step runs the same zoom, point for point, through the sequence runner.
 * Settings are the page's Automation tab's: the rows, and the Measure
 * settings (stages, settle, each stage's tolerance).
 */
import type { InstrumentId } from '../../context/InstrumentsContext'
import { DEFAULT_BANDS } from '../../lib/earfcn'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { storage } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { valuesText, type JudgedRow, type SweepTest } from '../engine/sweepTest'
import type { ChannelUnit } from '../lte/channel'
import type { AutoResult } from './AutomationPanel'
import type { MeasureSettings } from './MeasureSection'
import { LORA, LTE_MAX_POWER_DBM, convertSpec, type Radio, type RadioId } from './radio'
import {
  DEFAULT_ROWS, DEFAULT_STAGES, DEFAULT_TOL_PPM, PA_MODE_LABEL, estimateRunMs, formatHz, limitOf, limitValid,
  mhzToHz, normaliseRow, planPoints, settleValid, stageProblems, stageTols, type PlanPoint, type PlanRow,
} from './stages'

/** A step's settings, as the page keeps its Automation tab. */
export interface FreqRaw {
  rows?: PlanRow[]
  measure?: Partial<MeasureSettings>
  /** LTE: the unit the rows are typed in, and the bands MHz resolves in. */
  unit?: ChannelUnit
  bands?: number[]
}

export interface FreqSettings {
  radio: Radio
  rows: PlanRow[]
  measure: MeasureSettings
  settleMs: number
}

/** A measured point: the page's result, with the verdict and error every
 *  sequence row carries. */
export type FreqRow = AutoResult & JudgedRow

export const FREQ_MEASURE_DEFAULTS: MeasureSettings = { stages: DEFAULT_STAGES, settleMs: String(DEFAULT_SETTLE_MS) }

/** The LTE page's opening rows: band 2 at the modem's full power. */
const LTE_DEFAULT_ROWS: PlanRow[] = ['1860', '1880', '1900']
  .map((freq) => ({ freq, power: String(LTE_MAX_POWER_DBM), paMode: 0, tolPpm: DEFAULT_TOL_PPM }))

const CSV_TAIL = ['Tolerance [± ppm]', 'Measured [MHz]', 'Error [Hz]', 'Error [ppm]', 'Level [dBm]', 'Verdict', 'Note']

function makeTest(radioId: RadioId): SweepTest<FreqRaw, FreqSettings, PlanPoint, FreqRow> {
  const lte = radioId === 'LTE'
  const header = lte
    ? ['EARFCN', 'Frequency [MHz]', 'Power [dBm]', ...CSV_TAIL]
    : ['Frequency [MHz]', 'Power [dBm]', 'PA mode', ...CSV_TAIL]
  const body = (rows: FreqRow[]) => rows.map((r) => [
    ...(lte ? [r.earfcn ?? '', r.freqMhz, r.power] : [r.freqMhz, r.power, PA_MODE_LABEL[r.paMode] ?? r.paMode]),
    r.limitPpm ?? '',
    r.measuredHz != null ? mhzToHz(r.measuredHz) : '',
    r.errorHz != null ? Math.round(r.errorHz) : '',
    r.errorPpm != null ? r.errorPpm.toFixed(4) : '',
    r.levelDbm != null ? r.levelDbm.toFixed(2) : '',
    r.verdict ?? '', r.note,
  ])
  const blankRow = (p: PlanPoint): FreqRow => ({
    freqMhz: p.freqMhz, earfcn: p.earfcn ?? null, power: p.power, paMode: p.paMode, limitPpm: p.limitPpm,
    stagePpm: [], stageLimits: [], measuredHz: null, errorHz: null, errorPpm: null, levelDbm: null,
    note: '', verdict: null, error: null,
  })
  return {
    // The page's registry ids, so a step's report lands on its page's tab.
    id: lte ? 'lte-freq-accuracy' : 'freq-accuracy',
    label: `${radioId} frequency accuracy`,
    protocol: radioId,
    setup: 'main',
    fromPage: () => {
      const saved = storage.get<Partial<{ rows: PlanRow[]; measure: MeasureSettings; specUnit: ChannelUnit }>>(
        lte ? STORAGE_KEYS.lteFreqAccuracyPage : STORAGE_KEYS.freqAccuracyPage, {},
      )
      if (!lte) return structuredClone({ rows: saved.rows, measure: saved.measure })
      const unit = storage.get<ChannelUnit>(STORAGE_KEYS.lteChannelUnit, 'mhz')
      const bands = storage.get<number[]>(STORAGE_KEYS.lteBands, DEFAULT_BANDS)
      // The page keeps its rows in the unit they were typed in; the step
      // takes them in the unit it will show.
      const rows = saved.rows?.map((r) => ({ ...r, freq: convertSpec(r.freq ?? '', saved.specUnit ?? 'mhz', unit, bands) }))
      return structuredClone({ rows, measure: saved.measure, unit, bands })
    },
    resolve: (raw) => {
      const radio: Radio = lte
        ? { id: 'LTE', unit: raw.unit ?? 'mhz', bands: raw.bands ?? DEFAULT_BANDS }
        : LORA
      const measure: MeasureSettings = { ...FREQ_MEASURE_DEFAULTS, ...raw.measure }
      return {
        radio,
        rows: raw.rows?.length ? raw.rows.map(normaliseRow) : (lte ? LTE_DEFAULT_ROWS : DEFAULT_ROWS).map((r) => ({ ...r })),
        measure,
        settleMs: clampSettleMs(Number(measure.settleMs)),
      }
    },
    plan: (s) => planPoints(s.rows, s.radio),
    problem: (s) => {
      if (s.rows.some((r) => !limitValid(r.tolPpm))) return 'a row has a bad tolerance'
      if (!settleValid(s.measure.settleMs)) return 'settle must be 400–10000 ms'
      const stage = stageProblems(s.measure.stages)[0]
      if (stage) return stage.charAt(0).toLowerCase() + stage.slice(1)
      if (stageTols(s.measure.stageTolPpm, s.measure.stages.length).some((t) => !limitValid(t))) {
        return 'a stage has a bad tolerance'
      }
      return null
    },
    estimateMs: (s, plan) => estimateRunMs(plan.length, s.measure.stages, s.settleMs),
    // The analyzer only: it is what finds the frequency.
    instruments: (): InstrumentId[] => ['spectrum'],
    stepTimeoutMs: (s) => s.measure.stages.length * (s.settleMs + 60_000),
    freqMhz: (p) => p.freqMhz,
    formatFreq: (mhz) => mhz.toFixed(1),
    blankRow,
    wire: (s, plan) => ({
      points: plan.map((p) => ({
        freq_mhz: p.freqMhz, earfcn: p.earfcn ?? null, power_dbm: p.power, pa_mode: p.paMode, limit_ppm: p.limitPpm,
      })),
      settle_ms: s.settleMs,
      // Not read: the zoom reads the analyzer itself.
      power: { source: 'spectrum' },
      freq: {
        stages: s.measure.stages,
        stage_limits_ppm: stageTols(s.measure.stageTolPpm, s.measure.stages.length).map(limitOf),
      },
    }),
    // As the page's Add to report writes it, so it lands on the same tab.
    report: (s, rows) => {
      const tols = stageTols(s.measure.stageTolPpm, s.measure.stages.length)
      return {
        test: lte ? 'lte-frequency-accuracy' : 'frequency-accuracy',
        title: `${radioId} frequency accuracy`,
        settings: [
          ['Settle', `${s.settleMs} ms`],
          ...s.measure.stages.map((st, i): [string, string] => [
            `Stage ${i + 1}`,
            `span ${formatHz(st.span_hz)}, RBW ${formatHz(st.rbw_hz)}, VBW ${formatHz(st.vbw_hz)}`
              + (tols[i].trim() ? `, within ± ${tols[i]} ppm` : ''),
          ]),
        ],
        columns: [...header],
        rows: body(rows),
      }
    },
    csv: (rows) => ({ header: [...header], body: body(rows) }),
    summary: (_s, plan) => {
      const f = valuesText(plan.map((p) => p.freqMhz), lte ? (v) => v.toFixed(1) : String)
      return f && `${f} MHz`
    },
  }
}

export const loraFreqAccuracyTest = makeTest('LoRa')
export const lteFreqAccuracyTest = makeTest('LTE')
