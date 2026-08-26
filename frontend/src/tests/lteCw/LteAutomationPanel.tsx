import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, IconButton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import { useMutation } from '@tanstack/react-query'
import { LabeledField } from '../../components/LabeledField'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { formatDuration, sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt, num } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import {
  DEFAULT_SETTLE_MS as SHARED_DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs,
} from '../../lib/settle'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch } from '../../lib/earfcn'
import TuneIcon from '@mui/icons-material/Tune'
import { Tooltip } from '@mui/material'
import { GRID_GAP, Section, SegmentedChoice, TEXT } from '../../ui'
import { ResultsGraphModal } from '../power/ResultsGraphModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import type { LteCwRequest } from '../../types/models'
import {
  lteCwPageSnapshot,
  persistLteCwPage,
  type ChannelUnit,
  type LteAutomationResultRow,
  type LteAutomationRow,
} from '../../store/lteCwPageStore'

type ResultRow = LteAutomationResultRow
type ConfigRow = LteAutomationRow

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
const CW_TIME_MS = 20_000

/**
 * Offset from the channel centre, fixed at the centre.
 *
 * A sweep is about power against channel; moving the tone off centre as well
 * would leave every reading asking which of the two it was measuring. The
 * manual tab still exposes it.
 */
const CW_OFFSET_HZ = 0

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
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.measured_dbm, 2)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>
        {fmt(r.current_a == null ? null : r.current_a * 1000, 1)}
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

