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
import { useMutation } from '@tanstack/react-query'
import { LabeledField } from '../../components/LabeledField'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { useConnection } from '../../context/ConnectionContext'
import { useNotify } from '../../context/NotifyContext'
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

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function downloadCsv(rows: ResultRow[], pathLossDb: number, mac: string | null): void {
  // Excel-friendly numeric formatting: round to 2 decimals max, then drop
  // trailing zeros so 902.30 → "902.3", 20.50 → "20.5", 20.00 → "20".
  const n2 = (v: number | null | undefined): string => {
    if (v == null || !Number.isFinite(v)) return ''
    return String(parseFloat(v.toFixed(2)))
  }
  const head = [
    'freq_mhz', 'set_power_dbm', 'pa_mode',
    'measured_dbm', 'current_ma',
    'path_loss_db', 'ok', 'status', 'error',
  ]
  const lines = [head.join(',')]
  for (const r of rows) {
    const cols = [
      n2(r.freq_mhz), r.set_power_dbm, PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode,
      n2(r.measured_dbm),
      r.current_a == null ? '' : n2(r.current_a * 1000),
      n2(pathLossDb), r.ok, r.status ?? '', r.error ?? '',
    ]
    lines.push(cols.map((v) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // Excel uses the CSV file's base name as the sheet name. Strip colons from
  // the DUT MAC so it becomes a valid (and tidy) sheet name.
  const macSlug = (mac ?? '').replace(/:/g, '').toUpperCase()
  const base = macSlug || 'tx-power-automation'
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}-${ts}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Parse a list/range spec for either freq or power.
 *  Supported:
 *    ""          → fallback != null ? [fallback] : []
 *    "12"        → [12]
 *    "0-14"      → 0..14 step 1
 *    "0-14:2"    → 0,2,4,…,14
 *    "0,5,10,14" → [0,5,10,14]
 *  Returns [] on syntax error so the caller can flag the row.
 */
function parseList(raw: string, fallback: number | null = null): number[] {
  // Normalize various dash chars (en-dash, em-dash, minus sign, etc.) to a
  // plain hyphen so the range syntax keeps working when the user pastes
  // text that auto-corrected the dash.
  const s = raw.trim().replace(/[‐-―−]/g, '-')
  if (!s) return fallback == null ? [] : [fallback]
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(-?\d+(?:\.\d+)?))?$/)
  if (m) {
    const a = Number(m[1]); const b = Number(m[2])
    const step = Math.abs(Number(m[3] ?? 1))
    if (!Number.isFinite(a) || !Number.isFinite(b) || step <= 0) return []
    const out: number[] = []
    if (a <= b) for (let v = a; v <= b + 1e-9; v += step) out.push(Number(v.toFixed(6)))
    else for (let v = a; v >= b - 1e-9; v -= step) out.push(Number(v.toFixed(6)))
    return out
  }
  const parts = s.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n))
  return parts
}

// Back-compat alias used elsewhere in the file.
const parsePowers = parseList

type FreqRow = AutomationFreqRow

/** Nested snapshot — auto-created on first write so the page-level store
 *  stays a single object that PowerPage owns. */
function snap(): NonNullable<typeof powerPageSnapshot.automation> {
  if (!powerPageSnapshot.automation) powerPageSnapshot.automation = {}
  return powerPageSnapshot.automation
}

export function AutomationPanel({ protocol }: { protocol: string }) {
  const { log } = useLog()
  const { pathLossDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const notify = useNotify()
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
  const abortRef = useState<{ stop: boolean }>({ stop: false })[0]
  // Scroll the rows container + focus the freshly-added freq input after add.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const freqRefs = useRef<Array<HTMLInputElement | null>>([])
  const [pendingFocusIdx, setPendingFocusIdx] = useState<number | null>(null)
  // Auto-follow the results table to the latest row during a run.
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)

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
    const freqs = parseList(r.freq).filter((f) => f > 0)
    if (freqs.length === 0) continue
    const powers = parseList(r.power, power)
    for (const f of freqs) for (const p of powers) plan.push({ freq: f, pow: p })
  }
  const totalPoints = plan.length

  const runM = useMutation({
    mutationFn: async () => {
      if (!hasBackend) {
        log('Automation', 'no backend for this protocol', 'warn')
        return
      }
      abortRef.stop = false
      setRunning(true)
      setResults([])
      setProgressIdx(0)
      try {
        const collected: ResultRow[] = []
        for (let i = 0; i < plan.length; i++) {
          if (abortRef.stop) {
            log('Automation', 'stopped by user', 'warn')
            break
          }
          setProgressIdx(i + 1)
          const { freq: fMhz, pow } = plan[i]
          const fHz = Math.round(fMhz * 1_000_000)
          const row: ResultRow = {
            freq_mhz: fMhz,
            set_power_dbm: pow,
            pa_mode: paMode,
            measured_dbm: null,
            measured_dbm_raw: null,
            current_a: null,
            voltage_v: null,
            ok: false,
            status: null,
            error: null,
          }
          try {
            const tx = await device.loraPower({
              freq_hz: fHz,
              power_dbm: pow,
              pa_mode: paMode,
            })
            row.ok = tx.ok
            row.status = tx.status
            if (!tx.ok) {
              row.error = `tx status=${tx.status}`
            } else {
              await sleep(settleMs)
              const m = await instrumentsApi.measure(fHz)
              row.measured_dbm_raw = m.power_dbm
              row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pathLossDb
              row.current_a = m.current_a
              row.voltage_v = m.voltage_v
              if (m.error) row.error = m.error
            }
          } catch (e) {
            row.error = (e as Error).message
          }
          collected.push(row)
          setResults([...collected])
        }
        // Best-effort stop after sweep.
        try { await device.stop() } catch { /* ignore */ }
        log('Automation', `done — ${collected.length}/${plan.length} points`)
        const errCount = collected.filter((r) => r.error).length
        if (abortRef.stop) {
          notify.warning(
            `Stopped at ${collected.length}/${plan.length} points`,
            { title: 'Automation cancelled' },
          )
        } else if (errCount > 0) {
          notify.warning(
            `Finished with ${errCount} error${errCount === 1 ? '' : 's'} (${collected.length}/${plan.length} points)`,
            { title: 'Automation done' },
          )
        } else {
          notify.success(
            `${collected.length} point${collected.length === 1 ? '' : 's'} measured`,
            { title: 'Automation done' },
          )
        }
      } finally {
        setRunning(false)
      }
    },
    onError: (e: Error) => {
      log('Automation', `failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Automation failed' })
    },
  })

  const onStop = () => {
    abortRef.stop = true
    // Also send a real stop to the DUT immediately so it doesn't keep
    // transmitting between the current point and where the loop notices
    // the abort flag.
    if (hasBackend) {
      void device.stop().catch((e: Error) => log('Automation', `stop failed: ${e.message}`, 'error'))
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
              const freqs = parseList(r.freq).filter((f) => f > 0)
              const badFreq = r.freq.trim() !== '' && freqs.length === 0
              const powers = parsePowers(r.power, power)
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
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                      inputRef={(el: HTMLInputElement | null) => { freqRefs.current[i] = el }}
                      placeholder="e.g. 915 or 900-930"
                      disabled={running}
                      error={badFreq}
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
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                      disabled={running}
                      error={bad}
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
              <LabeledField
                label="Settle" hint="ms" type="number" value={settleMs}
                historyKey={`${protocol}.automation.settle_ms`}
                onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
              />
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
            <Table size="small" stickyHeader>
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
    </Stack>
  )
}
