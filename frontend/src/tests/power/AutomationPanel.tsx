import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, IconButton, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import UploadIcon from '@mui/icons-material/Upload'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import ShowChartIcon from '@mui/icons-material/ShowChart'
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
import { GRID_GAP, Section, TEXT } from '../../ui'
import { CSV_HEADER, PA_MODE_LABEL, parsePowerCsv, toCsvBody } from './csv'
import { ResultsGraphModal } from './ResultsGraphModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import {
  powerPageSnapshot,
  persistPowerPage,
  type AutomationResultRow,
  type AutomationSweepRow,
} from '../../store/powerPageStore'

type ResultRow = AutomationResultRow
type SweepRow = AutomationSweepRow

/** Result actions are secondary to the run itself — quiet text buttons on the
 *  panel heading, not another row of outlined buttons competing with it. */
const resultActionSx = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/** Instruments every measured point depends on. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** Budget for the command + measurement either side of the settle delay. */
const STEP_OVERHEAD_TIMEOUT_MS = 30_000

const DEFAULT_SETTLE_MS = SHARED_DEFAULT_SETTLE_MS

/** A settle above this is almost always a typo (500 → 50000). */
const LONG_SETTLE_MS = 10_000

const PA_AUTO = 2
const DEFAULT_POWER = '14'
const PANEL_HEIGHT = 250

/**
 * Sweep table columns.
 *
 * One grid template shared by the header and every row, so the two cannot
 * drift apart the way per-cell fixed widths do.
 *
 * The range-spec columns flex and the pickers stay fixed, so the table fills
 * the panel without the five inputs becoming equal-width — a picker stretched
 * to match a text field reads as a form inflated to fill space.
 */
const COLS = '20px minmax(150px, 1.6fr) minmax(150px, 1.6fr) 116px minmax(104px, 1fr) 56px 32px'
const MIN_TABLE_W = 676

const DEFAULT_ROW: SweepRow = {
  freq: '',
  power: DEFAULT_POWER,
  paMode: PA_AUTO,
  marginDb: '1',
}

/** Fill in a row read back from storage. Snapshots written before PA mode and
 *  the tolerance moved onto the row hold only freq and power. */
