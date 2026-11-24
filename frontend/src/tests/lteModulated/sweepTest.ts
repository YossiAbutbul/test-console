/**
 * The LTE modulated sweep, without its panel: settings → plan → what a run
 * sends. The panel (`AutomationPanel.tsx`) and the Full Run page both run it from
 * here; see `engine/sweepTest.ts`.
 */
import type { InstrumentId } from '../../context/InstrumentsContext'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch, DEFAULT_BANDS } from '../../lib/earfcn'
import { parseRangeSpec } from '../../lib/numericList'
import {
  powerInstrument, powerSourceOf, wiredPowerOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { parseLimit } from '../../lib/verdict'
import { storage } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import {
  lteModulatedPageSnapshot, type LteModulatedPageSnapshot, type LteModulatedResultRow, type LteModulatedRow,
} from '../../store/lteModulatedPageStore'
import type { LteModulatedRequest } from '../../types/models'
import { valuesText, type SweepTest } from '../engine/sweepTest'
import type { ChannelUnit } from '../lte/channel'
import { CSV_HEADER, toCsvBody } from './csv'
import { BW_DEFAULT, MCS_DEFAULT, MCS_MAX, MCS_MIN, RB_DEFAULT, rbForBandwidth } from './signal'

type ResultRow = LteModulatedResultRow
type SweepRow = LteModulatedRow

/** The sweep's settings as the page snapshot holds them, with the channel
 *  unit and bands the rows are read in -- page-wide on the LTE pages, but
 *  part of what a Full Run step's rows mean. */
export type LteModulatedRaw = Omit<NonNullable<LteModulatedPageSnapshot['automation']>, 'results'> & {
  unit?: ChannelUnit
  bands?: number[]
}

/** The same, resolved. */
export interface LteModulatedSettings {
  rows: SweepRow[]
  settleMs: number
  powerSrc: PowerSourceState
  unit: ChannelUnit
  bands: number[]
}

/** Beside the one that reads power, which the panel's power source names. */
export const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

/** Budget for the commands + measurement either side of the settle delay. A
 *  point sends two frames rather than one, so this sits above the LoRa figure. */
export const STEP_OVERHEAD_TIMEOUT_MS = 40_000

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
export const MAX_POWER_DBM = 23

/**
 * Per-point transmit duration, fixed rather than configurable.
 *
 * The run aborts each point as soon as it has measured, so this is only ever a
 * backstop: it has to outlast one settle plus a reading, and beyond that a
 * larger number just means a longer stuck transmission if an abort is ever
 * missed. 20 s clears a point many times over.
 */
export const TX_TIME_MS = 20_000

export const DEFAULT_POWER = '23'

/** The modem power-cycle at the start of a run; see `useLteModem.cycle`. */
export const MODEM_RESTART_MS = 10_000

/**
 * Most channels a spec is rewritten across on a unit switch.
 *
 * Conversion is exact — every value is resolved and re-emitted as a comma
 * list, so the set of channels is unchanged — but a 200-channel sweep would
 * become an unreadable wall of text. Past this the spec is left alone and the
 * row asks to be re-entered in the new unit.
 */
export const MAX_CONVERT = 32

export const DEFAULT_ROW: SweepRow = {
  earfcn: '',
  power: DEFAULT_POWER,
  bandwidth: BW_DEFAULT,
  mcs: MCS_DEFAULT,
  rbCount: RB_DEFAULT,
  marginDb: '1',
}

/** Fill in a row read back from storage, so a snapshot written before a column
 *  existed still loads. */
export function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    earfcn: r.earfcn ?? '',
    power: r.power ?? DEFAULT_POWER,
    bandwidth: r.bandwidth ?? BW_DEFAULT,
    mcs: r.mcs ?? MCS_DEFAULT,
    rbCount: r.rbCount ?? RB_DEFAULT,
    marginDb: r.marginDb ?? '1',
  }
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

export const mcsValid = (r: SweepRow): boolean =>
  Number.isInteger(r.mcs) && r.mcs >= MCS_MIN && r.mcs <= MCS_MAX

/** An allocation wider than the channel is not something the modem can
 *  transmit — the backend refuses it, so it is caught here first. */
