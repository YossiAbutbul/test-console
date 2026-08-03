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
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
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
import { DASH, fmt, num } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, FieldGrid, MONO, PageBody, PathLossChip, RunControls,
  Section, StatRow, StatTile, StatusChip, TEXT, TwoCol,
} from '../../ui'
import { useAppPalette } from '../../context/ThemeModeContext'
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

const RESULT_ACTION_SX = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/** Quiet divider label inside a step, one level below its heading. */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5,
        textTransform: 'uppercase', color: 'text.disabled', mb: 1,
      }}
    >
      {children}
    </Typography>
  )
}

/** Done / not-done marker for a step heading. */
function StepMark({ done, label }: { done: boolean; label: string }) {
  const p = useAppPalette()
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      {done
        ? <CheckCircleRoundedIcon sx={{ fontSize: 15, color: p.data.ok }} />
        : <RadioButtonUncheckedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />}
      <Typography
        sx={{ fontSize: 11.5, fontWeight: 600, color: done ? p.data.ok : 'text.disabled' }}
      >
        {label}
      </Typography>
    </Stack>
  )
}

interface CaptureFieldProps {
  label: string
  value: number | null
  onCapture: () => void
  onClear: () => void
  captureDisabled: boolean
  clearDisabled: boolean
}

/**
 * One end of the sweep: capture the position the trombone is standing at, or
 * clear it. Shows what was captured, because the plan is built from these two
 * and an empty one is the usual reason Run is unavailable.
 */
