/**
 * The LoRa CW sweep, without its panel: settings → plan → what a run sends.
 * The panel (`AutomationPanel.tsx`) and the Full Run page both run it from
 * here; see `engine/sweepTest.ts`.
 */
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { sleep } from '../../lib/async'
import { parseRangeSpec } from '../../lib/numericList'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { parseLimit, verdictWithinMargin } from '../../lib/verdict'
import {
  powerPageSnapshot, type AutomationResultRow, type AutomationSweepRow, type PowerPageSnapshot,
} from '../../store/powerPageStore'
import { STEP_OVERHEAD_TIMEOUT_MS } from '../engine/automationLayout'
import { valuesText, type SweepTest } from '../engine/sweepTest'
import { CSV_HEADER, toCsvBody } from './csv'

type ResultRow = AutomationResultRow
type SweepRow = AutomationSweepRow

/** The sweep's settings as the page snapshot holds them. */
export type LoraCwRaw = Omit<NonNullable<PowerPageSnapshot['automation']>, 'results'>

/** The same, resolved. */
export interface LoraCwSettings {
  rows: SweepRow[]
  settleMs: number
  powerSrc: PowerSourceState
}

/** Beside the one that reads power, which the power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

export const PA_AUTO = 2
export const DEFAULT_POWER = '14'

export const DEFAULT_ROW: SweepRow = {
  freq: '',
  power: DEFAULT_POWER,
  paMode: PA_AUTO,
  marginDb: '1',
}

/** The rows a fresh sweep opens with. */
export const DEFAULT_ROWS: SweepRow[] = [
  { ...DEFAULT_ROW, freq: '902.3' },
  { ...DEFAULT_ROW, freq: '915.0' },
  { ...DEFAULT_ROW, freq: '927.5' },
]

/** Fill in a row read back from storage. Snapshots written before PA mode and
 *  the tolerance moved onto the row hold only freq and power. */
export function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    freq: r.freq ?? '',
    power: r.power ?? DEFAULT_POWER,
    paMode: r.paMode ?? PA_AUTO,
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

export interface PlanPoint {
  freq: number
  pow: number
  paMode: number
  /** Tolerance in dB around `pow`, or null when this row is not judged. */
  marginDb: number | null
}

/** Points one row expands to. An empty power falls back to the default. */
export function rowPoints(r: SweepRow): PlanPoint[] {
  const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
  if (freqs.length === 0 || !marginValid(r)) return []
  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
  const out: PlanPoint[] = []
  for (const f of freqs) {
    for (const p of powers) {
      out.push({ freq: f, pow: p, paMode: r.paMode, marginDb: parseLimit(r.marginDb) })
    }
  }
  return out
}

export const blankRow = (item: PlanPoint): ResultRow => ({
  freq_mhz: item.freq,
  set_power_dbm: item.pow,
  pa_mode: item.paMode,
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

export const loraCwTest: SweepTest<LoraCwRaw, LoraCwSettings, PlanPoint, ResultRow> = {
  id: 'power',
  label: 'LoRa CW',
  protocol: 'LoRa',
  setup: 'main',
  fromPage: () => {
    const a = powerPageSnapshot.automation ?? {}
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
    // A row with a bad tolerance contributes no points, so it would otherwise
    // vanish from the plan silently rather than blocking the run.
    if (s.rows.some((r) => r.freq.trim() !== '' && !marginValid(r))) return 'a row has a bad tolerance'
    if (!powerSourceValid(s.powerSrc)) return 'spectrum analyzer settings must be positive numbers'
    return null
  },
  // Settle dominates; the command + measure round trips add roughly 300 ms.
  estimateMs: (s, plan) => plan.length * (s.settleMs + 300),
  instruments: (s) => [powerInstrument(s.powerSrc), ...REQUIRED_INSTRUMENTS],
  stepTimeoutMs: (s) => s.settleMs + STEP_OVERHEAD_TIMEOUT_MS,
  freqMhz: (p) => p.freq,
  blankRow,

  createRun: (s, { lossAt }) => ({
    /**
     * One point: TX on at this (freq, power) → settle → read power/CC → TX off.
     *
     * The DUT is switched off after every point rather than left transmitting
     * into the next one, so each reading starts from the same state and the PA
     * is never keyed between points. Never throws — failures land in the row.
     */
    measure: async (item, { signal, noteUncalibrated }) => {
      const fHz = Math.round(item.freq * 1_000_000)
      const row = blankRow(item)
      if (signal.aborted) return row
      try {
        const tx = await device.loraPower(
          { freq_hz: fHz, power_dbm: item.pow, pa_mode: item.paMode },
          { signal },
        )
        row.ok = tx.ok
        row.status = tx.status
        if (!tx.ok) {
          row.error = `tx status=${tx.status}`
        } else {
          await sleep(s.settleMs, signal)
          if (signal.aborted) return row
          // The analyzer is ranged to this point's power as it arrives after
          // the cable; the sensor ignores it.
          const m = await instrumentsApi.measure(fHz, {
            signal, spectrum: measureSpectrumOf(s.powerSrc), expectedDbm: item.pow - lossAt(item.freq).db,
          })
          row.measured_dbm_raw = m.power_dbm
          // Looked up per point: an automation run sweeps frequencies, so a
          // single figure would be right for at most one of them.
          const pl = lossAt(item.freq)
          row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
          if (!pl.calibrated) noteUncalibrated(item.freq)
          row.current_a = m.current_a
          row.voltage_v = m.voltage_v
          // Judged on the corrected power against what was *asked for*, not the
          // raw sensor reading: the latter is short by the loss of the cable run
          // and would fail a perfectly good part.
          row.verdict = verdictWithinMargin(row.measured_dbm, item.pow, item.marginDb)
          if (m.error) row.error = m.error
        }
      } catch (e) {
        // A cancelled request is the operator stopping, not a measurement fault.
        row.error = signal.aborted ? null : (e as Error).message
      } finally {
        // TX off before the next point — always, including on failure, so a bad
        // point cannot leave the DUT keyed.
        try { await device.stop() } catch { /* reported by the end-of-run stop */ }
      }
      return row
    },
    after: async () => { try { await device.stop() } catch { /* ignore */ } },
    // Independently tell the DUT to stop transmitting — the abort only ends
    // our side of the conversation.
    onStop: (reporter) => {
      void device.stop().catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
    },
  }),

  report: (s, rows) => ({
    test: 'tx-cw-automation', title: 'LoRa CW automation',
    settings: [['Settle', `${s.settleMs} ms`]],
    columns: [...CSV_HEADER], rows: toCsvBody(rows),
  }),
  csv: (rows) => ({ header: [...CSV_HEADER], body: toCsvBody(rows) }),
  summary: (_s, plan) => {
    const f = valuesText(plan.map((p) => p.freq))
    return f && `${f} MHz`
  },
}