export const rbValid = (r: SweepRow): boolean =>
  Number.isInteger(r.rbCount) && r.rbCount >= 1 && r.rbCount <= rbForBandwidth(r.bandwidth)

export interface PlanPoint {
  earfcn: number
  band: number
  freqMhz: number
  pow: number
  bandwidth: number
  mcs: number
  rbCount: number
  /** Tolerance in dB around `pow`, or null when this row is not judged. */
  marginDb: number | null
}

/**
 * Rewrite a channel spec into the other unit.
 *
 * Switching units used to leave every row holding a number that meant
 * nothing in the new one, so the whole list lit up red before the operator
 * had typed anything. Converting keeps the channels they picked.
 *
 * Returns the spec untouched if any value cannot be resolved: a
 * half-converted list would be worse than one the operator can see is stale.
 */
export function convertSpec(spec: string, from: ChannelUnit, to: ChannelUnit, bands: number[]): string {
  if (from === to || spec.trim() === '') return spec
  const nums = parseRangeSpec(spec)
  if (nums.length === 0 || nums.length > MAX_CONVERT) return spec
  const out: number[] = []
  for (const n of nums) {
    if (from === 'earfcn') {
      const ch = uplinkFromEarfcn(n)
      if (!ch) return spec
      out.push(ch.freqHz / 1e6)
    } else {
      const hits = uplinkFromMhz(n, bands)
      if (hits.length !== 1) return spec
      out.push(hits[0].earfcn)
    }
  }
  return out.join(',')
}

/**
 * Channels a spec names, read in whichever unit is selected.
 *
 * Values that resolve to nothing are dropped, as are MHz values covered by
 * more than one selected band — the row editor counts the gap and flags it,
 * rather than this quietly picking a band on the operator's behalf.
 */
export function toChannels(spec: string, unit: ChannelUnit, bands: number[]): UplinkMatch[] {
  const nums = parseRangeSpec(spec)
  if (unit === 'earfcn') {
    return nums.flatMap((n) => {
      if (!Number.isInteger(n) || n < 0) return []
      const ch = uplinkFromEarfcn(n)
      return ch ? [{ ...ch, earfcn: n }] : []
    })
  }
  return nums.flatMap((m) => {
    const hits = uplinkFromMhz(m, bands)
    return hits.length === 1 ? hits : []
  })
}

/**
 * Points one row expands to.
 *
 * Channels outside the band table are dropped rather than run. The point of
 * an automation run is the measurement, and without a frequency there is
 * nothing to calibrate the sensor to or to pick a path-loss figure with — a
 * row of numbers measured against the wrong channel is worse than a row that
 * was never taken. The editor flags them so it is a config error, not a
 * surprise forty points in.
 */
export function rowPoints(r: SweepRow, unit: ChannelUnit, bands: number[]): PlanPoint[] {
  const channels = toChannels(r.earfcn, unit, bands)
  if (channels.length === 0 || !marginValid(r) || !mcsValid(r) || !rbValid(r)) return []
  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
    .filter((p) => p >= 0 && p <= MAX_POWER_DBM)
  const margin = parseLimit(r.marginDb)
  const out: PlanPoint[] = []
  for (const ch of channels) {
    for (const p of powers) {
      out.push({
        earfcn: ch.earfcn,
        band: ch.band,
        freqMhz: ch.freqHz / 1e6,
        pow: p,
        bandwidth: r.bandwidth,
        mcs: r.mcs,
        rbCount: r.rbCount,
        marginDb: margin,
      })
    }
  }
  return out
}