/** Export the results table. Values are rounded for Excel readability. */
function downloadCsv(rows: ResultRow[], mac: string | null): void {
  const header = [
    'earfcn', 'band', 'freq_mhz', 'set_power_dbm',
    'measured_dbm', 'current_ma', 'path_loss_db', 'ok', 'status', 'error',
  ]
  const body = rows.map((r) => [
    r.earfcn,
    r.band ?? '',
    num(r.freq_mhz, 3),
    r.set_power_dbm,
    num(r.measured_dbm, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    // Derived from the row so it is the loss this point was corrected by,
    // which is not the same for every row once the table spans bands.
    r.measured_dbm == null || r.measured_dbm_raw == null
      ? ''
      : num(r.measured_dbm - r.measured_dbm_raw, 2),
    r.ok,
    r.status ?? '',
    r.error ?? '',
  ])
  saveCsv(header, body, exportName('lte-cw-automation', mac, 'csv'))
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that LteCwPage owns. */
function snap(): NonNullable<typeof lteCwPageSnapshot.automation> {
  if (!lteCwPageSnapshot.automation) lteCwPageSnapshot.automation = {}
  return lteCwPageSnapshot.automation
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

/**
 * The modem, owned by the page.
 *
 * Power is page-level rather than per-tab because it is one piece of hardware:
 * if this panel kept its own idea of it, a run would send a MODEM_ON the
 * manual tab had already sent, and the modem refuses that.
 */
export interface ModemControl {
  on: boolean
  /**
   * Power the modem down and back up, so a run starts from a known state
   * rather than from what the page believes. Throws if it will not come up.
   */
  cycle: () => Promise<void>
  /**
   * Parameters of the test believed to be running, or null.
   *
   * A getter rather than a value: a run spans many renders, and a captured
   * prop would leave the loop aborting whatever was live when Run was pressed.
   */
  getRunning: () => LteCwRequest | null
  setRunning: (r: LteCwRequest | null) => void
}

interface Props {
  modem: ModemControl
  /** Whether the channel column is read as EARFCNs or MHz. Page-level, so
   *  both tabs agree on what a number in a channel field means. */
  unit: ChannelUnit
  /** Bands a MHz value is allowed to resolve within. */
  bands: number[]
  onUnitChange: (u: ChannelUnit) => void
  onEditBands: () => void
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
}

interface PlanPoint {
  earfcn: number
  band: number
  freqMhz: number
  pow: number
}

export function LteAutomationPanel({
  modem, unit, bands, onUnitChange, onEditBands, onControlsChange,
}: Props) {
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const reporter = useRunReporter('LTE CW automation', 'Automation')
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)

  const DEFAULT_POWER = '23'
  // The starting row follows the unit the panel opens in — the same channel
  // either way round, so a page reopening in MHz does not greet the operator
  // with an EARFCN flagged invalid.
  const [rows, setRows] = useState<ConfigRow[]>(() => snap().rows ?? [
    { earfcn: unit === 'mhz' ? '1880' : '18900', power: DEFAULT_POWER },
  ])
  // Clamped on read: a snapshot saved before the floor existed can hold a
  // value below it, and restoring one would reintroduce the bad readings.
  const [settleMs, setSettleMs] = useState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
  )
  const [results, setResults] = useState<ResultRow[]>(() => snap().results ?? [])

  useEffect(() => { snap().rows = rows; persistLteCwPage() }, [rows])
  useEffect(() => { snap().settleMs = settleMs; persistLteCwPage() }, [settleMs])
  useEffect(() => { snap().results = results; persistLteCwPage() }, [results])

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
  // paint the stale rows — all flagged invalid — for a frame first. Same
  // pattern as PathLossModal's open→ edge.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, earfcn: convertSpec(r.earfcn, lastUnit, unit) })))
  }

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects.
    pendingFocusRef.current = rows.length
    setRows((arr) => [...arr, { earfcn: '', power: DEFAULT_POWER }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<ConfigRow>) =>
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

  // Build the run plan: cartesian product of EARFCNs × powers per row.
  //
  // EARFCNs outside the band table are dropped rather than run. The point of
  // an automation run is the measurement, and without a frequency there is
  // nothing to calibrate the sensor to or to pick a path-loss figure with — a
  // row of numbers measured against the wrong channel is worse than a row that
  // was never taken. The editor flags them so it is a config error, not a
  // surprise forty points in.
  const plan: PlanPoint[] = []
  for (const r of rows) {
    const channels = toChannels(r.earfcn)
    if (channels.length === 0) continue
    const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
      .filter((p) => p >= 0 && p <= MAX_POWER_DBM)
    for (const ch of channels) {
      for (const p of powers) {
        plan.push({
          earfcn: ch.earfcn, band: ch.band, freqMhz: ch.freqHz / 1e6, pow: p,
        })
      }
    }
  }
  const totalPoints = plan.length
  // Settle dominates; the two commands + measure round trips add roughly 400 ms.
  const estimatedRunMs = totalPoints * (settleMs + 400)

  const blankRow = (item: PlanPoint): ResultRow => ({
    earfcn: item.earfcn,
    band: item.band,
    freq_mhz: item.freqMhz,
    set_power_dbm: item.pow,
    measured_dbm: null,
    measured_dbm_raw: null,
    current_a: null,
    voltage_v: null,
    ok: false,
    status: null,
    error: null,
  })

  const paramsFor = (item: PlanPoint): LteCwRequest => ({
    earfcn: item.earfcn,
    time_ms: CW_TIME_MS,
    tx_power_dbm: item.pow,
    offset_hz: CW_OFFSET_HZ,
  })

  /**
   * One point: CW on → settle → read power/CC → abort.
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
      const tx = await device.lteCw({ ...params, start: true }, { signal })
      row.ok = tx.ok
      row.status = tx.status
      if (!tx.ok) {
        row.error = `tx status=${tx.status}`
      } else {
        modem.setRunning(params)
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
        if (m.error) row.error = m.error
      }
    } catch (e) {
      // A cancelled request is the operator stopping, not a measurement fault.
      row.error = signal.aborted ? null : (e as Error).message
    } finally {
      try {
        await device.lteCw({ ...params, start: false })
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
            try { await device.lteCw({ ...live, start: false }) } catch { /* ignore */ }
            modem.setRunning(null)
          },
          rowHasError: (r) => !!r.error,
          onRows: setResults,
          onProgress: setProgressIdx,
          // The settle delay is operator-set and can be long; the guard has to
          // sit above it or it would fire on every point.
          stepTimeoutMs: settleMs + STEP_OVERHEAD_TIMEOUT_MS,
          reporter,
        })
      } finally {
        setRunning(false)
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
      void device.lteCw({ ...live, start: false })
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
      canRun: totalPoints > 0,
      progress: `${progressIdx}/${totalPoints}`,
      onRun,
      onStop,
    })
  }, [running, totalPoints, progressIdx, onRun, onStop, onControlsChange])

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

  const cardBodySx = { flexGrow: 1, overflowY: 'auto' as const, minHeight: 0 }
  const headerCss = { fontSize: 13, fontWeight: 500, color: 'text.primary' as const }

  return (
    <Stack spacing={`${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: `${GRID_GAP}px`,
          alignItems: 'start',
          flexShrink: 0,
        }}
      >
        {/* ── Channel list ─────────────────────────── */}
        <Box sx={{ height: PANEL_HEIGHT, display: 'flex', flexDirection: 'column' }}>
          <Section
            title="Channel list"
            panel
            grow
            action={
              <Stack direction="row" alignItems="center" spacing={1}>
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
            <Box ref={bodyRef} sx={cardBodySx}>
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
                  // Two ways a MHz value fails, and they need different fixes:
                  // in no selected band (tick one) versus in several (untick one).
                  const ambiguous = unit === 'mhz'
                    && parsed.some((m) => uplinkFromMhz(m, bands).length > 1)
                  const earfcnBad = badSpec || unresolved
                  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
                  const inRange = powers.filter((p) => p >= 0 && p <= MAX_POWER_DBM)
                  const badPower = r.power.trim() !== ''
                    && (powers.length === 0 || inRange.length < powers.length)
                  const steps = good.length * inRange.length
                  const hasHeader = i === 0
                  // Show whichever unit is *not* being typed.
                  const first = good[0] ?? null
                  return (
                    <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                      <Stack spacing={0.5} sx={{ width: 24 }}>
                        {hasHeader && <Box sx={{ height: 19 }} />}
                        <Box sx={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{i + 1}.</Typography>
                        </Box>
                      </Stack>
                      <Stack spacing={0.5} sx={{ width: 180 }}>
                        {hasHeader && (
                          <Typography sx={{ ...headerCss, whiteSpace: 'nowrap' }}>
                            {unit === 'earfcn' ? 'EARFCN' : 'Frequency'}
                            <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}>
                              {unit === 'earfcn' ? 'uplink' : 'MHz'}
                            </Box>
                          </Typography>
                        )}
                        <TextField
                          size="small"
                          value={r.earfcn}
                          onChange={(e) => updateRow(i, { earfcn: e.target.value })}
                          inputRef={(el: HTMLInputElement | null) => { earfcnRefs.current[i] = el }}
                          placeholder={unit === 'earfcn' ? 'e.g. 18900 or 18900-18910' : 'e.g. 1880 or 1850-1910'}
                          disabled={running}
                          error={earfcnBad}
                          onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-earfcn`) }}
                          onBlur={() => setFocusKey((k) => (k === `${i}-earfcn` ? null : k))}
                          InputProps={{
                            endAdornment: (
                              <ValidationAdornment
                                show={shouldShowValidation(r.earfcn, !earfcnBad, focusKey === `${i}-earfcn`)}
                                message={
                                  r.earfcn.trim() === ''
                                    ? 'Enter a value'
                                    : !unresolved
                                      ? 'Not a number, range or list'
                                      : unit === 'earfcn'
                                        ? 'Outside the known bands'
                                        : ambiguous
                                          ? 'In more than one selected band'
                                          : 'Not in the selected bands'
                                }
                              />
                            ),
                          }}
                        />
                      </Stack>
                      <Stack spacing={0.5} sx={{ width: 180 }}>
                        {hasHeader && (
                          <Typography sx={{ ...headerCss, whiteSpace: 'nowrap' }}>
                            Power
                            <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}>dBm</Box>
                          </Typography>
                        )}
                        <TextField
                          size="small"
                          placeholder="23"
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
                      </Stack>
                      <Stack spacing={0.5}>
                        {hasHeader && <Box sx={{ height: 19 }} />}
                        <Box sx={{ height: 40, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontSize: 10.5, color: 'text.disabled', minWidth: 96, whiteSpace: 'nowrap' }}>
                            {first && (
                              <Box component="span" sx={{ mr: 0.75 }}>
                                {unit === 'earfcn'
                                  ? `${(first.freqHz / 1e6).toFixed(1)} MHz`
                                  : first.earfcn}
                              </Box>
                            )}
                            {steps} step{steps === 1 ? '' : 's'}
                          </Typography>
                          <IconButton size="small" onClick={() => removeRow(i)} disabled={running}>
                            <DeleteIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Box>
                      </Stack>
                    </Stack>
                  )
                })}
              </Stack>
            </Box>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1, pt: 1, borderTop: 1, borderColor: 'divider', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {unit === 'earfcn'
                ? 'EARFCN / Power: "18900" · "18900-18910" · "18900-18910:5" · "18900,20175"'
                : 'MHz / Power: "1880" · "1850-1910" · "1850-1910:0.5" · "1850,1880,1909.9"'}
            </Typography>
          </Section>
        </Box>

        {/* ── Common settings ─────────────────────────── */}
        <Box sx={{ height: PANEL_HEIGHT, display: 'flex', flexDirection: 'column' }}>
          <Section title="Common settings" panel grow>
            <Box sx={cardBodySx}>
              <Stack spacing={1} sx={{ maxWidth: 320 }}>
                <Box>
                  <LabeledField
                    label="Settle"
                    hint={`ms · per point · min ${MIN_SETTLE_MS}`}
                    type="number" value={settleMs}
                    onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
                    onBlur={() => setSettleMs((v) => clampSettleMs(v))}
                    disabled={running}
                    inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
                  />
                  {/* A long settle looks identical to a hung run, so state the
                      cost up front rather than letting the operator guess. */}
                  {totalPoints > 0 && (
                    <Typography
                      sx={{
                        ...TEXT.micro,
                        mt: 0.5,
                        color: settleMs >= LONG_SETTLE_MS ? 'warning.main' : 'text.secondary',
                      }}
                    >
                      {settleMs >= LONG_SETTLE_MS && '⚠ '}
                      ≈ {formatDuration(estimatedRunMs)} for {totalPoints} point
                      {totalPoints === 1 ? '' : 's'}
                      {' · plus ~10 s to restart the modem'}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          </Section>
        </Box>
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
              color="inherit"
              startIcon={<DeleteSweepIcon sx={{ fontSize: 15 }} />}
              onClick={() => setResults([])}
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
        {results.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            No data yet. Add channels and press Run.
          </Typography>
        ) : (
          <Box ref={resultsScrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '6%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>EARFCN</TableCell>
                  <TableCell>Freq (MHz)</TableCell>
                  <TableCell>Set (dBm)</TableCell>
                  <TableCell>Measured (dBm)</TableCell>
                  <TableCell>CC (mA)</TableCell>
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
