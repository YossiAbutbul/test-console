import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, IconButton, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DownloadIcon from '@mui/icons-material/Download'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { motor } from '../../api/motor'
import { servo } from '../../api/servo'
import { vna } from '../../api/networkAnalyzer'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { useInstrumentValue } from '../../context/InstrumentsContext'
import { useConnection } from '../../context/ConnectionContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { sleep } from '../../lib/async'
import { downloadBlob, exportName, toCsv } from '../../lib/download'
import { fmt, num } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, MONO, PageBody, PathLossChip, Readout, RunControls,
  Section, StatusChip, TEXT,
} from '../../ui'
import type { TestPageProps } from '../types'
import {
  loadPullPageSnapshot, persistLoadPullPage, type LoadPullResultRow,
} from '../../store/loadPullPageStore'
import { SmithChartModal } from './SmithChartModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { planPositions } from './plan'
import { useTromboneJog } from './useTromboneJog'

const PULSES_PER_MM = 400

/** Every stage of a point touches one of these. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = [
  'power-sensor', 'dc-analyzer', 'network-analyzer', 'rf-switch', 'rf-trombone',
]

/** Budget for the motor travel, switching and measuring around the delays. */
const STEP_OVERHEAD_TIMEOUT_MS = 90_000

const blankRow = (pos: number): LoadPullResultRow => ({
  pos_pulses: pos,
  pos_mm: mm(pos),
  power_dbm: null,
  current_a: null,
  r_ohm: null,
  x_ohm: null,
  s11_db: null,
  error: null,
})

const mm = (p: number) => p / PULSES_PER_MM

interface CsvMeta {
  freqMhz: number
  powerDbm: number
  pathLossDb: number
  mac: string | null
}

/** Export the sweep. The run's fixed parameters go in a leading comment line
 *  so a stray CSV is still self-describing. */
