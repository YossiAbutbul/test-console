/**
 * The BLE CW sweep, without its panel: settings → plan → what a run sends.
 * The panel (`BleAutomationPanel.tsx`) and the Full Run page both run it from
 * here; see `engine/sweepTest.ts`.
 */
import type { InstrumentId } from '../../context/InstrumentsContext'
import {
  powerInstrument, powerSourceOf, wiredPowerOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import {
  bleCwPageSnapshot, type BleAutomationResultRow, type BleAutomationRow, type BleChannelUnit,
  type BleCwPageSnapshot,
} from '../../store/bleCwPageStore'
import { valuesText, type SweepTest } from '../engine/sweepTest'
import { DURATION_MAX_S } from '../ble/radio'
import { CSV_HEADER, toCsvBody } from './csv'
import {
  AUTO_TONE_MAX_S, AUTO_TONE_TYPICAL_S, buildPlan, estimateRunMs, minToneSeconds,
  rowIssues, stepBudgetMs, type PlanPoint,
} from './plan'

type ResultRow = BleAutomationResultRow
type SweepRow = BleAutomationRow

/** The sweep's settings as the page snapshot holds them, with the channel
 *  unit the rows are read in -- page-wide on the BLE page, but part of what a
 *  Full Run step's rows mean. */
export type BleCwRaw = Omit<NonNullable<BleCwPageSnapshot['automation']>, 'results'> & {
  unit?: BleChannelUnit
}

/** The same, resolved. */
export interface BleCwSettings {
  rows: SweepRow[]
  settleMs: number
  powerSrc: PowerSourceState
  /** Whole seconds as typed, or '' for auto. */
  toneSeconds: string
  unit: BleChannelUnit
}

/** Beside the one that reads power, which the power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

/** Blank: auto. Every second of tone past the reading is a second the run
 *  waits per point with the DUT unreachable, so by default the run sizes it
 *  from the measurement itself (`autoToneSeconds`). A number fixes it. */
export const DEFAULT_TONE_S = ''

export const DEFAULT_ROW: SweepRow = { channel: '0,19,39', power: '31', minDbm: '', maxDbm: '' }

/** The row a fresh sweep opens with, in the unit it opens in. */
export const defaultRows = (unit: BleChannelUnit): SweepRow[] =>
  [unit === 'mhz' ? { ...DEFAULT_ROW, channel: '2402,2440,2480' } : DEFAULT_ROW]

export function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    channel: r.channel ?? '',
    power: r.power ?? DEFAULT_ROW.power,
    minDbm: r.minDbm ?? '',
    maxDbm: r.maxDbm ?? '',
  }
}

/**
 * The tone duration these settings ask for.
 *
 * Whole seconds, and long enough that the reading lands while the tone is
 * still on air -- one that ends first measures the noise floor and records it
 * as the DUT's power.
 */
export function toneOf(s: Pick<BleCwSettings, 'toneSeconds' | 'settleMs'>) {
  const auto = s.toneSeconds.trim() === ''
  const fixed = Number(s.toneSeconds)
  const min = minToneSeconds(s.settleMs)
  const valid = auto || (Number.isInteger(fixed) && fixed >= min && fixed <= DURATION_MAX_S)
  /** What the estimate and the step budget assume a point's tone is. */
  const planS = auto ? AUTO_TONE_TYPICAL_S : fixed
  return { auto, fixed, min, valid, planS }
}

/** A row with a bad field contributes no points; it blocks the run rather
 *  than vanishing from the plan. */
export const anyRowInvalid = (rows: SweepRow[], unit: BleChannelUnit): boolean =>
  rows.some((r) => {
    if (r.channel.trim() === '') return false
    const i = rowIssues(r, unit)
    return !!(i.channel || i.power || i.limits)
  })

export const blankRow = (item: PlanPoint): ResultRow => ({
  channel: item.channel,
  freq_mhz: item.freqMhz,
  power_param: item.power,
  measured_dbm: null,
  measured_dbm_raw: null,
  current_a: null,
  voltage_v: null,
  min_dbm: item.minDbm,
  max_dbm: item.maxDbm,
  verdict: null,
  status: null,
  ok: false,
  error: null,
})

export const bleCwTest: SweepTest<BleCwRaw, BleCwSettings, PlanPoint, ResultRow> = {
  id: 'ble-cw',
  label: 'BLE CW',
  protocol: 'BLE',
  setup: 'ble',
  needs: 'ble-link',
  fromPage: () => {
    const a = bleCwPageSnapshot.automation ?? {}
    return structuredClone({
      rows: a.rows, settleMs: a.settleMs, powerSource: a.powerSource,
      toneFixedSeconds: a.toneFixedSeconds, unit: bleCwPageSnapshot.unit ?? 'channel',
    })
  },
  resolve: (raw) => {
    const unit = raw.unit ?? 'channel'
    return {
      rows: raw.rows?.length ? raw.rows.map(normaliseRow) : defaultRows(unit),
      settleMs: clampSettleMs(raw.settleMs ?? DEFAULT_SETTLE_MS),
      powerSrc: powerSourceOf(raw.powerSource),
      toneSeconds: raw.toneFixedSeconds ?? DEFAULT_TONE_S,
      unit,
    }
  },
  plan: (s) => buildPlan(s.rows, s.unit),
  problem: (s) => {
    if (anyRowInvalid(s.rows, s.unit)) return 'a row has a bad channel, power or limit'
    if (!toneOf(s).valid) return 'the tone must be blank (auto) or whole seconds long enough for the reading'
    if (!powerSourceValid(s.powerSrc)) return 'spectrum analyzer settings must be positive numbers'
    return null
  },
  estimateMs: (s, plan) => {
    const t = toneOf(s)
    return t.valid ? estimateRunMs(plan, t.planS) : 0
  },
  instruments: (s) => [powerInstrument(s.powerSrc), ...REQUIRED_INSTRUMENTS],
  stepTimeoutMs: (s) => {
    const t = toneOf(s)
    return stepBudgetMs(t.auto ? AUTO_TONE_MAX_S : t.fixed)
  },
  freqMhz: (p) => p.freqMhz,
  blankRow,

  wire: (s, plan) => {
    const tone = toneOf(s)
    return {
      points: plan.map((p) => ({
        channel: p.channel, freq_mhz: p.freqMhz, power: p.power, min_dbm: p.minDbm, max_dbm: p.maxDbm,
      })),
      settle_ms: s.settleMs, power: wiredPowerOf(s.powerSrc), tone_s: tone.auto ? null : tone.fixed,
    }
  },

  report: (s, rows) => ({
    test: 'ble-cw-automation', title: 'BLE CW automation',
    settings: [['Settle', `${s.settleMs} ms`], ['Tone', toneOf(s).auto ? 'auto' : `${s.toneSeconds} s`]],
    columns: [...CSV_HEADER], rows: toCsvBody(rows),
  }),
  csv: (rows) => ({ header: [...CSV_HEADER], body: toCsvBody(rows) }),
  summary: (_s, plan) => {
    const c = valuesText(plan.map((p) => p.channel))
    return c && `Ch ${c}`
  },
}
