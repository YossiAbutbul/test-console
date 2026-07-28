import { memo, useEffect, useRef, useState } from 'react'
import {
  Box, Button, IconButton, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import DownloadIcon from '@mui/icons-material/Download'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import { useMutation } from '@tanstack/react-query'
import { LabeledField } from '../../components/LabeledField'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { formatDuration, sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt, num } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import { TEXT } from '../../ui'
import { ResultsGraphModal } from './ResultsGraphModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import {
  powerPageSnapshot,
  persistPowerPage,
  type AutomationFreqRow,
  type AutomationResultRow,
} from '../../store/powerPageStore'

type ResultRow = AutomationResultRow

const ResultTableRow = memo(function ResultTableRow({ r, i }: { r: ResultRow; i: number }) {
  return (
    <TableRow>
      <TableCell>{i + 1}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.freq_mhz.toFixed(3)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.set_power_dbm}</TableCell>
      <TableCell>{PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.measured_dbm, 2)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
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

const PA_MODE_LABEL = ['Off', 'On', 'Auto']

/** Instruments every measured point depends on. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** Budget for the command + measurement either side of the settle delay. */
const STEP_OVERHEAD_TIMEOUT_MS = 30_000

/** A settle above this is almost always a typo (500 → 50000). */
const LONG_SETTLE_MS = 10_000

/** Export the results table. Values are rounded for Excel readability. */
function downloadCsv(rows: ResultRow[], pathLossDb: number, mac: string | null): void {
  const header = [
    'freq_mhz', 'set_power_dbm', 'pa_mode',
    'measured_dbm', 'current_ma',
    'path_loss_db', 'ok', 'status', 'error',
  ]
  const body = rows.map((r) => [
    num(r.freq_mhz, 2),
    r.set_power_dbm,
    PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode,
    num(r.measured_dbm, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    num(pathLossDb, 2),
    r.ok,
    r.status ?? '',
    r.error ?? '',
  ])
  saveCsv(header, body, exportName('tx-power-automation', mac, 'csv'))
}

type FreqRow = AutomationFreqRow

/** Nested snapshot — auto-created on first write so the page-level store
 *  stays a single object that PowerPage owns. */
function snap(): NonNullable<typeof powerPageSnapshot.automation> {
  if (!powerPageSnapshot.automation) powerPageSnapshot.automation = {}
  return powerPageSnapshot.automation
}

export function AutomationPanel({ protocol }: { protocol: string }) {
  const { pathLossDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const reporter = useRunReporter('TX Power automation', 'Automation')
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const hasBackend = protocol === 'LoRa'
  const DEFAULT_POWER = '14'
  const [rows, setRows] = useState<FreqRow[]>(() => snap().rows ?? [
    { freq: '902.3', power: DEFAULT_POWER },
    { freq: '915.0', power: DEFAULT_POWER },
    { freq: '927.5', power: DEFAULT_POWER },
  ])
  const power = Number(DEFAULT_POWER)  // fallback if a row is left empty
  const [paMode, setPaMode] = useState<number>(() => snap().paMode ?? 2)
  const [settleMs, setSettleMs] = useState<number>(() => snap().settleMs ?? 500)
  const [results, setResults] = useState<ResultRow[]>(() => snap().results ?? [])
  // Mirror state into the page-level snapshot + persist to localStorage so
  // tab switches, sidebar nav and hard refreshes all keep the data. Cleared
  // explicitly by Run (start) and the Clear button.
  useEffect(() => { snap().rows = rows; persistPowerPage() }, [rows])
  useEffect(() => { snap().paMode = paMode; persistPowerPage() }, [paMode])
  useEffect(() => { snap().settleMs = settleMs; persistPowerPage() }, [settleMs])
  useEffect(() => { snap().results = results; persistPowerPage() }, [results])
  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // Replaced per run. Stop aborts it, which cancels the in-flight request and
  // wakes the settle delay immediately.
  const abortRef = useRef(new AbortController())
  // Scroll the rows container + focus the freshly-added freq input after add.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const freqRefs = useRef<Array<HTMLInputElement | null>>([])
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null)
  // Auto-follow the results table to the latest row during a run.
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)

  const addRow = () => {
    setRows((arr) => {
      const next = [...arr, { freq: '', power: DEFAULT_POWER }]
      setPendingFocusIdx(next.length - 1)
      return next
    })
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<FreqRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  // Build the run plan: cartesian product of freqs × powers per row.
  const plan: Array<{ freq: number; pow: number }> = []
  for (const r of rows) {
    const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
    if (freqs.length === 0) continue
    const powers = parseRangeSpec(r.power, power)
    for (const f of freqs) for (const p of powers) plan.push({ freq: f, pow: p })
  }
  const totalPoints = plan.length
  // Settle dominates; the command + measure round trips add roughly 300 ms.
  const estimatedRunMs = totalPoints * (settleMs + 300)

  // Measure one (freq, power) point: TX on → settle → power/CC measure. Never
  // throws — failures are recorded in the returned row.
  const blankRow = (item: { freq: number; pow: number }): ResultRow => ({
    freq_mhz: item.freq,
    set_power_dbm: item.pow,
    pa_mode: paMode,
    measured_dbm: null,
    measured_dbm_raw: null,
    current_a: null,
    voltage_v: null,
    ok: false,
    status: null,
    error: null,
  })

  const measurePoint = async (item: { freq: number; pow: number }): Promise<ResultRow> => {
    const fHz = Math.round(item.freq * 1_000_000)
    const { signal } = abortRef.current
    const row = blankRow(item)
    if (signal.aborted) return row
    try {
      const tx = await device.loraPower(
        { freq_hz: fHz, power_dbm: item.pow, pa_mode: paMode },
        { signal },
      )
      row.ok = tx.ok
      row.status = tx.status
      if (!tx.ok) {
        row.error = `tx status=${tx.status}`
      } else {
        await sleep(settleMs, signal)
        if (signal.aborted) { try { await device.stop() } catch { /* ignore */ } ; return row }
        const m = await instrumentsApi.measure(fHz, { signal })
        row.measured_dbm_raw = m.power_dbm
        row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pathLossDb
        row.current_a = m.current_a
        row.voltage_v = m.voltage_v
        if (m.error) row.error = m.error
      }
    } catch (e) {
      // A cancelled request is the operator stopping, not a measurement fault.
      row.error = signal.aborted ? null : (e as Error).message
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
      setProgressIdx(0)
      try {
        await runSequence<{ freq: number; pow: number }, ResultRow>({
          items: plan,
          abort,
          measure: measurePoint,
          markRowError: (item, _i, message) => ({ ...blankRow(item), error: message }),
          after: async () => { try { await device.stop() } catch { /* ignore */ } },
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
      }
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  const onStop = () => {
    // Aborting cancels the in-flight request and wakes the settle delay, so
    // the loop notices immediately rather than at the end of the point.
    abortRef.current.abort()
    // Independently tell the DUT to stop transmitting — the abort only ends
    // our side of the conversation.
    if (hasBackend) {
      void device.stop().catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
    }
  }

  useEffect(() => {
    if (pendingFocusIdx == null) return
    const el = freqRefs.current[pendingFocusIdx]
    el?.focus()
    const body = bodyRef.current
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
    setPendingFocusIdx(null)
  }, [pendingFocusIdx, rows.length])

  // Auto-scroll results to the bottom each time a new measurement lands.
  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [results.length])

  const PANEL_HEIGHT = 250
  const cardSx = {
    height: PANEL_HEIGHT,
    display: 'flex' as const,
    flexDirection: 'column' as const,
  }
  const cardHeaderSx = {
    height: 44,
    pb: 1, mb: 1.5,
    borderBottom: 1, borderColor: 'divider' as const,
    flexShrink: 0,
    display: 'flex' as const,
    alignItems: 'center' as const,
  }
  const cardBodySx = {
    flexGrow: 1,
    overflowY: 'auto' as const,
    minHeight: 0,
  }

  return (
    <Stack spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
          alignItems: 'start',
          flexShrink: 0,
        }}
      >
        {/* ── Frequency list ─────────────────────────── */}
        <Box sx={cardSx}>
          <Stack direction="row" alignItems="center" sx={{ ...cardHeaderSx, width: '100%' }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, flexGrow: 1 }}>
              Frequency list
              <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary' }}>
                {totalPoints} point{totalPoints === 1 ? '' : 's'} total
              </Typography>
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={addRow}
              disabled={running}
            >
              Add
            </Button>
          </Stack>
          <Box ref={bodyRef} sx={cardBodySx}>
          <Stack spacing={0.75}>
            {rows.map((r, i) => {
              const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
              const badFreq = r.freq.trim() !== '' && freqs.length === 0
              const powers = parseRangeSpec(r.power, power)
              const bad = r.power.trim() !== '' && powers.length === 0
              const headerCss = { fontSize: 13, fontWeight: 500, color: 'text.primary' as const }
              const hasHeader = i === 0
              return (
                <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                  <Stack spacing={0.5} sx={{ width: 24 }}>
                    {hasHeader && <Box sx={{ height: 19 }} />}
                    <Box sx={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {i + 1}.
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack spacing={0.5} sx={{ width: 180 }}>
                    {hasHeader && (
                      <Typography sx={{ ...headerCss, whiteSpace: 'nowrap' }}>
                        Freq
                        <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}>MHz</Box>
                      </Typography>
                    )}
                    <TextField
                      size="small"
                      value={r.freq}
                      onChange={(e) => updateRow(i, { freq: e.target.value })}
                      inputRef={(el: HTMLInputElement | null) => { freqRefs.current[i] = el }}
                      placeholder="e.g. 915 or 900-930"
                      disabled={running}
                      error={badFreq}
                      onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-freq`) }}
                      onBlur={() => setFocusKey((k) => (k === `${i}-freq` ? null : k))}
                      InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(r.freq, !badFreq, focusKey === `${i}-freq`)} message={r.freq.trim() === '' ? 'Enter a value' : 'Invalid — e.g. 915 or 900-930'} /> }}
                    />
                  </Stack>
                  <Stack spacing={0.5} sx={{ width: 220 }}>
                    {hasHeader && (
                      <Typography sx={{ ...headerCss, whiteSpace: 'nowrap' }}>
                        Power
                        <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}>dBm</Box>
                      </Typography>
                    )}
                    <TextField
                      size="small"
                      placeholder="14"
                      value={r.power}
                      onChange={(e) => updateRow(i, { power: e.target.value })}
                      onFocus={(e) => { (e.target as HTMLInputElement).select(); setFocusKey(`${i}-power`) }}
                      onBlur={() => setFocusKey((k) => (k === `${i}-power` ? null : k))}
                      disabled={running}
                      error={bad}
                      InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(r.power, !bad, focusKey === `${i}-power`)} message="Invalid — e.g. 14 or 10-20" /> }}
                    />
                  </Stack>
                  <Stack spacing={0.5}>
                    {hasHeader && <Box sx={{ height: 19 }} />}
                    <Box sx={{ height: 40, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', minWidth: 56, whiteSpace: 'nowrap' }}>
                        {freqs.length * powers.length} step{freqs.length * powers.length === 1 ? '' : 's'}
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
            Freq / Power: "915" · "900-930" · "900-930:5" · "902.3,915,927.5"
          </Typography>
        </Box>

        <Box sx={cardSx}>
          <Box sx={cardHeaderSx}>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>
              Common settings
            </Typography>
          </Box>
          <Box sx={cardBodySx}>
            <Stack spacing={1} sx={{ maxWidth: 320 }}>
              <LabeledField
                label="PA Mode" select value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
              >
                <MenuItem value={2}>Auto</MenuItem>
                <MenuItem value={1}>On</MenuItem>
                <MenuItem value={0}>Off</MenuItem>
              </LabeledField>
              <Box>
                <LabeledField
                  label="Settle" hint="ms" type="number" value={settleMs}
                  historyKey={`${protocol}.automation.settle_ms`}
                  onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
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
                  </Typography>
                )}
              </Box>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={() => runM.mutate()}
          disabled={running || totalPoints === 0}
          sx={{ minWidth: 140 }}
        >
          {running ? `Running ${progressIdx}/${totalPoints}` : 'Run'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<StopIcon />}
          onClick={onStop}
          disabled={!running}
        >
          Stop
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<DeleteSweepIcon />}
          onClick={() => setResults([])}
          disabled={results.length === 0 || running}
        >
          Clear
        </Button>
        <Button
          variant="outlined"
          startIcon={<ShowChartIcon />}
          onClick={() => setGraphOpen(true)}
          disabled={results.length === 0}
        >
          Graph
        </Button>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => downloadCsv(results, pathLossDb, bleStatus?.address ?? null)}
          disabled={results.length === 0}
        >
          Export
        </Button>
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 1, pb: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          Results
          <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary' }}>
            corrected = measured + path-loss ({pathLossDb} dB)
          </Typography>
        </Typography>
        {results.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            No data yet. Add frequencies and press Run.
          </Typography>
        ) : (
          <Box ref={resultsScrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '6%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Freq (MHz)</TableCell>
                  <TableCell>Set (dBm)</TableCell>
                  <TableCell>PA</TableCell>
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
      </Box>

      <ResultsGraphModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        results={results}
      />
      {preflight.dialog}
    </Stack>
  )
}
