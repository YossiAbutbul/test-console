import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, IconButton, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import UploadIcon from '@mui/icons-material/Upload'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import TuneIcon from '@mui/icons-material/Tune'
import { alpha } from '@mui/material/styles'
import { useMutation } from '@tanstack/react-query'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { useNotify } from '../../context/NotifyContext'
import { formatDuration, sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import { parseLimit, tallyVerdicts, verdictWithinMargin } from '../../lib/verdict'
import {
  DEFAULT_SETTLE_MS as SHARED_DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs,
} from '../../lib/settle'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch } from '../../lib/earfcn'
import { GRID_GAP, Section, SegmentedChoice, TEXT } from '../../ui'
import {
  BW_DEFAULT, BW_OPTIONS, MCS_DEFAULT, MCS_MAX, MCS_MIN, RB_DEFAULT,
  bandwidthLabel, rbForBandwidth,
} from './signal'
import { CSV_HEADER, parseLteModulatedCsv, toCsvBody } from './csv'
import { ResultsGraphModal } from '../power/ResultsGraphModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import type { LteModulatedRequest } from '../../types/models'
import type { ChannelUnit } from '../lte/channel'
import type { LteModem } from '../lte/useLteModem'
import {
  lteModulatedPageSnapshot,
  persistLteModulatedPage,
  type LteModulatedResultRow,
  type LteModulatedRow,
} from '../../store/lteModulatedPageStore'

type ResultRow = LteModulatedResultRow
type SweepRow = LteModulatedRow

/** Result actions are secondary to the run itself — quiet text buttons on the
 *  panel heading, not another row of outlined buttons competing with it. */
const resultActionSx = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/** Instruments every measured point depends on. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** Budget for the commands + measurement either side of the settle delay. A
 *  point sends two frames rather than one, so this sits above the LoRa figure. */
const STEP_OVERHEAD_TIMEOUT_MS = 40_000

const DEFAULT_SETTLE_MS = SHARED_DEFAULT_SETTLE_MS

/** A settle above this is almost always a typo (500 → 50000). */
const LONG_SETTLE_MS = 10_000

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const MAX_POWER_DBM = 23

/**
 * Per-point transmit duration, fixed rather than configurable.
 *
 * The run aborts each point as soon as it has measured, so this is only ever a
 * backstop: it has to outlast one settle plus a reading, and beyond that a
 * larger number just means a longer stuck transmission if an abort is ever
 * missed. 20 s clears a point many times over.
 */
const TX_TIME_MS = 20_000

const DEFAULT_POWER = '23'
const PANEL_HEIGHT = 250

/**
 * Most channels a spec is rewritten across on a unit switch.
 *
 * Conversion is exact — every value is resolved and re-emitted as a comma
 * list, so the set of channels is unchanged — but a 200-channel sweep would
 * become an unreadable wall of text. Past this the spec is left alone and the
 * row asks to be re-entered in the new unit.
 */
const MAX_CONVERT = 32

/**
 * Sweep table columns.
 *
 * One grid template shared by the header and every row, so the two cannot
 * drift apart the way per-cell fixed widths do. The range-spec columns flex
 * and the pickers stay fixed, so the table fills the panel without every input
 * becoming the same width — a picker stretched to match a text field reads as
 * a form inflated to fill space.
 */
const COLS = '20px minmax(130px, 1.4fr) minmax(120px, 1.3fr) 108px 74px 74px'
  + ' minmax(96px, 1fr) 108px 32px'
const MIN_TABLE_W = 860

const DEFAULT_ROW: SweepRow = {
  earfcn: '',
  power: DEFAULT_POWER,
  bandwidth: BW_DEFAULT,
  mcs: MCS_DEFAULT,
  rbCount: RB_DEFAULT,
  marginDb: '1',
}

/** Fill in a row read back from storage, so a snapshot written before a column
 *  existed still loads. */