function CaptureField({
  label, value, onCapture, onClear, captureDisabled, clearDisabled,
}: CaptureFieldProps) {
  return (
    <Box>
      {/* Matches LabeledField's own label, so the three controls on this row
          read as one set rather than two different kinds of thing. */}
      <Typography sx={{ ...TEXT.label, color: 'text.primary', mb: 0.5, whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button
          size="small"
          variant={value == null ? 'contained' : 'outlined'}
          color={value == null ? 'primary' : 'inherit'}
          onClick={onCapture}
          disabled={captureDisabled}
          sx={{ minWidth: 78, height: CONTROL_H.md }}
        >
          {value == null ? 'Capture' : 'Recapture'}
        </Button>
        <Typography
          sx={{
            fontFamily: MONO, fontSize: 12.5, minWidth: 96,
            color: value == null ? 'text.disabled' : 'text.primary',
          }}
        >
          {value == null ? 'not set' : `${(value / PULSES_PER_MM).toFixed(2)} mm`}
        </Typography>
        {value != null && (
          <Button size="small" onClick={onClear} disabled={clearDisabled}
            sx={{ minWidth: 0, height: 24, fontSize: 11.5, px: 0.75 }}>
            clear
          </Button>
        )}
      </Stack>
    </Box>
  )
}

export function LoadPullPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const notify = useNotify()
  const reporter = useRunReporter('Load Pull', 'LoadPull')
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const { pathLossDb } = usePathLoss()
  const p = useAppPalette()
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
  // Starts false every session on purpose: it asserts how the bench is
  // cabled *now*, which is the one precondition nothing here can verify.
  const [pathAck, setPathAck] = useState(false)
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
  //
  // Each blocker is named rather than folded into one disabled button. Four
  // separate preconditions can hold the run, and a greyed Run said which one
  // about as well as saying nothing.
  const blockers: string[] = []
  if (!hasBackend) blockers.push(`${protocol} has no backend wired up`)
  if (!dutConnected) blockers.push('connect the DUT over BLE')
  if (!pathAck) blockers.push('confirm the RF path')
  if (zeroPulses == null) blockers.push('capture the zero position')
  if (endPulses == null) blockers.push('capture the end position')
  if (deltaXmm <= 0) blockers.push('set Delta X above 0')
  const canRun = blockers.length === 0 && !running

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
        // A measure that fails raises, so an empty marker list means the sweep
        // ran but returned nothing at the requested frequency. Leave R/X/S11
        // blank and note it — the power and current for this position are still
        // valid, so it is not an error row.
        reporter.note(`no VNA marker at ${mm(pos).toFixed(2)} mm`, 'warn')
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

      {/* What is still missing, by name. The run has several independent
          preconditions and they are spread down the page, so a disabled Run on
          its own left the operator hunting for which one it meant. */}
      {!running && blockers.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            mt: 0.5, px: 1.25, py: 0.75,
            border: 1, borderColor: 'divider', borderRadius: 1,
            bgcolor: p.data.highlight,
            alignItems: 'flex-start', flexShrink: 0,
          }}
        >
          <ErrorOutlineRoundedIcon sx={{ fontSize: 15, color: p.data.warn, mt: '2px', flexShrink: 0 }} />
          <Typography sx={{ fontSize: 12, color: 'text.primary' }}>
            <Box component="span" sx={{ fontWeight: 700 }}>Before running: </Box>
            {blockers.join(' · ')}
          </Typography>
        </Stack>
      )}

      <PageBody width="fluid" scroll>
        {/* Calibration state, which is what the run plan is built from. */}
        <StatRow>
          <StatTile
            label="Live position"
            value={motorPos == null ? DASH : mm(motorPos).toFixed(2)}
            unit={motorPos == null ? undefined : 'mm'}
            sub={motorPos == null
              ? (motorConnected ? 'waiting' : 'trombone offline')
              : `${motorPos.toLocaleString()} pulses`}
            off={!motorConnected}
          />
          <StatTile
            label="Zero"
            value={zeroPulses == null ? DASH : mm(zeroPulses).toFixed(2)}
            unit={zeroPulses == null ? undefined : 'mm'}
            sub={zeroPulses == null ? 'not captured' : 'sweep start'}
            off={zeroPulses == null}
          />
          <StatTile
            label="End"
            value={endPulses == null ? DASH : mm(endPulses).toFixed(2)}
            unit={endPulses == null ? undefined : 'mm'}
            sub={endPulses == null ? 'not captured' : 'sweep end'}
            off={endPulses == null}
          />
          <StatTile
            label="Plan"
            value={totalPoints === 0 ? DASH : String(totalPoints)}
            unit={totalPoints === 0 ? undefined : 'points'}
            sub={totalPoints === 0 ? 'incomplete' : `every ${deltaXmm} mm`}
            off={totalPoints === 0}
          />
        </StatRow>

        <TwoCol stretch>
          <Section
            title="Instruments"
            step={1}
            panel
            hint="Connected automatically when the run starts."
            action={<StepMark done={allReady} label={allReady ? 'all ready' : 'will connect on run'} />}
          >
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusChip label="Power sensor" tone={ps.status === 'connected' ? 'ok' : 'off'} />
              <StatusChip label="DC analyzer" tone={dc.status === 'connected' ? 'ok' : 'off'} />
              <StatusChip label="VNA" tone={na.status === 'connected' ? 'ok' : 'off'} />
              <StatusChip label="Switch" tone={sw.status === 'connected' ? 'ok' : 'off'} />
              <StatusChip label="Trombone" tone={tr.status === 'connected' ? 'ok' : 'off'} />
              <StatusChip
                label="BLE DUT"
                tone={dutConnected ? 'ok' : 'off'}
                detail={bleStatus?.address ?? undefined}
              />
            </Stack>
          </Section>

          <Section
            title="RF path"
            step={2}
            panel
            hint="Re-confirmed each session — this is the one thing the app cannot check."
            action={<StepMark done={pathAck} label={pathAck ? 'verified' : 'not verified'} />}
          >
            <Stack spacing={1.25}>
              <Typography sx={{ ...TEXT.hint, color: pathAck ? 'text.secondary' : 'warning.main' }}>
                Check the cabling: <b>DUT to switch to coupler to power sensor</b>.
              </Typography>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant={pathAck ? 'outlined' : 'contained'}
                  color={pathAck ? 'inherit' : 'primary'}
                  onClick={() => setPathAck(!pathAck)}
                  disabled={running}
                  sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
                >
                  {pathAck ? 'Unconfirm' : 'Confirm path'}
                </Button>
                <PathLossChip pathLossDb={pathLossDb} />
              </Stack>
            </Stack>
          </Section>
        </TwoCol>

        <Section title="Test point" step={3} panel>
          <FieldGrid columns={4}>
            <LabeledField
              label="Frequency" hint="MHz" type="number" value={freqMhz}
              historyKey="loadPull.freqMhz"
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }}
            />
            <LabeledField
              label="DUT Power" hint="dBm" type="number" value={powerDbm}
              historyKey="loadPull.powerDbm"
              onChange={(e) => setPowerDbm(Number(e.target.value))}
            />
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
              historyKey="loadPull.settleMs"
              onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
            />
          </FieldGrid>
        </Section>

        <Section
          title="Trombone calibration"
          step={4}
          panel
          hint={`Jog to each end of the Smith chart cycle and capture it. ${PULSES_PER_MM} pulses/mm.`}
          action={
            <Stack direction="row" alignItems="center" spacing={1}>
              <StatusChip
                label={motorConnected ? (motorMoving ? 'Moving' : 'Idle') : 'Trombone offline'}
                tone={motorConnected ? (motorMoving ? 'busy' : 'ok') : 'off'}
                spinning={motorConnected && motorMoving}
              />
              <StepMark
                done={totalPoints > 0}
                label={totalPoints > 0 ? `${totalPoints} points planned` : 'no plan yet'}
              />
            </Stack>
          }
        >
          {/* The step does two separable things — drive the carriage, then mark
              where the sweep starts and ends — so they sit side by side instead
              of as three rows that read as one undifferentiated pile. */}
          <TwoCol stretch minCol={280}>
            <Box>
              <SubHead>Drive the trombone</SubHead>

              {/* Parking the switch on VNA is how you watch the Smith chart
                  while jogging, so it belongs with the jog controls. */}
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>Route RF to</Typography>
                <Button
                  size="small" variant="outlined"
                  onClick={() => switchM.mutate('VNA')}
                  disabled={!swConnected || switchM.isPending || running}
                  sx={{ minWidth: 66, height: 26 }}
                >
                  VNA
                </Button>
                <Button
                  size="small" variant="outlined"
                  onClick={() => switchM.mutate('PCB')}
                  disabled={!swConnected || switchM.isPending || running}
                  sx={{ minWidth: 66, height: 26 }}
                >
                  PCB
                </Button>
                {!swConnected && (
                  <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>
                    switch offline
                  </Typography>
                )}
              </Stack>

          {/* flex-end, not center: Jog speed carries a label above its input,
              so centring sat the buttons halfway up it. Aligning the bottoms
              puts every control on one line. */}
          <Stack direction="row" spacing={1} alignItems="flex-end" useFlexGap flexWrap="wrap">
            <Button
              variant="outlined" startIcon={<FirstPageIcon />}
              onClick={() => goMinM.mutate()}
              disabled={!motorConnected || motorJogBusy || running || travelMin == null}
              title={travelMin == null ? 'Capture zero first' : undefined}
              sx={{ minWidth: 88, height: CONTROL_H.md }}
            >
              Min
            </Button>

            {/* Press-and-hold jog pad — focus it, then hold the arrow keys to
                run the motor; release to stop. Mouse press-hold works too. */}
            <Box
              tabIndex={motorConnected && !running ? 0 : -1}
              onKeyDown={onJogKeyDown}
              onKeyUp={onJogKeyUp}
              onFocus={() => setJogFocused(true)}
              onBlur={() => { setJogFocused(false); stopJog() }}
              sx={{
                height: CONTROL_H.md, px: 1,
                display: 'flex', alignItems: 'center', gap: 0.5,
                border: 1, borderColor: jogFocused ? 'primary.main' : 'divider',
                borderRadius: 1,
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
                <ArrowBackIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: jogDir !== 0 ? 'warning.main' : (jogFocused ? 'primary.main' : 'text.secondary'), whiteSpace: 'nowrap', minWidth: 78, textAlign: 'center' }}>
                {jogDir !== 0 ? 'jogging' : jogFocused ? 'hold arrows' : 'click + hold'}
              </Typography>
              <IconButton
                size="small"
                disabled={!motorConnected || running}
                onMouseDown={() => startJog(true)}
                onMouseUp={stopJog}
                onMouseLeave={stopJog}
                sx={{ color: jogDir > 0 ? 'primary.main' : 'text.secondary' }}
              >
                <ArrowForwardIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            <Button
              variant="outlined" endIcon={<LastPageIcon />}
              onClick={() => goMaxM.mutate()}
              disabled={!motorConnected || motorJogBusy || running || travelMax == null}
              title={travelMax == null ? 'Capture end first' : undefined}
              sx={{ minWidth: 88, height: CONTROL_H.md }}
            >
              Max
            </Button>

            <LabeledField
              label="Jog speed" select value={jogSpeed}
              width={124}
              onChange={(e) => setJogSpeed(Number(e.target.value))}
            >
              <MenuItem value={400}>Slow</MenuItem>
              <MenuItem value={800}>Medium</MenuItem>
              <MenuItem value={1500}>Fast</MenuItem>
            </LabeledField>
          </Stack>
            </Box>

            <Box>
              <SubHead>Mark the sweep</SubHead>
              <Stack direction="row" spacing={1} alignItems="flex-end" useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                <CaptureField
                  label="Zero — start"
                  value={zeroPulses}
                  onCapture={() => setZeroPulses(motorPos)}
                  onClear={() => setZeroPulses(null)}
                  captureDisabled={motorPos == null || running}
                  clearDisabled={running}
                />
                <CaptureField
                  label="End — finish"
                  value={endPulses}
                  onCapture={() => setEndPulses(motorPos)}
                  onClear={() => setEndPulses(null)}
                  captureDisabled={motorPos == null || running}
                  clearDisabled={running}
                />
              </Stack>

              <Stack direction="row" spacing={1.25} alignItems="flex-end" useFlexGap flexWrap="wrap">
                <LabeledField
                  label="Delta X" hint="mm"
                  type="number" value={deltaXmm}
                  historyKey="loadPull.deltaXmm"
                  onChange={(e) => setDeltaXmm(Math.max(0, Number(e.target.value) || 0))}
                  inputProps={{ step: 0.1, min: 0 }}
                  width={112}
                />
                {/* The plan is what these three inputs produce, so the result of
                    changing one belongs next to them rather than only in the
                    strip at the top of the page. */}
                <Typography sx={{ fontSize: 12, color: 'text.secondary', pb: 1 }}>
                  {totalPoints > 0
                    ? <>= <b>{totalPoints}</b> points across {fmt(Math.abs(mm((endPulses ?? 0) - (zeroPulses ?? 0))), 2)} mm</>
                    : 'capture both ends to build the plan'}
                </Typography>
              </Stack>
            </Box>
          </TwoCol>
        </Section>

        <Section
          title="Results"
          step={5}
          panel
          action={
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mr: 0.5 }}>
                power = sensor + path loss ({pathLossDb} dB)
              </Typography>
              <Button
                size="small" variant="text" color="inherit"
                startIcon={<DeleteSweepIcon sx={{ fontSize: 15 }} />}
                onClick={() => setResults([])}
                disabled={results.length === 0 || running}
                sx={RESULT_ACTION_SX}
              >
                Clear
              </Button>
              <Button
                size="small" variant="text"
                startIcon={<ScatterPlotIcon sx={{ fontSize: 15 }} />}
                onClick={() => setSmithOpen(true)}
                disabled={results.length === 0}
                sx={RESULT_ACTION_SX}
              >
                Smith chart
              </Button>
              <Button
                size="small" variant="text"
                startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
                onClick={() => downloadCsv(results, {
                  freqMhz, powerDbm, pathLossDb, mac: bleStatus?.address ?? null,
                })}
                disabled={results.length === 0}
                sx={RESULT_ACTION_SX}
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
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.pos_mm, 2)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.power_dbm, 2)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.r_ohm, 2)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.x_ohm, 2)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.s11_db, 2)}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>
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
      />
      {preflight.dialog}
    </Box>
  )
}
