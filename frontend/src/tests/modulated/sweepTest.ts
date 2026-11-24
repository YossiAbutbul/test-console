/**
 * The LoRa modulated sweep, without its panel: settings → plan → what a run
 * sends. The panel (`AutomationPanel.tsx`) and the Full Run page both run it
 * from here; see `engine/sweepTest.ts`.
 */
import type { InstrumentId } from '../../context/InstrumentsContext'
import { parseRangeSpec } from '../../lib/numericList'
import {
  powerInstrument, powerSourceOf, wiredPowerOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { parseLimit } from '../../lib/verdict'
import {
  modulatedPageSnapshot, type ModulatedPageSnapshot, type ModulatedResultRow, type ModulatedSweepRow,
} from '../../store/modulatedPageStore'
import { STEP_OVERHEAD_TIMEOUT_MS } from '../engine/automationLayout'
import { valuesText, type SweepTest } from '../engine/sweepTest'
import { CSV_HEADER, toCsvBody } from './csv'
import { MODEM_FSK, MODEM_LORA, SF_DEFAULT, drRange } from './signal'

type ResultRow = ModulatedResultRow
type SweepRow = ModulatedSweepRow

/** The sweep's settings as the page snapshot holds them. */
export type ModulatedRaw = Omit<NonNullable<ModulatedPageSnapshot['automation']>, 'results'>

/** The same, resolved. */
export interface ModulatedSettings {
  rows: SweepRow[]
  settleMs: number
  powerSrc: PowerSourceState
}

/** Beside the one that reads power, which the power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

export const DEFAULT_POWER = '14'

export const DEFAULT_ROW: SweepRow = {
  freq: '',
  power: DEFAULT_POWER,
  modem: MODEM_LORA,
  bandwidth: 0,
  datarate: SF_DEFAULT,
  marginDb: '1',
}

/** Fill in a row read back from storage. Snapshots written before the signal
 *  fields moved onto the row hold only freq and power. */
export function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    freq: r.freq ?? '',
    power: r.power ?? DEFAULT_POWER,
    modem: r.modem ?? MODEM_LORA,
    bandwidth: r.bandwidth ?? 0,
    datarate: r.datarate ?? SF_DEFAULT,
    marginDb: r.marginDb ?? '1',
  }
}

/** FSK has no bandwidth of its own — the DUT expects 0. Applied at the point of
 *  use so a stale value can never reach the wire, not even for one render. */
export const effectiveBw = (r: SweepRow): number => (r.modem === MODEM_FSK ? 0 : r.bandwidth)

export const drValid = (r: SweepRow): boolean => {
  const { min, max } = drRange(r.modem)
  return Number.isInteger(r.datarate) && r.datarate >= min && r.datarate <= max
}

/**
 * A blank tolerance is not an error — it means this row's points are simply
 * not judged, and they report N/A rather than pass or fail.
 *
 * Only a value that is there but unusable counts as wrong: junk, or a negative
 * tolerance, both of which say the operator meant something they did not type.
 */
export const marginValid = (r: SweepRow): boolean => {
  if (r.marginDb.trim() === '') return true
  const m = parseLimit(r.marginDb)
  return m != null && m >= 0
}

export interface PlanPoint {
  freq: number
  pow: number
  modem: number
  bandwidth: number
  datarate: number
  /** Tolerance in dB around `pow`, or null when this row is not judged. */
  marginDb: number | null
}

/** Points one row expands to. An empty power falls back to the default. */
export function rowPoints(r: SweepRow): PlanPoint[] {
  const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
  if (freqs.length === 0 || !drValid(r) || !marginValid(r)) return []
  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
  const out: PlanPoint[] = []
  for (const f of freqs) {
    for (const p of powers) {
      out.push({
        freq: f,
        pow: p,
        modem: r.modem,
        bandwidth: effectiveBw(r),
        datarate: r.datarate,
        marginDb: parseLimit(r.marginDb),
      })
    }
  }
  return out
}

export const blankRow = (item: PlanPoint): ResultRow => ({
  freq_mhz: item.freq,
  set_power_dbm: item.pow,
  modem: item.modem,
  bandwidth: item.bandwidth,
  datarate: item.datarate,
  measured_dbm: null,
  measured_dbm_raw: null,
  current_a: null,
  voltage_v: null,
  margin_db: item.marginDb,
  verdict: null,
  ok: false,
  status: null,
  error: null,
})


/** The rows a fresh sweep opens with. */
export const DEFAULT_ROWS: SweepRow[] = [
  { ...DEFAULT_ROW, freq: '902.3' },
  { ...DEFAULT_ROW, freq: '915.0' },
  { ...DEFAULT_ROW, freq: '927.5' },
]

/** A row with a bad datarate or tolerance contributes no points, so it would
 *  otherwise vanish from the plan silently rather than blocking the run. */
export const rowInvalid = (r: SweepRow): boolean =>
  r.freq.trim() !== '' && (!drValid(r) || !marginValid(r))

export const modulatedTest: SweepTest<ModulatedRaw, ModulatedSettings, PlanPoint, ResultRow> = {
  id: 'modulated',
  label: 'LoRa modulated',
  protocol: 'LoRa',
  setup: 'main',
  fromPage: () => {
    const a = modulatedPageSnapshot.automation ?? {}
    return structuredClone({ rows: a.rows, settleMs: a.settleMs, powerSource: a.powerSource })
  },
  resolve: (raw) => ({
    rows: raw.rows?.length ? raw.rows.map(normaliseRow) : DEFAULT_ROWS.map((r) => ({ ...r })),
    // Clamped on read: a snapshot saved before the floor existed can hold a
    // value below it, and restoring one would reintroduce the bad readings.
    settleMs: clampSettleMs(raw.settleMs ?? DEFAULT_SETTLE_MS),
    powerSrc: powerSourceOf(raw.powerSource),
  }),
  plan: (s) => s.rows.flatMap(rowPoints),
  problem: (s) => {
    if (s.rows.some(rowInvalid)) return 'a row has a bad datarate or tolerance'
    if (!powerSourceValid(s.powerSrc)) return 'spectrum analyzer settings must be positive numbers'
    return null
  },
  // Settle dominates; the command + measure round trips add roughly 300 ms.
  estimateMs: (s, plan) => plan.length * (s.settleMs + 300),
  instruments: (s) => [powerInstrument(s.powerSrc), ...REQUIRED_INSTRUMENTS],
  stepTimeoutMs: (s) => s.settleMs + STEP_OVERHEAD_TIMEOUT_MS,
  freqMhz: (p) => p.freq,
  blankRow,

  wire: (s, plan) => ({
    points: plan.map((p) => ({
      freq_mhz: p.freq, power_dbm: p.pow, modem: p.modem, bandwidth: p.bandwidth, datarate: p.datarate,
      margin_db: p.marginDb,
    })),
    settle_ms: s.settleMs, power: wiredPowerOf(s.powerSrc),
  }),

  report: (s, rows) => ({
    test: 'lora-modulated-automation', title: 'LoRa modulated automation',
    settings: [['Settle', `${s.settleMs} ms`]],
    columns: [...CSV_HEADER], rows: toCsvBody(rows),
  }),
  csv: (rows) => ({ header: [...CSV_HEADER], body: toCsvBody(rows) }),
  summary: (_s, plan) => {
    const f = valuesText(plan.map((p) => p.freq))
    return f && `${f} MHz`
  },
}