function normaliseRow(r: Partial<SweepRow>): SweepRow {
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
const marginValid = (r: SweepRow): boolean => {
  if (r.marginDb.trim() === '') return true
  const m = parseLimit(r.marginDb)
  return m != null && m >= 0
}

const mcsValid = (r: SweepRow): boolean =>
  Number.isInteger(r.mcs) && r.mcs >= MCS_MIN && r.mcs <= MCS_MAX

/** An allocation wider than the channel is not something the modem can
 *  transmit — the backend refuses it, so it is caught here first. */
const rbValid = (r: SweepRow): boolean =>
  Number.isInteger(r.rbCount) && r.rbCount >= 1 && r.rbCount <= rbForBandwidth(r.bandwidth)

interface PlanPoint {
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

/** Column heading, in the same shape as `LabeledField`: name, then a quieter
 *  unit beside it. */
function ColHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 13, fontWeight: 500, color: 'text.primary',
        // Truncate rather than run into the next column.
        display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
      {hint && (
        <Box
          component="span"
          sx={{ ml: 0.5, fontSize: 11.5, fontWeight: 400, color: 'text.secondary' }}
        >
          {hint}
        </Box>
      )}
    </Typography>
  )
}

const ResultTableRow = memo(function ResultTableRow({ r, i }: { r: ResultRow; i: number }) {
  return (
    <TableRow>
      <TableCell>{i + 1}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.earfcn}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>
        {r.freq_mhz.toFixed(1)}
        {r.band != null && (
          <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>B{r.band}</Box>
        )}
      </TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.set_power_dbm}</TableCell>
      {/* The three signal fields as one column: they describe a single
          waveform, and three narrow columns would crowd out the readings. */}
      <TableCell sx={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
        {bandwidthLabel(r.bandwidth)}
        <Box component="span" sx={{ color: 'text.disabled' }}>
          {' · MCS '}{r.mcs}{' · '}{r.rb_count}{' RB'}
        </Box>
      </TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.measured_dbm, 2)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>
        {fmt(r.current_a == null ? null : r.current_a * 1000, 1)}
      </TableCell>
      <TableCell>
        {r.verdict == null ? (
          // Not "—": the point was measured, it just had nothing to be judged
          // against, and a dash reads as a missing reading.
          <Box component="span" sx={{ color: 'text.disabled', fontSize: 11 }}>N/A</Box>
        ) : (
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              px: 0.75, py: '1px', borderRadius: 0.5,
              fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
              color: r.verdict === 'pass' ? 'success.main' : 'error.main',
              bgcolor: (t) => alpha(
                r.verdict === 'pass' ? t.palette.success.main : t.palette.error.main, 0.14,
              ),
            }}
          >
            {r.verdict === 'pass' ? 'PASS' : 'FAIL'}
          </Box>
        )}
      </TableCell>
      <TableCell sx={{ fontSize: 11 }}>
        {r.error
          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
          : r.ok
            ? <Box component="span" sx={{ color: 'success.main' }}>ok</Box>
            : '—'}
      </TableCell>
    </TableRow>
  )
})

/** Export the results table. The column list and the row mapping live in
 *  `./csv`, alongside the parser that reads them back. */