function normaliseRow(r: Partial<SweepRow>): SweepRow {
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
const marginValid = (r: SweepRow): boolean => {
  if (r.marginDb.trim() === '') return true
  const m = parseLimit(r.marginDb)
  return m != null && m >= 0
}

interface PlanPoint {
  freq: number
  pow: number
  paMode: number
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
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.freq_mhz.toFixed(3)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.set_power_dbm}</TableCell>
      <TableCell>{PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode}</TableCell>
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
  void saveCsv([...CSV_HEADER], toCsvBody(rows), exportName('tx-cw-automation', mac, 'csv'))
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that PowerPage owns. */
function snap(): NonNullable<typeof powerPageSnapshot.automation> {
  if (!powerPageSnapshot.automation) powerPageSnapshot.automation = {}
  return powerPageSnapshot.automation
}

/**
 * What the page header needs to drive the run.
 *
 * The run lives here — rows, plan, results, abort — but its buttons belong in
 * the header next to the manual tab's Send/Stop, so switching tabs does not
 * move the primary action to a different part of the screen.
 */
export interface AutomationControls {
  running: boolean
  canRun: boolean
  /** "3/40", for the label while running. */
  progress: string
  onRun: () => void
  onStop: () => void
}

interface AutomationPanelProps {
  protocol: string
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
}

export function AutomationPanel({ protocol, onControlsChange }: AutomationPanelProps) {
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const reporter = useRunReporter('TX CW automation', 'Automation')
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const notify = useNotify()
  const hasBackend = protocol === 'LoRa'

  const [rows, setRows] = useState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    return [
      { ...DEFAULT_ROW, freq: '902.3' },
      { ...DEFAULT_ROW, freq: '915.0' },
      { ...DEFAULT_ROW, freq: '927.5' },
    ]
  })
  const power = Number(DEFAULT_POWER)  // fallback if a row's power is left empty
  // Clamped on read: a snapshot saved before the floor existed can hold a
  // value below it, and restoring one would reintroduce the bad readings.
  const [settleMs, setSettleMs] = useState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
  )
  const [results, setResults] = useState<ResultRow[]>(() => snap().results ?? [])
  // Mirrored so the end-of-run summary can count verdicts without waiting for
  // a re-render to publish the last point.
  const resultsRef = useRef<ResultRow[]>(results)

  // Mirror state into the page-level snapshot + persist to localStorage so tab
  // switches, sidebar nav and hard refreshes all keep the data.
  useEffect(() => { snap().rows = rows; persistPowerPage() }, [rows])
  useEffect(() => { snap().settleMs = settleMs; persistPowerPage() }, [settleMs])
  useEffect(() => { snap().results = results; persistPowerPage() }, [results])

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // Replaced per run. Stop aborts it, which cancels the in-flight request and
  // wakes the settle delay immediately.
  const abortRef = useRef(new AbortController())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const freqRefs = useRef<Array<HTMLInputElement | null>>([])
  // A ref, not state: the effect below only needs to know which row to focus
  // once, and holding it in state would mean clearing it from inside that
  // effect for nothing.
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
      const imported = parsePowerCsv(await f.text())
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

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects. The new row copies
    // the last one's settings: adding a frequency to an existing sweep is far
    // more common than starting a different kind of measurement.
    pendingFocusRef.current = rows.length
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, freq: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  /** Points one row expands to. */
  const rowPoints = (r: SweepRow): PlanPoint[] => {
    const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
    if (freqs.length === 0 || !marginValid(r)) return []
    const powers = parseRangeSpec(r.power, power)
    const out: PlanPoint[] = []
    for (const f of freqs) {
      for (const p of powers) {
        out.push({ freq: f, pow: p, paMode: r.paMode, marginDb: parseLimit(r.marginDb) })
      }
    }
    return out
  }

  const plan: PlanPoint[] = rows.flatMap(rowPoints)
  const totalPoints = plan.length
  // Settle dominates; the command + measure round trips add roughly 300 ms.
  const estimatedRunMs = totalPoints * (settleMs + 300)
  // A row with a bad tolerance contributes no points, so it would otherwise
  // vanish from the plan silently rather than blocking the run.
  const anyInvalid = rows.some((r) => r.freq.trim() !== '' && !marginValid(r))

  const blankRow = (item: PlanPoint): ResultRow => ({
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

  /**
   * One point: TX on at this (freq, power) → settle → read power/CC → TX off.
   *
   * The DUT is switched off after every point rather than left transmitting
   * into the next one, so each reading starts from the same state and the PA
   * is never keyed between points. Never throws — failures land in the row.
   */
  const measurePoint = async (item: PlanPoint): Promise<ResultRow> => {
    const fHz = Math.round(item.freq * 1_000_000)
    const { signal } = abortRef.current
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
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        const m = await instrumentsApi.measure(fHz, { signal })
        row.measured_dbm_raw = m.power_dbm
        // Looked up per point: an automation run sweeps frequencies, so a
        // single figure would be right for at most one of them.
        const pl = lossAt(item.freq)
        row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
        if (!pl.calibrated) uncalibrated.current.add(item.freq)
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
  }

  const runM = useMutation({
    mutationFn: async () => {
      if (!hasBackend) {
        reporter.note('no backend for this protocol', 'warn')
        return
      }
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
          measure: measurePoint,
          markRowError: (item, _i, message) => ({ ...blankRow(item), error: message }),
          after: async () => { try { await device.stop() } catch { /* ignore */ } },
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
          const list = [...uncalibrated.current].sort((a, b) => a - b).join(', ')
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
    // Aborting cancels the in-flight request and wakes the settle delay, so
    // the loop notices immediately rather than at the end of the point.
    abortRef.current.abort()
    // Independently tell the DUT to stop transmitting — the abort only ends
    // our side of the conversation.
    if (hasBackend) {
      void device.stop().catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
    }
  }, [hasBackend, reporter])

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
    freqRefs.current[idx]?.focus()
    const body = bodyRef.current
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
  }, [rows.length])

  // Auto-scroll results to the bottom each time a new measurement lands.
  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [results.length])

  const cellSx = { '& .MuiInputBase-root': { height: 34 } }

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
              {/* Settle is the one thing here that is genuinely run-wide: it is
                  about instrument timing, not about the signal, so it stays out
                  of the table. */}
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
                <ColHead label="Freq" hint="MHz" />
                <ColHead label="Power" hint="dBm" />
                <ColHead label="PA Mode" />
                <ColHead label="Tolerance" hint="± dB" />
                <Box />
                <Box />
              </Box>

              <Stack spacing={0.75}>
                {rows.map((r, i) => {
                  const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
                  const badFreq = r.freq.trim() !== '' && freqs.length === 0
                  const powers = parseRangeSpec(r.power, power)
                  const badPower = r.power.trim() !== '' && powers.length === 0
                  const badMargin = !marginValid(r)
                  const steps = rowPoints(r).length
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
                        value={r.freq}
                        onChange={(e) => updateRow(i, { freq: e.target.value })}
                        inputRef={(el: HTMLInputElement | null) => { freqRefs.current[i] = el }}
                        placeholder="915 or 900-930"
                        disabled={running}
                        error={badFreq}
                        onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-freq`) }}
                        onBlur={() => setFocusKey((k) => (k === `${i}-freq` ? null : k))}
                        InputProps={{
                          endAdornment: (
                            <ValidationAdornment
                              show={shouldShowValidation(r.freq, !badFreq, focusKey === `${i}-freq`)}
                              message={r.freq.trim() === '' ? 'Enter a value' : 'Invalid — e.g. 915 or 900-930'}
                            />
                          ),
                        }}
                      />

                      <TextField
                        size="small" sx={cellSx}
                        placeholder="14 or 10-20"
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
                              message="Invalid — e.g. 14 or 10-20"
                            />
                          ),
                        }}
                      />

                      <TextField
                        size="small" select sx={cellSx}
                        value={r.paMode}
                        disabled={running}
                        onChange={(e) => updateRow(i, { paMode: Number(e.target.value) })}
                      >
                        {PA_MODE_LABEL.map((label, code) => (
                          <MenuItem key={code} value={code}>{label}</MenuItem>
                        ))}
                      </TextField>

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

                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', whiteSpace: 'nowrap' }}>
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
              Freq / Power: "915" · "900-930" · "900-930:5" · "902.3,915,927.5"
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
                ≈ {formatDuration(estimatedRunMs)}
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
                <col style={{ width: '6%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Freq (MHz)</TableCell>
                  <TableCell>Set (dBm)</TableCell>
                  <TableCell>PA</TableCell>
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
