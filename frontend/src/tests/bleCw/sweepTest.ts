/**
 * The BLE CW sweep, without its panel: settings → plan → what a run sends.
 * The panel (`BleAutomationPanel.tsx`) and the Full Run page both run it from
 * here; see `engine/sweepTest.ts`.
 */
import { instrumentsApi } from '../../api/instruments'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { sleep } from '../../lib/async'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { verdictOf } from '../../lib/verdict'
import {
  bleCwPageSnapshot, type BleAutomationResultRow, type BleAutomationRow, type BleChannelUnit,
  type BleCwPageSnapshot,
} from '../../store/bleCwPageStore'
import { valuesText, type SweepTest } from '../engine/sweepTest'
import { DURATION_MAX_S, offAirReason } from '../ble/radio'
import { CSV_HEADER, toCsvBody } from './csv'
import {
  AUTO_TONE_MAX_S, AUTO_TONE_TYPICAL_S, autoToneSeconds, buildPlan, estimateRunMs, minToneSeconds,
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

/** The wall clock, out of line so it is read when called, not in render. */
const epochNow = (): number => Date.now()
/** The same for the monotonic clock a read is timed on. */
const monoNow = (): number => performance.now()

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

  createRun: (s, { lossAt, link }) => {
    if (!link) throw new Error('BLE CW needs the BLE link')
    const tone = toneOf(s)
    const plan = buildPlan(s.rows, s.unit)
    /** Set by a point whose DUT did not come back; the next point ends the run. */
    let lost: string | null = null
    /** Longest time yet, this run, from a tone's start being sent to its
     *  reading finishing -- what an auto tone is sized from. */
    let slowestWindow: number | null = null
    /** The auto tone last used, so a change is reported once, not per point. */
    let lastAutoTone: number | null = null

    return {
      // Outside the step timeout: a power change waits on a reboot, and
      // has its own bound in the relink. A DUT that did not come back from
      // the last point ends the run here, rather than failing every point
      // after it in milliseconds.
      beforeItem: async (item, i, { signal, reporter }) => {
        if (lost) throw new Error(lost)
        const prev = i > 0 ? plan[i - 1].power : null
        if (prev === item.power) return
        reporter.note(`tone power ${item.power} — resetting the DUT`)
        // The first power is set even if the page believes the DUT is on
        // it: a run starts from a power it set itself, the way the LTE
        // run power-cycles its modem.
        if (i === 0) await link.setPower(item.power, signal)
        else await link.ensurePower(item.power, signal)
      },

      /**
       * One point: tone on -> settle -> read power/CC -> wait out the tone -> relink.
       *
       * The relink is in `finally` for the same reason the LTE panel's abort is:
       * a failed or stopped point must not leave the next one -- or the operator
       * -- with a DUT that is off the link. It is not abortable: the tone runs to
       * its end whatever we do, so Stop waits for it rather than leaving the DUT
       * stranded mid-tone.
       *
       * Never throws; failures land in the row.
       */
      measure: async (item, { signal, reporter, noteUncalibrated, preview }) => {
        const row = blankRow(item)
        if (signal.aborted) return row
        const fHz = item.freqMhz * 1e6
        let started = false
        const pointToneS = tone.auto ? autoToneSeconds(slowestWindow) : tone.fixed
        if (tone.auto && pointToneS !== lastAutoTone) {
          const w = slowestWindow
          reporter.note(w == null
            ? `auto tone: ${pointToneS} s for the first point, until a reading has been timed`
            : `auto tone: ${pointToneS} s per point (slowest reading finished ${(w / 1000).toFixed(1)} s into its tone)`)
          lastAutoTone = pointToneS
        }
        try {
          const r = await link.tone({ channel: item.channel, duration_s: pointToneS, offset: 0 }, signal)
          started = true
          // Unanswered is the expected shape: the link goes with the tone.
          row.status = r.acknowledged ? r.status : null
          await sleep(s.settleMs, signal)
          if (signal.aborted) return row
          const pl = lossAt(item.freqMhz)
          const readStart = monoNow()
          const m = await instrumentsApi.measure(fHz, { signal, spectrum: measureSpectrumOf(s.powerSrc) })
          const readMs = monoNow() - readStart
          row.measured_dbm_raw = m.power_dbm
          row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
          if (!pl.calibrated) noteUncalibrated(item.freqMhz)
          row.current_a = m.current_a
          row.voltage_v = m.voltage_v
          row.verdict = verdictOf(row.measured_dbm, item.minDbm, item.maxDbm)
          row.ok = !m.error
          if (m.error) row.error = m.error
          // The numbers stay in the row, so a late read can be seen for what it
          // was, but it is not judged or counted as measured.
          const readEnd = epochNow()
          const until = link.onAirUntil()
          const offAir = offAirReason(readEnd, until, readMs)
          if (offAir) {
            row.ok = false
            row.verdict = null
            row.error = m.error ? `${offAir}; ${m.error}` : offAir
          }
          // Timed from when the start went out, so it covers everything the tone
          // has to outlast: the link release, the settle and the reads.
          if (until != null) {
            const spanMs = readEnd - (until - pointToneS * 1000)
            slowestWindow = Math.max(slowestWindow ?? 0, spanMs)
          }
          // On screen now rather than after the reconnect, which is seconds away
          // and changes nothing in the row unless it fails -- then the row is
          // updated with why.
          preview(row)
        } catch (e) {
          row.error = signal.aborted ? null : (e as Error).message
        } finally {
          if (started) {
            try {
              await link.finishTone()
            } catch (e) {
              const message = `DUT did not come back after the tone: ${(e as Error).message}`
              lost = message
              row.ok = false
              row.error ??= message
            }
          }
        }
        return row
      },

      // A tone left on air -- a point abandoned by its timeout -- is
      // waited out, so the run ends with the DUT back on the link.
      after: () => link.finishTone(),
      // The tone itself cannot be stopped; say so, rather than letting the run
      // look hung while it waits for the DUT to come back.
      onStop: (reporter) => {
        const until = link.onAirUntil()
        if (until != null) {
          const left = Math.max(0, Math.ceil((until - epochNow()) / 1000))
          reporter.note(`stopping — the tone on air cannot be cut short; reconnecting when it ends in ${left} s`, 'warn')
        }
      },
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