function downloadCsv(rows: ResultRow[], mac: string | null): void {
  saveCsv(
    [...CSV_HEADER], toCsvBody(rows),
    exportName('lte-modulated-automation', mac, 'csv'),
  )
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that the page owns. */
function snap(): NonNullable<typeof lteModulatedPageSnapshot.automation> {
  if (!lteModulatedPageSnapshot.automation) lteModulatedPageSnapshot.automation = {}
  return lteModulatedPageSnapshot.automation
}

/**
 * What the page header needs to drive the run.
 *
 * The run lives here, but its buttons belong in the header next to the manual
 * tab's Send/Stop, so switching tabs does not move the primary action.
 */
export interface AutomationControls {
  running: boolean
  canRun: boolean
  /** "3/40", for the label while running. */
  progress: string
  onRun: () => void
  onStop: () => void
}

interface Props {
  /**
   * The modem, owned by the page.
   *
   * Power is page-level rather than per-tab because it is one piece of
   * hardware: if this panel kept its own idea of it, a run would send a
   * MODEM_ON the manual tab had already sent, and the modem refuses that.
   */
  modem: LteModem
  /** Whether the channel column is read as EARFCNs or MHz. Rig-wide, so every
   *  LTE page agrees on what a number in a channel field means. */
  unit: ChannelUnit
  /** Bands a MHz value is allowed to resolve within. */
  bands: number[]
  onUnitChange: (u: ChannelUnit) => void
  onEditBands: () => void
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
}

export function AutomationPanel({
  modem, unit, bands, onUnitChange, onEditBands, onControlsChange,
}: Props) {
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const reporter = useRunReporter('LTE Modulated automation', 'Automation')
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const notify = useNotify()

  const [rows, setRows] = useState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    // The starting row follows the unit the panel opens in — the same channel
    // either way round, so a page reopening in MHz does not greet the operator
    // with an EARFCN flagged invalid.
    return [{ ...DEFAULT_ROW, earfcn: unit === 'mhz' ? '1880' : '18900' }]
  })
  // Clamped on read: a snapshot saved before the floor existed can hold a
  // value below it, and restoring one would reintroduce the bad readings.
  const [settleMs, setSettleMs] = useState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
  )
  const [results, setResults] = useState<ResultRow[]>(() => snap().results ?? [])
  // Mirrored so the end-of-run summary can count verdicts without waiting for
  // a re-render to publish the last point.
  const resultsRef = useRef<ResultRow[]>(results)

  useEffect(() => { snap().rows = rows; persistLteModulatedPage() }, [rows])
  useEffect(() => { snap().settleMs = settleMs; persistLteModulatedPage() }, [settleMs])
  useEffect(() => { snap().results = results; persistLteModulatedPage() }, [results])

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // Replaced per run. Stop aborts it, which cancels the in-flight request and
  // wakes the settle delay immediately.
  const abortRef = useRef(new AbortController())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const earfcnRefs = useRef<Array<HTMLInputElement | null>>([])
  // A ref, not state: the effect below only needs to know *which* row to focus
  // once, and holding it in state would mean clearing it from inside that
  // effect — a setState-in-effect that buys nothing here.
  const pendingFocusRef = useRef<number | null>(null)
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  // Frequencies this run had no calibration for. Collected rather than warned
  // per point: a 40-point sweep over one uncalibrated band would otherwise
  // write the same line forty times.
  const uncalibrated = useRef<Set<number>>(new Set())
  const [graphOpen, setGraphOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  /**
   * Load a results CSV this panel exported.
   *
   * Replaces the table outright rather than appending: the file is a record of
   * one run, and merging it into another run's points would produce a table
   * that never existed.
   */
  const importFile = async (f: File) => {
    try {
      const imported = parseLteModulatedCsv(await f.text())
      resultsRef.current = imported
      setResults(imported)
      const t = tallyVerdicts(imported)
      const summary = `${imported.length} point${imported.length === 1 ? '' : 's'}`
        + (t.total > 0 ? ` · ${t.pass}/${t.total} within limits` : '')
      reporter.note(`Imported ${summary} from ${f.name}`)
      notify.success(`Imported ${summary}`)
    } catch (e) {
      const message = (e as Error).message
      reporter.note(`Import failed: ${message}`, 'error')
      notify.error(message, { title: 'Import failed' })
    }
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
  const convertSpec = (spec: string, from: ChannelUnit, to: ChannelUnit): string => {
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

  // Convert during render on the unit's rising edge rather than in an effect.
  // React's documented way to adjust state when a prop changes; an effect would
  // paint the stale rows — all flagged invalid — for a frame first.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, earfcn: convertSpec(r.earfcn, lastUnit, unit) })))
  }

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects. The new row copies
    // the last one's power and signal: adding a channel to an existing sweep is
    // far more common than starting a different kind of measurement.
    pendingFocusRef.current = rows.length
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, earfcn: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  /**
   * Channels a spec names, read in whichever unit is selected.
   *
   * Values that resolve to nothing are dropped, as are MHz values covered by
   * more than one selected band — the row editor counts the gap and flags it,
   * rather than this quietly picking a band on the operator's behalf.
   */
  const toChannels = (spec: string): UplinkMatch[] => {
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
  const rowPoints = (r: SweepRow): PlanPoint[] => {
    const channels = toChannels(r.earfcn)
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

  const plan: PlanPoint[] = rows.flatMap(rowPoints)
  const totalPoints = plan.length
  // Settle dominates; the two commands + measure round trips add roughly 400 ms.
  const estimatedRunMs = totalPoints * (settleMs + 400)
  // A row with a bad tolerance or signal contributes no points, so it would
  // otherwise vanish from the plan silently rather than blocking the run.
  const anyInvalid = rows.some(
    (r) => r.earfcn.trim() !== '' && (!marginValid(r) || !mcsValid(r) || !rbValid(r)),
  )

  const blankRow = (item: PlanPoint): ResultRow => ({
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

  const paramsFor = (item: PlanPoint): LteModulatedRequest => ({
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

  /**
   * One point: modulated TX on → settle → read power/CC → abort.
   *
   * The abort is not just tidiness. The modem takes one test at a time and
   * drops a START that arrives while another is running, so without it every
   * point after the first would silently measure the first point's channel.
   * It runs in `finally` for the same reason the LoRa panel stops the PA there
   * — a failed point must not leave the DUT transmitting into the next one.
   *
   * Never throws; failures land in the row.
   */
  const measurePoint = async (item: PlanPoint): Promise<ResultRow> => {
    const { signal } = abortRef.current
    const row = blankRow(item)
    if (signal.aborted) return row
    const params = paramsFor(item)
    const fHz = Math.round(item.freqMhz * 1e6)
    try {
      const tx = await device.lteModulated({ ...params, start: true }, { signal })
      row.ok = tx.ok
      row.status = tx.status
      if (!tx.ok) {
        row.error = `tx status=${tx.status}`
      } else {
        modem.setRunning({
          label: 'modulated',
          abort: () => device.lteModulated({ ...params, start: false }),
        })
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        const m = await instrumentsApi.measure(fHz, { signal })
        row.measured_dbm_raw = m.power_dbm
        // Looked up per point: a run sweeps channels, so a single figure would
        // be right for at most one of them.
        const pl = lossAt(item.freqMhz)
        row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
        if (!pl.calibrated) uncalibrated.current.add(item.freqMhz)
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
      try {
        await device.lteModulated({ ...params, start: false })
        modem.setRunning(null)
      } catch { /* reported by the end-of-run abort */ }
    }
    return row
  }

  const runM = useMutation({
    mutationFn: async () => {
      if (!(await preflight.run())) {
        reporter.note('cancelled — instruments not ready', 'warn')
        return
      }
      const abort = new AbortController()
      abortRef.current = abort
      setRunning(true)
      setResults([])
      resultsRef.current = []
      setProgressIdx(0)
      uncalibrated.current.clear()
      try {
        await runSequence<PlanPoint, ResultRow>({
          items: plan,
          abort,
          // Once for the whole run, not per point: the boot is ~10 s and every
          // point after the first would pay it for nothing. Cycling rather
          // than skipping when the modem looks up means the sweep starts from
          // a modem in a known state, with nothing left running on it.
          before: async () => {
            reporter.note('restarting the modem')
            await modem.cycle()
          },
          measure: measurePoint,
          markRowError: (item, _i, message) => ({ ...blankRow(item), error: message }),
          // Modem power is left as it was found: the key is the only thing that
          // powers it down, so a run does not silently undo it.
          after: async () => {
            const live = modem.getRunning()
            if (!live) return
            try { await live.abort() } catch { /* ignore */ }
            modem.setRunning(null)
          },
          rowHasError: (r) => !!r.error,
          onRows: (next) => { resultsRef.current = next; setResults(next) },
          onProgress: setProgressIdx,
          // The settle delay is operator-set and can be long; the guard has to
          // sit above it or it would fire on every point.
          stepTimeoutMs: settleMs + STEP_OVERHEAD_TIMEOUT_MS,
          reporter,
        })
      } finally {
        setRunning(false)
        // Reported apart from the run's own error count: a point that measured
        // cleanly and missed its tolerance is a result, not a fault, and
        // folding the two together would hide whichever mattered.
        const judged = tallyVerdicts(resultsRef.current)
        if (judged.total > 0) {
          reporter.note(
            `${judged.pass}/${judged.total} points within limits`,
            judged.fail > 0 ? 'warn' : 'info',
          )
        }
        if (uncalibrated.current.size > 0) {
          const list = [...uncalibrated.current].sort((a, b) => a - b)
            .map((f) => f.toFixed(1)).join(', ')
          reporter.note(
            `path loss not calibrated at ${list} MHz — those points used the `
            + `default ${defaultDb} dB and their measured power is only as `
            + 'good as that figure.',
            'warn',
          )
        }
      }
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  const onStop = useCallback(() => {
    // Aborting cancels the in-flight request and wakes the settle delay, so the
    // loop notices immediately rather than at the end of the point.
    abortRef.current.abort()
    // Independently tell the DUT to stop transmitting — the abort only ends our
    // side of the conversation. The modem is left powered, as everywhere else
    // on this page.
    const live = modem.getRunning()
    if (live) {
      void live.abort()
        .then(() => modem.setRunning(null))
        .catch((e: Error) => reporter.note(`abort failed: ${e.message}`, 'error'))
    }
  }, [modem, reporter])

  const runMutate = runM.mutate
  const onRun = useCallback(() => { runMutate() }, [runMutate])

  // Publish the run state upward so the header can render the buttons. Only
  // primitives and stable callbacks are in the dependency list, so this settles
  // after one pass rather than looping on a fresh object each render.
  useEffect(() => {
    onControlsChange?.({
      running,
      canRun: totalPoints > 0 && !anyInvalid,
      progress: `${progressIdx}/${totalPoints}`,
      onRun,
      onStop,
    })
  }, [running, totalPoints, anyInvalid, progressIdx, onRun, onStop, onControlsChange])

  // Runs when a row is added or removed; only acts when Add asked it to.
  useEffect(() => {
    const idx = pendingFocusRef.current
    if (idx == null) return
    pendingFocusRef.current = null
    earfcnRefs.current[idx]?.focus()
    const body = bodyRef.current
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
  }, [rows.length])

  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [results.length])

  const cellSx = { '& .MuiInputBase-root': { height: 34 } }
  const isEarfcn = unit === 'earfcn'

  return (
    <Stack spacing={`${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      <Box sx={{ height: PANEL_HEIGHT, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <Section
          title="Sweep"
          panel
          grow
          action={
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                {totalPoints} point{totalPoints === 1 ? '' : 's'}
              </Typography>
              <SegmentedChoice
                value={unit}
                options={[
                  { value: 'earfcn', label: 'EARFCN' },
                  { value: 'mhz', label: 'MHz' },
                ]}
                onChange={onUnitChange}
                disabled={running}
              />
              <Tooltip title="Bands in use">
                <span>
                  <IconButton size="small" onClick={onEditBands} disabled={running}>
                    <TuneIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              {/* Settle is the one thing here that is genuinely run-wide: it is
                  about instrument timing, not about the signal, so it stays
                  out of the table. */}
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>Settle</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={settleMs}
                  onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
                  onBlur={() => setSettleMs((v) => clampSettleMs(v))}
                  disabled={running}
                  inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
                  sx={{ width: 84, '& .MuiInputBase-root': { height: 26 } }}
                />
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>ms</Typography>
              </Stack>
              <Button
                size="small"
                startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                onClick={addRow}
                disabled={running}
                sx={{ minWidth: 0, height: 24, fontSize: 12, px: 1 }}
              >
                Add
              </Button>
            </Stack>
          }
        >
          <Box ref={bodyRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
            <Box sx={{ minWidth: MIN_TABLE_W }}>
              <Box
                sx={{
                  display: 'grid', gridTemplateColumns: COLS, gap: 1,
                  alignItems: 'end', mb: 0.75,
                }}
              >
                <Box />
                <ColHead
                  label={isEarfcn ? 'EARFCN' : 'Frequency'}
                  hint={isEarfcn ? 'uplink' : 'MHz'}
                />
                <ColHead label="Power" hint="dBm" />
                <ColHead label="Bandwidth" />
                <ColHead label="MCS" hint={`0–${MCS_MAX}`} />
                {/* No range in the heading: the ceiling is the bandwidth's own
                    resource-block count, so it differs row by row. */}
                <ColHead label="RB" />
                <ColHead label="Tolerance" hint="± dB" />
                <Box />
                <Box />
              </Box>

              <Stack spacing={0.75}>
                {rows.map((r, i) => {
                  const parsed = parseRangeSpec(r.earfcn)
                  const good = toChannels(r.earfcn)
                  // Two different faults, two different messages: nothing
                  // parsed at all, versus parsed but not resolvable to a
                  // channel — the second is the one worth naming, because the
                  // fix is a band setting, not retyping the number.
                  const badSpec = r.earfcn.trim() !== '' && parsed.length === 0
                  const unresolved = parsed.length > 0 && good.length < parsed.length
                  // Two ways a MHz value fails, needing different fixes: in no
                  // selected band (tick one) versus in several (untick one).
                  const ambiguous = !isEarfcn
                    && parsed.some((m) => uplinkFromMhz(m, bands).length > 1)
                  const badChannel = badSpec || unresolved
                  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
                  const inRange = powers.filter((p) => p >= 0 && p <= MAX_POWER_DBM)
                  const badPower = r.power.trim() !== ''
                    && (powers.length === 0 || inRange.length < powers.length)
                  const badMcs = !mcsValid(r)
                  const badRb = !rbValid(r)
                  const badMargin = !marginValid(r)
                  const maxRb = rbForBandwidth(r.bandwidth)
                  const steps = rowPoints(r).length
                  const first = good[0] ?? null
                  return (
                    <Box
                      key={i}
                      sx={{
                        display: 'grid', gridTemplateColumns: COLS, gap: 1,
                        alignItems: 'center',
                      }}
                    >
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', textAlign: 'right' }}>
                        {i + 1}.
                      </Typography>

                      <TextField
                        size="small" sx={cellSx}
                        value={r.earfcn}
                        onChange={(e) => updateRow(i, { earfcn: e.target.value })}
                        inputRef={(el: HTMLInputElement | null) => { earfcnRefs.current[i] = el }}
                        placeholder={isEarfcn ? '18900 or 18900-18910' : '1880 or 1850-1910'}
                        disabled={running}
                        error={badChannel}
                        onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-ch`) }}
                        onBlur={() => setFocusKey((k) => (k === `${i}-ch` ? null : k))}
                        InputProps={{
                          endAdornment: (
                            <ValidationAdornment
                              show={shouldShowValidation(r.earfcn, !badChannel, focusKey === `${i}-ch`)}
                              message={
                                r.earfcn.trim() === ''
                                  ? 'Enter a value'
                                  : !unresolved
                                    ? 'Not a number, range or list'
                                    : isEarfcn
                                      ? 'Outside the known bands'
                                      : ambiguous
                                        ? 'In more than one selected band'
                                        : 'Not in the selected bands'
                              }
                            />
                          ),
                        }}
                      />

                      <TextField
                        size="small" sx={cellSx}
                        placeholder="23 or 10-23"
                        value={r.power}
                        onChange={(e) => updateRow(i, { power: e.target.value })}
                        onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-power`) }}
                        onBlur={() => setFocusKey((k) => (k === `${i}-power` ? null : k))}
                        disabled={running}
                        error={badPower}
                        InputProps={{
                          endAdornment: (
                            <ValidationAdornment
                              show={shouldShowValidation(r.power, !badPower, focusKey === `${i}-power`)}
                              message={`Invalid — e.g. 23 or 10-23 (max ${MAX_POWER_DBM} dBm)`}
                            />
                          ),
                        }}
                      />

                      <TextField
                        size="small" select sx={cellSx}
                        value={r.bandwidth}
                        disabled={running}
                        onChange={(e) => {
                          // Carry the allocation to something the new channel
                          // can hold: 25 RB is a full 5 MHz channel and more
                          // than a 1.4 MHz one has to give.
                          const next = Number(e.target.value)
                          const room = rbForBandwidth(next)
                          updateRow(i, {
                            bandwidth: next,
                            rbCount: Math.min(r.rbCount, room),
                          })
                        }}
                      >
                        {BW_OPTIONS.map((bw) => (
                          <MenuItem key={bw.code} value={bw.code}>{bw.label}</MenuItem>
                        ))}
                      </TextField>

                      <TextField
                        size="small" type="number" sx={cellSx}
                        value={r.mcs}
                        disabled={running}
                        error={badMcs}
                        onChange={(e) => updateRow(i, { mcs: Number(e.target.value) })}
                        onFocus={(e) => { (e.target as HTMLInputElement).select() }}
                        inputProps={{ min: MCS_MIN, max: MCS_MAX, step: 1 }}
                        InputProps={{
                          endAdornment: (
                            <ValidationAdornment
                              show={badMcs}
                              message={`A whole number, ${MCS_MIN}–${MCS_MAX}`}
                            />
                          ),
                        }}
                      />

                      <TextField
                        size="small" type="number" sx={cellSx}
                        value={r.rbCount}
                        disabled={running}
                        error={badRb}
                        onChange={(e) => updateRow(i, { rbCount: Number(e.target.value) })}
                        onFocus={(e) => { (e.target as HTMLInputElement).select() }}
                        inputProps={{ min: 1, max: maxRb, step: 1 }}
                        InputProps={{
                          endAdornment: (
                            <ValidationAdornment
                              show={badRb}
                              message={`1–${maxRb} resource blocks in a ${bandwidthLabel(r.bandwidth)} channel`}
                            />
                          ),
                        }}
                      />

                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>±</Typography>
                        <TextField
                          size="small" type="number"
                          sx={{ ...cellSx, flexGrow: 1, minWidth: 0 }}
                          value={r.marginDb}
                          placeholder="—"
                          disabled={running}
                          error={badMargin}
                          onChange={(e) => updateRow(i, { marginDb: e.target.value })}
                          onFocus={(e) => { (e.target as HTMLInputElement).select() }}
                          inputProps={{ min: 0, step: 0.5 }}
                          InputProps={{
                            endAdornment: (
                              <ValidationAdornment
                                show={badMargin}
                                message="A tolerance in dB, 0 or more — or blank for no verdict"
                              />
                            ),
                          }}
                        />
                      </Stack>

                      {/* Shows whichever unit is *not* being typed, so the row
                          always states the channel it resolved to. */}
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', whiteSpace: 'nowrap' }}>
                        {first && (
                          <Box component="span" sx={{ mr: 0.75 }}>
                            {isEarfcn ? `${(first.freqHz / 1e6).toFixed(1)} MHz` : first.earfcn}
                          </Box>
                        )}
                        {steps} step{steps === 1 ? '' : 's'}
                      </Typography>

                      <IconButton size="small" onClick={() => removeRow(i)} disabled={running}>
                        <DeleteIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  )
                })}
              </Stack>
            </Box>
          </Box>

          <Stack
            direction="row"
            justifyContent="space-between"
            spacing={2}
            sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            <Typography sx={{ fontSize: 11, color: 'text.disabled', whiteSpace: 'nowrap' }}>
              {isEarfcn
                ? 'EARFCN / Power: "18900" · "18900-18910" · "18900-18910:5" · "18900,20175"'
                : 'MHz / Power: "1880" · "1850-1910" · "1850-1910:0.5" · "1850,1880,1909.9"'}
              <Box component="span" sx={{ ml: 1.5 }}>
                Tolerance: within ± dB of the set power · blank for no verdict
              </Box>
            </Typography>
            {/* A long settle looks identical to a hung run, so state the cost up
                front rather than letting the operator guess. */}
            {totalPoints > 0 && (
              <Typography
                sx={{
                  ...TEXT.micro,
                  whiteSpace: 'nowrap',
                  color: settleMs >= LONG_SETTLE_MS ? 'warning.main' : 'text.secondary',
                }}
              >
                {settleMs >= LONG_SETTLE_MS && '⚠ '}
                ≈ {formatDuration(estimatedRunMs)} · plus ~10 s to restart the modem
              </Typography>
            )}
          </Stack>
        </Section>
      </Box>

      <Section
        title="Results"
        panel
        grow
        action={
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mr: 0.5 }}>
              measured + path loss (per frequency; default {defaultDb} dB)
            </Typography>
            <Button
              size="small"
              variant="text"
              startIcon={<UploadIcon sx={{ fontSize: 15 }} />}
              onClick={() => fileInput.current?.click()}
              disabled={running}
              sx={resultActionSx}
            >
              Import
            </Button>
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<DeleteSweepIcon sx={{ fontSize: 15 }} />}
              onClick={() => { resultsRef.current = []; setResults([]) }}
              disabled={results.length === 0 || running}
              sx={resultActionSx}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<ShowChartIcon sx={{ fontSize: 15 }} />}
              onClick={() => setGraphOpen(true)}
              disabled={results.length === 0}
              sx={resultActionSx}
            >
              Graph
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
              onClick={() => downloadCsv(results, bleStatus?.address ?? null)}
              disabled={results.length === 0}
              sx={resultActionSx}
            >
              Export
            </Button>
          </Stack>
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Reset first: re-picking the same file fires no change event
            // otherwise, so a second import would look ignored.
            e.target.value = ''
            if (f) void importFile(f)
          }}
        />

        {results.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            No data yet. Add a row and press Run, or Import a previous CSV.
          </Typography>
        ) : (
          <Box ref={resultsScrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>EARFCN</TableCell>
                  <TableCell>Freq (MHz)</TableCell>
                  <TableCell>Set (dBm)</TableCell>
                  <TableCell>Signal</TableCell>
                  <TableCell>Measured (dBm)</TableCell>
                  <TableCell>CC (mA)</TableCell>
                  <TableCell>Verdict</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((r, i) => (
                  <ResultTableRow key={i} r={r} i={i} />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Section>

      <ResultsGraphModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        results={results}
      />
      {preflight.dialog}
    </Stack>
  )
}