export const blankRow = (item: PlanPoint): ResultRow => ({
  earfcn: item.earfcn,
  band: item.band,
  freq_mhz: item.freqMhz,
  set_power_dbm: item.pow,
  bandwidth: item.bandwidth,
  mcs: item.mcs,
  rb_count: item.rbCount,
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

export const paramsFor = (item: PlanPoint): LteModulatedRequest => ({
  earfcn: item.earfcn,
  time_ms: TX_TIME_MS,
  tx_power_dbm: item.pow,
  bandwidth: item.bandwidth,
  mcs: item.mcs,
  rb_count: item.rbCount,
  // Left at the start of the channel. The byte order of rb_start and
  // nb_index is the one part of the frame the captures do not pin, so a
  // sweep — which runs unattended — stays on the values both captures carry.
  // The manual tab is where an unverified allocation can be tried.
  rb_start: 0,
  nb_index: 0,
})


/** The row a fresh sweep opens with: the same channel in either unit, so a
 *  page opening in MHz does not greet the operator with an EARFCN flagged
 *  invalid. */
export const defaultRows = (unit: ChannelUnit): SweepRow[] =>
  [{ ...DEFAULT_ROW, earfcn: unit === 'mhz' ? '1880' : '18900' }]

/** A row with a bad field contributes no points, so it would otherwise vanish
 *  from the plan silently rather than blocking the run. */
export const rowInvalid = (r: SweepRow): boolean => r.earfcn.trim() !== '' && (!marginValid(r) || !mcsValid(r) || !rbValid(r))

export const lteModulatedTest: SweepTest<LteModulatedRaw, LteModulatedSettings, PlanPoint, ResultRow> = {
  id: 'lte-modulated',
  label: 'LTE modulated',
  protocol: 'LTE',
  setup: 'main',
  needs: 'lte-modem',
  fromPage: () => {
    const a = lteModulatedPageSnapshot.automation ?? {}
    return structuredClone({
      rows: a.rows, settleMs: a.settleMs, powerSource: a.powerSource,
      unit: storage.get<ChannelUnit>(STORAGE_KEYS.lteChannelUnit, 'mhz'),
      bands: storage.get<number[]>(STORAGE_KEYS.lteBands, DEFAULT_BANDS),
    })
  },
  resolve: (raw) => {
    const unit = raw.unit ?? 'mhz'
    return {
      rows: raw.rows?.length ? raw.rows.map(normaliseRow) : defaultRows(unit),
      // Clamped on read: a snapshot saved before the floor existed can hold a
      // value below it, and restoring one would reintroduce the bad readings.
      settleMs: clampSettleMs(raw.settleMs ?? DEFAULT_SETTLE_MS),
      powerSrc: powerSourceOf(raw.powerSource),
      unit,
      bands: raw.bands ?? DEFAULT_BANDS,
    }
  },
  plan: (s) => s.rows.flatMap((r) => rowPoints(r, s.unit, s.bands)),
  problem: (s) => {
    if (s.rows.some(rowInvalid)) return 'a row has a bad tolerance, MCS or RB count'
    if (!powerSourceValid(s.powerSrc)) return 'spectrum analyzer settings must be positive numbers'
    return null
  },
  // Settle dominates; the two commands + measure round trips add roughly
  // 400 ms. The run power-cycles the modem before its first point, inside the
  // running window, so the countdown has to allow for it too.
  estimateMs: (s, plan) => plan.length * (s.settleMs + 400) + MODEM_RESTART_MS,
  instruments: (s) => [powerInstrument(s.powerSrc), ...REQUIRED_INSTRUMENTS],
  stepTimeoutMs: (s) => s.settleMs + STEP_OVERHEAD_TIMEOUT_MS,
  freqMhz: (p) => p.freqMhz,
  formatFreq: (f) => f.toFixed(1),
  blankRow,

  wire: (s, plan) => ({
    points: plan.map((p) => ({
      earfcn: p.earfcn, band: p.band, freq_mhz: p.freqMhz, power_dbm: p.pow,
      bandwidth: p.bandwidth, mcs: p.mcs, rb_count: p.rbCount, margin_db: p.marginDb,
    })),
    settle_ms: s.settleMs, power: wiredPowerOf(s.powerSrc),
  }),

  report: (s, rows) => ({
    test: 'lte-modulated-automation', title: 'LTE modulated automation',
    settings: [['Settle', `${s.settleMs} ms`]],
    columns: [...CSV_HEADER], rows: toCsvBody(rows),
  }),
  csv: (rows) => ({ header: [...CSV_HEADER], body: toCsvBody(rows) }),
  summary: (_s, plan) => {
    const f = valuesText(plan.map((p) => p.freqMhz), (v) => v.toFixed(1))
    return f && `${f} MHz`
  },
}