function downloadCsv(rows: LoadPullResultRow[], meta: CsvMeta): void {
  const header = [
    '#', 'pos_mm', 'pos_pulses', 'power_dbm', 'cc_ma',
    'r_ohm', 'x_ohm', 's11_db', 'error',
  ]
  const body = rows.map((r, i) => [
    i + 1,
    num(r.pos_mm),
    r.pos_pulses,
    num(r.power_dbm),
    r.current_a == null ? '' : num(r.current_a * 1000),
    num(r.r_ohm),
    num(r.x_ohm),
    num(r.s11_db),
    r.error ?? '',
  ])
  const preamble =
    `# freq_mhz=${meta.freqMhz} power_dbm=${meta.powerDbm} path_loss_db=${meta.pathLossDb}\r\n`
  const blob = new Blob([preamble + toCsv(header, body)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, exportName('load-pull', meta.mac, 'csv', '-load-pull'))
}

export function LoadPullPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const notify = useNotify()
  const reporter = useRunReporter('Load Pull', 'LoadPull')
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const { pathLossDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const hasBackend = protocol === 'LoRa'

  const ps = useInstrumentValue('power-sensor')
  const dc = useInstrumentValue('dc-analyzer')
  const na = useInstrumentValue('network-analyzer')
  const sw = useInstrumentValue('rf-switch')
  const tr = useInstrumentValue('rf-trombone')
  const dutConnected = !!bleStatus?.connected

  const allReady =
    ps.status === 'connected' && dc.status === 'connected' && na.status === 'connected' &&
    sw.status === 'connected' && tr.status === 'connected' && dutConnected

  const [freqMhz, setFreqMhz] = useState<number>(() => loadPullPageSnapshot.freqMhz ?? 902.3)
  const [powerDbm, setPowerDbm] = useState<number>(() => loadPullPageSnapshot.powerDbm ?? 14)
  const [paMode, setPaMode] = useState<number>(() => loadPullPageSnapshot.paMode ?? 2)
  const [settleMs, setSettleMs] = useState<number>(() => loadPullPageSnapshot.settleMs ?? 500)
  const [deltaXmm, setDeltaXmm] = useState<number>(() => loadPullPageSnapshot.deltaXmm ?? 1)
  const [jogSpeed, setJogSpeed] = useState<number>(() => loadPullPageSnapshot.jogSpeed ?? 800)
  const [zeroPulses, setZeroPulses] = useState<number | null>(() => loadPullPageSnapshot.zeroPulses ?? null)
  const [endPulses, setEndPulses] = useState<number | null>(() => loadPullPageSnapshot.endPulses ?? null)
  const [pathAck, setPathAck] = useState<boolean>(() => !!loadPullPageSnapshot.pathAck)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => loadPullPageSnapshot.results ?? [])
  const [smithOpen, setSmithOpen] = useState(false)

  useEffect(() => { loadPullPageSnapshot.freqMhz = freqMhz; persistLoadPullPage() }, [freqMhz])
  useEffect(() => { loadPullPageSnapshot.powerDbm = powerDbm; persistLoadPullPage() }, [powerDbm])
  useEffect(() => { loadPullPageSnapshot.paMode = paMode; persistLoadPullPage() }, [paMode])
  useEffect(() => { loadPullPageSnapshot.settleMs = settleMs; persistLoadPullPage() }, [settleMs])
  useEffect(() => { loadPullPageSnapshot.deltaXmm = deltaXmm; persistLoadPullPage() }, [deltaXmm])
  useEffect(() => { loadPullPageSnapshot.jogSpeed = jogSpeed; persistLoadPullPage() }, [jogSpeed])
  useEffect(() => { loadPullPageSnapshot.zeroPulses = zeroPulses; persistLoadPullPage() }, [zeroPulses])
  useEffect(() => { loadPullPageSnapshot.endPulses = endPulses; persistLoadPullPage() }, [endPulses])
  useEffect(() => { loadPullPageSnapshot.pathAck = pathAck; persistLoadPullPage() }, [pathAck])
  useEffect(() => { loadPullPageSnapshot.results = results; persistLoadPullPage() }, [results])

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  // Replaced per run. Stop aborts it, which cancels in-flight requests and
  // wakes every settle delay immediately.
  const abortRef = useRef(new AbortController())
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [results.length])

  // Trombone status + jog + soft-limit sync + wait-for-idle, all in one hook.
  const {
    motorConnected, motorMoving, motorPos,
    jogDir, jogFocused, setJogFocused,
    startJog, stopJog, onJogKeyDown, onJogKeyUp,
    goMinM, goMaxM, motorJogBusy,
    travelMin, travelMax, waitForMotorIdle,
  } = useTromboneJog({ running, zeroPulses, endPulses, jogSpeed, abortRef })

  // Manual RF switch routing — same servo presets the run loop uses.
  const swConnected = sw.status === 'connected'
  const switchM = useMutation({
    mutationFn: (t: 'VNA' | 'PCB') => servo.goto(t),
    onSuccess: (_d, t) => { log('Switch', `→ ${t} ok`) },
    onError: (e: Error, t) => {
      log('Switch', `→ ${t} failed: ${e.message}`, 'error')
      notify.error(e.message, { title: `Switch → ${t}` })
    },
  })

  // Plan: trombone positions (pulses) from zero -> end stepping by delta.
  const deltaPulses = Math.max(1, Math.round(deltaXmm * PULSES_PER_MM))
  const positions = deltaXmm <= 0 ? [] : planPositions(zeroPulses, endPulses, deltaPulses)
  const totalPoints = positions.length

  // Instruments are deliberately not gated here — the preflight connects them
  // on Run, and gating would make an unconnected rig look like a broken page.
  // The DUT link is different: nothing can connect it on the operator's behalf.
  const canRun = hasBackend && dutConnected && pathAck && totalPoints > 0 && !running

  // Measure one trombone position: move → VNA marker (R/J/S11) → PCB → TX →
  // power+CC. Never throws — failures are recorded in the returned row.
  const measureAt = async (pos: number, freqHz: number): Promise<LoadPullResultRow> => {
    const { signal } = abortRef.current
    const row = blankRow(pos)
    try {
      // 1. trombone -> position
      await motor.move(pos, true)
      await waitForMotorIdle()
      if (signal.aborted) return row

      // 2. switch -> VNA, measure marker
      await servo.goto('VNA')
      await sleep(settleMs, signal)
      if (signal.aborted) return row
      const m = await vna.measure([freqHz])
      const mk = m.markers?.[0]
      if (mk) {
        row.r_ohm = mk.r_ohm
        row.x_ohm = mk.x_ohm
        row.s11_db = mk.s11_mag_db
      } else {
        // A measure that fails raises; an empty marker list means the sweep
        // ran but the requested frequency fell outside it.
        row.error = 'vna: no marker returned'
      }

      // 3. switch -> PCB
      await servo.goto('PCB')
      await sleep(settleMs, signal)
      if (signal.aborted) return row

      // 4. TX on
      const tx = await device.loraPower(
        { freq_hz: freqHz, power_dbm: powerDbm, pa_mode: paMode },
        { signal },
      )
      if (!tx.ok) {
        row.error = (row.error ? row.error + '; ' : '') + `tx status=${tx.status}`
      } else {
        await sleep(settleMs, signal)
        // 5. measure power + CC; apply path loss correction
        const meas = await instrumentsApi.measure(freqHz, { signal })
        row.power_dbm = meas.power_dbm == null ? null : meas.power_dbm + pathLossDb
        row.current_a = meas.current_a
        if (meas.error) row.error = (row.error ? row.error + '; ' : '') + meas.error
      }
      // 6. TX off
      try { await device.stop() } catch { /* ignore */ }
    } catch (e) {
      // A cancelled request is the operator stopping, not a measurement fault.
      if (!signal.aborted) row.error = (e as Error).message
      try { await device.stop() } catch { /* ignore */ }
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
      const freqHz = Math.round(freqMhz * 1_000_000)
      try {
        await runSequence<number, LoadPullResultRow>({
          items: positions,
          abort,
          markRowError: (pos, _i, message) => ({ ...blankRow(pos), error: message }),
          // A point moves the trombone and settles three times, so its budget
          // has to cover the motor travel as well as the delays.
          stepTimeoutMs: settleMs * 3 + STEP_OVERHEAD_TIMEOUT_MS,
          before: async () => {
            try { await vna.setMarkers([freqHz]) }
            catch (e) { reporter.note(`setMarkers failed: ${(e as Error).message}`, 'warn') }
          },
          measure: (pos) => measureAt(pos, freqHz),
          after: async () => { try { await device.stop() } catch { /* ignore */ } },
          rowHasError: (r) => !!r.error,
          onRows: setResults,
          onProgress: setProgressIdx,
          reporter,
        })
      } finally {
        setRunning(false)
      }
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  const onStop = () => {
    abortRef.current.abort()
    void device.stop().catch(() => { /* ignore */ })
    void motor.stop().catch(() => { /* ignore */ })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Load Pull Test"
        actions={
          <RunControls
            running={running}
            canRun={canRun}
            progress={`${progressIdx}/${totalPoints}`}
            onRun={() => runM.mutate()}
            onStop={onStop}
          />
        }
      />

      <PageBody width="full" scroll>
        <Section
          title="Instruments"
          step={1}
          action={
            <Typography
              sx={{
                ...TEXT.hint,
                fontWeight: 600,
                color: allReady ? 'success.main' : 'text.secondary',
              }}
            >
              {allReady ? 'all ready' : 'connect missing instruments in the Instruments modal'}
            </Typography>
          }
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <StatusChip label="Power sensor" tone={ps.status === 'connected' ? 'ok' : 'off'} />
            <StatusChip label="DC analyzer" tone={dc.status === 'connected' ? 'ok' : 'off'} />
            <StatusChip label="VNA" tone={na.status === 'connected' ? 'ok' : 'off'} />
            <StatusChip label="Switch" tone={sw.status === 'connected' ? 'ok' : 'off'} />
            <StatusChip
              label="Trombone"
              tone={tr.status === 'connected' ? 'ok' : 'off'}
              detail={motorPos == null ? undefined : `pos ${motorPos.toLocaleString()}`}
            />
            <StatusChip
              label="BLE DUT"
              tone={dutConnected ? 'ok' : 'off'}
              detail={bleStatus?.address ?? undefined}
            />
          </Stack>
        </Section>

        <Section
          title="Path loss"
          step={2}
          action={
            <Button
              size="small"
              variant={pathAck ? 'contained' : 'outlined'}
              color={pathAck ? 'success' : 'primary'}
              onClick={() => setPathAck(!pathAck)}
            >
              {pathAck ? '✓ RF path verified' : 'Confirm RF path'}
            </Button>
          }
        >
          <PathLossChip pathLossDb={pathLossDb} />
          {!pathAck && (
            <Typography sx={{ ...TEXT.hint, color: 'warning.main', mt: 1 }}>
              Verify cabling: <b>DUT → switch → coupler → power sensor</b>. Click to confirm.
            </Typography>
          )}
        </Section>

        <Section title="RF switch">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant="outlined"
              onClick={() => switchM.mutate('PCB')}
              disabled={!swConnected || switchM.isPending || running}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.lg }}
            >
              Go PCB
            </Button>
            <Button
              variant="outlined"
              onClick={() => switchM.mutate('VNA')}
              disabled={!swConnected || switchM.isPending || running}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.lg }}
            >
              Go VNA
            </Button>
            {!swConnected && (
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                connect the switch in the Instruments modal
              </Typography>
            )}
          </Stack>
        </Section>

        <Section title="Test point" step={3}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <LabeledField
              label="Frequency" hint="MHz" type="number" value={freqMhz}
              historyKey="loadPull.freqMhz"
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }}
              sx={{ width: 180 }}
            />
            <LabeledField
              label="DUT Power" hint="dBm" type="number" value={powerDbm}
              historyKey="loadPull.powerDbm"
              onChange={(e) => setPowerDbm(Number(e.target.value))}
              sx={{ width: 160 }}
            />
            <LabeledField
              label="PA Mode" select value={paMode}
              onChange={(e) => setPaMode(Number(e.target.value))}
              sx={{ width: 140 }}
            >
              <MenuItem value={2}>Auto</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={0}>Off</MenuItem>
            </LabeledField>
            <LabeledField
              label="Settle" hint="ms" type="number" value={settleMs}
              historyKey="loadPull.settleMs"
              onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
              sx={{ width: 140 }}
            />
          </Stack>
        </Section>

        <Section
          title="Trombone calibration"
          step={4}
          action={
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              {PULSES_PER_MM} pulses/mm
            </Typography>
          }
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
              <Box sx={{ flexGrow: 1 }}>
                <Readout
                  label="Live position"
                  value={motorPos == null ? 'NA' : `${mm(motorPos).toFixed(2)} mm`}
                  note={motorPos == null ? undefined : `(${motorPos.toLocaleString()} pulses)`}
                />
              </Box>
              <StatusChip
                label={motorConnected ? (motorMoving ? 'Moving' : 'Idle') : 'Disconnected'}
                tone={motorConnected ? (motorMoving ? 'busy' : 'ok') : 'off'}
                spinning={motorConnected && motorMoving}
              />
            </Stack>

            <Stack direction="row" spacing={1.5} alignItems="flex-end" justifyContent="flex-start" useFlexGap flexWrap="nowrap" sx={{ mb: 2, overflowX: 'auto' }}>
              <Button
                variant="outlined" startIcon={<FirstPageIcon />}
                onClick={() => goMinM.mutate()}
                disabled={!motorConnected || motorJogBusy || running || travelMin == null}
                title={travelMin == null ? 'Capture zero first' : undefined}
                sx={{ minWidth: 96, height: 40 }}
              >
                Min
              </Button>

              {/* Press-and-hold jog pad — focus it, then hold ← / → to run the
                  motor; release to stop. Mouse press-hold works too. */}
              <Box
                tabIndex={motorConnected && !running ? 0 : -1}
                onKeyDown={onJogKeyDown}
                onKeyUp={onJogKeyUp}
                onFocus={() => setJogFocused(true)}
                onBlur={() => { setJogFocused(false); stopJog() }}
                sx={{
                  height: 40, px: 1,
                  display: 'flex', alignItems: 'center', gap: 0.5,
                  border: 1, borderColor: jogFocused ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  outline: 'none',
                  bgcolor: jogFocused ? 'action.hover' : 'transparent',
                  opacity: motorConnected && !running ? 1 : 0.5,
                  userSelect: 'none',
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                <IconButton
                  size="small"
                  disabled={!motorConnected || running}
                  onMouseDown={() => startJog(false)}
                  onMouseUp={stopJog}
                  onMouseLeave={stopJog}
                  sx={{ color: jogDir < 0 ? 'primary.main' : 'text.secondary' }}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: jogDir !== 0 ? 'warning.main' : (jogFocused ? 'primary.main' : 'text.secondary'), whiteSpace: 'nowrap', minWidth: 78, textAlign: 'center' }}>
                  {jogDir !== 0 ? 'jogging…' : jogFocused ? 'hold ← →' : 'click + hold'}
                </Typography>
                <IconButton
                  size="small"
                  disabled={!motorConnected || running}
                  onMouseDown={() => startJog(true)}
                  onMouseUp={stopJog}
                  onMouseLeave={stopJog}
                  sx={{ color: jogDir > 0 ? 'primary.main' : 'text.secondary' }}
                >
                  <ArrowForwardIcon />
                </IconButton>
              </Box>

              <Button
                variant="outlined" endIcon={<LastPageIcon />}
                onClick={() => goMaxM.mutate()}
                disabled={!motorConnected || motorJogBusy || running || travelMax == null}
                title={travelMax == null ? 'Capture end first' : undefined}
                sx={{ minWidth: 96, height: 40 }}
              >
                Max
              </Button>

              <LabeledField
                label="Jog speed" select value={jogSpeed}
                width={130}
                onChange={(e) => setJogSpeed(Number(e.target.value))}
              >
                <MenuItem value={400}>Slow</MenuItem>
                <MenuItem value={800}>Medium</MenuItem>
                <MenuItem value={1500}>Fast</MenuItem>
              </LabeledField>
            </Stack>

            <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
                  Zero reference (Smith chart starting point)
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => setZeroPulses(motorPos)}
                    disabled={motorPos == null || running}
                  >
                    Capture zero
                  </Button>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                    {zeroPulses == null ? '—' : `${mm(zeroPulses).toFixed(2)} mm  (${zeroPulses.toLocaleString()})`}
                  </Typography>
                  {zeroPulses != null && (
                    <Button size="small" onClick={() => setZeroPulses(null)} disabled={running}>clear</Button>
                  )}
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
                  End position (full Smith chart cycle)
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => setEndPulses(motorPos)}
                    disabled={motorPos == null || running}
                  >
                    Capture end
                  </Button>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                    {endPulses == null ? '—' : `${mm(endPulses).toFixed(2)} mm  (${endPulses.toLocaleString()})`}
                  </Typography>
                  {endPulses != null && (
                    <Button size="small" onClick={() => setEndPulses(null)} disabled={running}>clear</Button>
                  )}
                </Stack>
              </Box>
              <LabeledField
                label="Delta X" hint="mm"
                type="number" value={deltaXmm}
                historyKey="loadPull.deltaXmm"
                onChange={(e) => setDeltaXmm(Math.max(0, Number(e.target.value) || 0))}
                inputProps={{ step: 0.1, min: 0 }}
                sx={{ width: 140 }}
              />
            </Stack>

            <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: 1.5 }}>
              {totalPoints > 0
                ? <>Plan: <b>{totalPoints}</b> points · {fmt(zeroPulses == null ? null : mm(zeroPulses))} → {fmt(endPulses == null ? null : mm(endPulses))} mm · step {deltaXmm} mm ({deltaPulses} pulses)</>
                : <>Capture zero + end positions and set Delta X to build the sweep plan.</>}
            </Typography>
          </Box>
        </Section>

        <Section
          title="Results"
          step={5}
          hint={`power = sensor + path loss (${pathLossDb} dB)`}
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small" variant="outlined" color="inherit"
                startIcon={<DeleteSweepIcon />}
                onClick={() => setResults([])}
                disabled={results.length === 0 || running}
              >
                Clear
              </Button>
              <Button
                size="small" variant="outlined"
                startIcon={<ScatterPlotIcon />}
                onClick={() => setSmithOpen(true)}
                disabled={results.length === 0}
              >
                Smith chart
              </Button>
              <Button
                size="small" variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => downloadCsv(results, {
                  freqMhz, powerDbm, pathLossDb, mac: bleStatus?.address ?? null,
                })}
                disabled={results.length === 0}
              >
                Export
              </Button>
            </Stack>
          }
        >
          {results.length === 0 ? (
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              No data yet. Press Run.
            </Typography>
          ) : (
            <Box ref={resultsScrollRef} sx={{ maxHeight: 360, overflowY: 'auto' }}>
              <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '16%' }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Pos (mm)</TableCell>
                    <TableCell>Power (dBm)</TableCell>
                    <TableCell>CC (mA)</TableCell>
                    <TableCell>R (Ω)</TableCell>
                    <TableCell>J (Ω)</TableCell>
                    <TableCell>S11 (dB)</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell sx={monoSx}>{r.pos_mm.toFixed(2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.power_dbm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.r_ohm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.x_ohm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.s11_db, 2)}</TableCell>
                      <TableCell sx={TEXT.micro}>
                        {r.error
                          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
                          : <Box component="span" sx={{ color: 'success.main' }}>ok</Box>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>
      </PageBody>

      <SmithChartModal
        open={smithOpen}
        onClose={() => setSmithOpen(false)}
        results={results}
        freqMhz={freqMhz}
      />
      {preflight.dialog}
    </Box>
  )
}

const monoSx = { fontFamily: MONO }
