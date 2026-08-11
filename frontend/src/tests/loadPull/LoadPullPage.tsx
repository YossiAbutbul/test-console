import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, Divider, IconButton, MenuItem, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { motor } from '../../api/motor'
import { servo } from '../../api/servo'
import { vna, type VnaMarkerResult } from '../../api/networkAnalyzer'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { useInstrumentValue } from '../../context/InstrumentsContext'
import { useConnection } from '../../context/ConnectionContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { sleep } from '../../lib/async'
import { parseRangeSpec } from '../../lib/numericList'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { downloadBlob, exportName, toCsv } from '../../lib/download'
import { DASH, fmt, num } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, EmergencyStop, FieldGrid, MONO, PageBody, PathLossChip,
  RunControls, Section, StatRow, StatTile, StatusChip, TEXT, TwoCol,
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
import { parseLoadPullCsv } from './importCsv'
import { SetupDiagramModal } from './SetupDiagramModal'

const PULSES_PER_MM = 400

/** Every stage of a point touches one of these. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = [
  'power-sensor', 'dc-analyzer', 'network-analyzer', 'rf-switch', 'rf-trombone',
]

/** Budget for the motor travel, switching and measuring around the delays. */
const STEP_OVERHEAD_TIMEOUT_MS = 90_000

const blankRow = (pos: number, freqMhz: number, powerDbm: number): LoadPullResultRow => ({
  pos_pulses: pos,
  pos_mm: mm(pos),
  freq_mhz: freqMhz,
  power_dbm_setting: powerDbm,
  power_dbm: null,
  current_a: null,
  r_ohm: null,
  x_ohm: null,
  s11_db: null,
  error: null,
})

const mm = (p: number) => p / PULSES_PER_MM

/** One measurement: a trombone position, at a frequency, at a power. */
interface PlanPoint {
  pos: number
  freqMhz: number
  powerDbm: number
}

interface CsvMeta {
  /** The specs the run was planned from, e.g. "902.3,915" and "10-20:5". */
  freqSpec: string
  powerSpec: string
  pathLossDb: number
  mac: string | null
}

/** Export the sweep. The run's fixed parameters go in a leading comment line
 *  so a stray CSV is still self-describing. */
function downloadCsv(rows: LoadPullResultRow[], meta: CsvMeta): void {
  const header = [
    '#', 'pos_mm', 'pos_pulses', 'freq_mhz', 'set_power_dbm', 'power_dbm', 'cc_ma',
    'r_ohm', 'x_ohm', 's11_db', 'error',
  ]
  const body = rows.map((r, i) => [
    i + 1,
    num(r.pos_mm),
    r.pos_pulses,
    num(r.freq_mhz),
    num(r.power_dbm_setting),
    num(r.power_dbm),
    r.current_a == null ? '' : num(r.current_a * 1000),
    num(r.r_ohm),
    num(r.x_ohm),
    num(r.s11_db),
    r.error ?? '',
  ])
  // Specs rather than single values — the per-point frequency and power are
  // columns now, and this line records what the run was asked for.
  const preamble =
    `# freq_spec=${meta.freqSpec} power_spec=${meta.powerSpec} `
    + `path_loss_db=${meta.pathLossDb}\r\n`
  const blob = new Blob([preamble + toCsv(header, body)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, exportName('load-pull', meta.mac, 'csv', '-load-pull'))
}

const RESULT_ACTION_SX = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/** Fixed height for the results area, so the panel is the same size empty,
 *  mid-run and full. */
const RESULTS_H = 240

/** One height for every control in the drive column. Four kinds of control —
 *  buttons, a jog pad, a toggle group — at three different sizes read as
 *  unrelated widgets rather than one panel for one motor. */
const DRIVE_H = 32
const DRIVE_BTN_SX = {
  minWidth: 66, height: DRIVE_H, fontSize: 12.5, textTransform: 'none' as const,
}

/** Row label in the drive column, matching the bounds grid opposite it. */
function DriveLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {children}
    </Typography>
  )
}

interface RigRowProps {
  name: string
  connected: boolean
  /** Shown instead of the state once connected — the DUT's address, say. */
  detail?: string
}

/**
 * One line of the rig checklist.
 *
 * A row per instrument rather than a cloud of chips: the names line up, so the
 * eye runs down the dots instead of hunting a wrapped row, and there is space
 * to say what each state means without a tooltip.
 *
 * Every line reads the same way, because every one of these is needed. The
 * preflight will try to open whatever is down when the run starts, but that is
 * not worth saying here — a load pull with no trombone or no VNA has nothing
 * to measure, so "connects on run" promised a recovery that does not exist.
 */
function RigRow({ name, connected, detail }: RigRowProps) {
  const p = useAppPalette()
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, py: 0.3 }}>
      <Box
        sx={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          bgcolor: connected ? p.data.ok : p.data.warn,
        }}
      />
      <Typography
        sx={{
          fontSize: 12.5,
          fontWeight: connected ? 600 : 400,
          color: connected ? 'text.primary' : 'text.secondary',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Typography>
      <Box sx={{ flexGrow: 1, minWidth: 8 }} />
      <Typography
        sx={{
          fontSize: 11,
          fontFamily: connected && detail ? MONO : undefined,
          color: connected ? 'text.disabled' : p.data.warn,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {connected ? (detail ?? 'ready') : 'not connected'}
      </Typography>
    </Stack>
  )
}

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

interface BoundRowProps {
  label: string
  caption: string
  value: number | null
  onCapture: () => void
  onClear: () => void
  captureDisabled: boolean
  clearDisabled: boolean
}

/**
 * One end of the sweep, as three cells of the enclosing grid — label, button,
 * captured value — so it lines up with the other bounds and with Delta X
 * instead of being its own little block with its own spacing.
 */
function BoundRow({
  label, caption, value, onCapture, onClear, captureDisabled, clearDisabled,
}: BoundRowProps) {
  return (
    <>
      <Box>
        <Typography sx={{ ...TEXT.label, color: 'text.primary', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', whiteSpace: 'nowrap' }}>
          {caption}
        </Typography>
      </Box>
      <Button
        size="small"
        variant={value == null ? 'contained' : 'outlined'}
        color={value == null ? 'primary' : 'inherit'}
        onClick={onCapture}
        disabled={captureDisabled}
        sx={{ minWidth: 104, height: CONTROL_H.md }}
      >
        {value == null ? 'Capture' : 'Recapture'}
      </Button>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: MONO, fontSize: 12.5,
            color: value == null ? 'text.disabled' : 'text.primary',
            fontWeight: value == null ? 400 : 600,
          }}
        >
          {value == null ? 'not set' : `${(value / PULSES_PER_MM).toFixed(2)} mm`}
        </Typography>
        {value != null && (
          // Icon only — the row is already three columns wide and the word
          // "clear" competed with the captured value beside it. `span` wrapper
          // so the tooltip still fires while the button is disabled mid-run.
          <Tooltip title={`Clear ${label.toLowerCase()}`}>
            <span>
              <IconButton
                size="small"
                onClick={onClear}
                disabled={clearDisabled}
                aria-label={`Clear ${label.toLowerCase()}`}
                sx={{
                  p: 0.25,
                  color: 'text.disabled',
                  '&:hover': { color: 'error.main', bgcolor: 'transparent' },
                }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 16, display: 'block' }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    </>
  )
}

export function LoadPullPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const notify = useNotify()
  const reporter = useRunReporter('Load Pull', 'LoadPull')
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const hasBackend = protocol === 'LoRa'

  const ps = useInstrumentValue('power-sensor')
  const dc = useInstrumentValue('dc-analyzer')
  const na = useInstrumentValue('network-analyzer')
  const sw = useInstrumentValue('rf-switch')
  const tr = useInstrumentValue('rf-trombone')
  const dutConnected = !!bleStatus?.connected

  // Named, because a missing one now stops the run and the operator needs to
  // know which. Every stage of a point drives one of these, so "run anyway"
  // would only produce a table of blanks.
  const rig = [
    { name: 'power sensor', up: ps.status === 'connected' },
    { name: 'DC analyzer', up: dc.status === 'connected' },
    { name: 'VNA', up: na.status === 'connected' },
    { name: 'RF switch', up: sw.status === 'connected' },
    { name: 'trombone', up: tr.status === 'connected' },
  ]
  const missingRig = rig.filter((r) => !r.up).map((r) => r.name)
  const allReady = missingRig.length === 0 && dutConnected
  const missingCount = missingRig.length + (dutConnected ? 0 : 1)

  const [paMode, setPaMode] = useState<number>(() => loadPullPageSnapshot.paMode ?? 2)
  // Clamped on read: a snapshot saved before the floor existed can hold a value
  // below it, and restoring one would quietly reintroduce the bad readings.
  // Sweep specs. Seeded from the old single values so an existing snapshot
  // keeps working and reads the same on first load.
  const [freqSpec, setFreqSpec] = useState<string>(
    () => loadPullPageSnapshot.freqSpec ?? String(loadPullPageSnapshot.freqMhz ?? 902.3),
  )
  const [powerSpec, setPowerSpec] = useState<string>(
    () => loadPullPageSnapshot.powerSpec ?? String(loadPullPageSnapshot.powerDbm ?? 14),
  )
  const [settleMs, setSettleMs] = useState<number>(
    () => clampSettleMs(loadPullPageSnapshot.settleMs ?? DEFAULT_SETTLE_MS),
  )
  const [deltaXmm, setDeltaXmm] = useState<number>(() => loadPullPageSnapshot.deltaXmm ?? 1)
  const [jogSpeed, setJogSpeed] = useState<number>(() => loadPullPageSnapshot.jogSpeed ?? 800)
  const [zeroPulses, setZeroPulses] = useState<number | null>(() => loadPullPageSnapshot.zeroPulses ?? null)
  const [endPulses, setEndPulses] = useState<number | null>(() => loadPullPageSnapshot.endPulses ?? null)
  // Starts false every session on purpose: it asserts how the bench is
  // cabled *now*, which is the one precondition nothing here can verify.
  const [pathAck, setPathAck] = useState(false)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => loadPullPageSnapshot.results ?? [])
  const [smithOpen, setSmithOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => { loadPullPageSnapshot.paMode = paMode; persistLoadPullPage() }, [paMode])
  useEffect(() => { loadPullPageSnapshot.freqSpec = freqSpec; persistLoadPullPage() }, [freqSpec])
  useEffect(() => { loadPullPageSnapshot.powerSpec = powerSpec; persistLoadPullPage() }, [powerSpec])
  useEffect(() => { loadPullPageSnapshot.settleMs = settleMs; persistLoadPullPage() }, [settleMs])
  useEffect(() => { loadPullPageSnapshot.deltaXmm = deltaXmm; persistLoadPullPage() }, [deltaXmm])
  useEffect(() => { loadPullPageSnapshot.jogSpeed = jogSpeed; persistLoadPullPage() }, [jogSpeed])
  useEffect(() => { loadPullPageSnapshot.zeroPulses = zeroPulses; persistLoadPullPage() }, [zeroPulses])
  useEffect(() => { loadPullPageSnapshot.endPulses = endPulses; persistLoadPullPage() }, [endPulses])
  useEffect(() => { loadPullPageSnapshot.results = results; persistLoadPullPage() }, [results])

  // One frequency per run, so the correction is decided once.

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  // Replaced per run. Stop aborts it, which cancels in-flight requests and
  // wakes every settle delay immediately.
  const abortRef = useRef(new AbortController())
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  // Position the trombone is currently parked at, so the plan's remaining
  // points at that position skip the move. Reset per run, never read for
  // rendering — a ref rather than state.
  const posRef = useRef<number | null>(null)
  // VNA markers for the current position, keyed by requested frequency (Hz).
  const markersRef = useRef<Map<number, VnaMarkerResult>>(new Map())
  // Set while the table is showing a file rather than a run of this rig.
  // Cleared by Clear and by starting a run, so it can never outlive the
  // rows it describes.
  const [importedName, setImportedName] = useState<string | null>(null)
  const csvInput = useRef<HTMLInputElement | null>(null)

  const importCsv = async (file: File) => {
    try {
      const { rows, meta } = parseLoadPullCsv(await file.text())
      setResults(rows)
      setImportedName(file.name)
      // The preamble's frequency and path loss are reported, not applied:
      // silently rewriting the run's settings from a file would change what
      // the next Run does.
      const at = meta.freqMhz != null ? ` at ${meta.freqMhz} MHz` : ''
      const pl = meta.pathLossDb != null ? `, path loss ${meta.pathLossDb} dB` : ''
      log('LoadPull', `Imported ${rows.length} rows from ${file.name}${at}${pl}`)
    } catch (e) {
      const message = (e as Error).message
      log('LoadPull', `Import failed: ${message}`, 'error')
      notify.error(message, { title: 'Import' })
    }
  }

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

  // Plan: trombone positions (pulses) from zero -> end stepping by delta, and
  // at each one every (frequency, power) combination.
  //
  // Position-major on purpose. The trombone is the slow, mechanical axis, so
  // the plan is ordered to visit each position once and take everything there
  // before moving on; frequency and power are re-commanded electrically and
  // cost nothing by comparison.
  const deltaPulses = Math.max(1, Math.round(deltaXmm * PULSES_PER_MM))
  const positions = deltaXmm <= 0 ? [] : planPositions(zeroPulses, endPulses, deltaPulses)
  const freqs = parseRangeSpec(freqSpec).filter((f) => f > 0)
  const powers = parseRangeSpec(powerSpec)
  const plan: PlanPoint[] = []
  for (const pos of positions) {
    for (const f of freqs) for (const pw of powers) plan.push({ pos, freqMhz: f, powerDbm: pw })
  }
  const totalPoints = plan.length

  // The chip covers the whole plan: with several frequencies in a run, one
  // of them being uncalibrated is what the operator needs to know.
  const firstFreq = freqs[0] ?? null
  const loss = lossAt(firstFreq)
  const pathLossDb = loss.db
  const allCalibrated = freqs.length > 0 && freqs.every((f) => lossAt(f).calibrated)

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
  if (missingRig.length) blockers.push(`connect the ${missingRig.join(', ')}`)
  if (!pathAck) blockers.push('confirm the RF path')
  if (zeroPulses == null) blockers.push('capture the zero position')
  if (endPulses == null) blockers.push('capture the end position')
  if (deltaXmm <= 0) blockers.push('set Delta X above 0')
  if (freqs.length === 0) blockers.push('enter at least one frequency')
  if (powers.length === 0) blockers.push('enter at least one power')
  const canRun = blockers.length === 0 && !running

  // One plan point. The trombone moves only when the position changes, and the
  // VNA is read once per position for every frequency in the plan — both are
  // the expensive parts, and repeating them per (freq, power) combination would
  // multiply a run by the size of the electrical sweep for no new information.
  //
  // Never throws: failures are recorded on the returned row.
  const measurePoint = async (item: PlanPoint): Promise<LoadPullResultRow> => {
    const { signal } = abortRef.current
    const row = blankRow(item.pos, item.freqMhz, item.powerDbm)
    const freqHz = Math.round(item.freqMhz * 1_000_000)
    try {
      if (posRef.current !== item.pos) {
        // 1. trombone -> position (once per position)
        await motor.move(item.pos, true)
        await waitForMotorIdle()
        if (signal.aborted) return row

        // 2. switch -> VNA and read every frequency this position needs in one
        //    acquisition, keyed by the frequency that was asked for.
        await servo.goto('VNA')
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        const m = await vna.measure(freqs.map((f) => Math.round(f * 1_000_000)))
        markersRef.current = new Map(
          (m.markers ?? []).map((mk) => [Math.round(mk.requested_hz), mk]),
        )
        if ((m.markers?.length ?? 0) === 0) {
          // A measure that fails raises, so an empty marker list means the sweep
          // ran and returned nothing at the requested frequencies. The power and
          // current here are still valid, so this is not an error row.
          reporter.note(`no VNA markers at ${mm(item.pos).toFixed(2)} mm`, 'warn')
        }

        // 3. switch -> PCB, also once per position
        await servo.goto('PCB')
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        posRef.current = item.pos
      }

      const mk = markersRef.current.get(freqHz)
      if (mk) {
        row.r_ohm = mk.r_ohm
        row.x_ohm = mk.x_ohm
        row.s11_db = mk.s11_mag_db
      }

      // 4. TX on at this frequency and power
      const tx = await device.loraPower(
        { freq_hz: freqHz, power_dbm: item.powerDbm, pa_mode: paMode },
        { signal },
      )
      if (!tx.ok) {
        row.error = (row.error ? row.error + '; ' : '') + `tx status=${tx.status}`
      } else {
        await sleep(settleMs, signal)
        // 5. measure power + CC; correct with the loss for *this* frequency
        const meas = await instrumentsApi.measure(freqHz, { signal })
        const pl = lossAt(item.freqMhz)
        row.power_dbm = meas.power_dbm == null ? null : meas.power_dbm + pl.db
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
      setImportedName(null)
      setProgressIdx(0)
      posRef.current = null
      markersRef.current = new Map()
      // Per frequency now that a run sweeps several: named once each rather
      // than once per point, which would repeat the same line all run.
      const uncal = freqs.filter((f) => !lossAt(f).calibrated)
      if (uncal.length) {
        reporter.note(
          `path loss not calibrated at ${uncal.join(', ')} MHz - those points `
          + `use the default ${defaultDb} dB, and their measured power is only `
          + 'as good as that figure.',
          'warn',
        )
      }
      try {
        await runSequence<PlanPoint, LoadPullResultRow>({
          items: plan,
          abort,
          markRowError: (item, _i, message) => ({
            ...blankRow(item.pos, item.freqMhz, item.powerDbm), error: message,
          }),
          // A point moves the trombone and settles three times, so its budget
          // has to cover the motor travel as well as the delays.
          stepTimeoutMs: settleMs * 3 + STEP_OVERHEAD_TIMEOUT_MS,
          before: async () => {
            try { await vna.setMarkers(freqs.map((f) => Math.round(f * 1_000_000))) }
            catch (e) { reporter.note(`setMarkers failed: ${(e as Error).message}`, 'warn') }
          },
          measure: (item) => measurePoint(item),
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

  // Standing conditions go to the notice stack in the corner rather than into
  // the page: they used to displace the content they described, and the table
  // jumped whenever one appeared or cleared.
  useEffect(() => {
    notify.notice(
      'loadpull-blockers',
      'warning',
      !running && blockers.length > 0 ? blockers.join(' · ') : null,
      'Before running',
    )
  }, [notify, running, blockers.join('|')])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notify.notice(
      'loadpull-imported',
      'info',
      importedName ? `${importedName} — imported rows, not a run of this rig` : null,
      'Viewing a file',
    )
  }, [notify, importedName])

  const onStop = () => {
    abortRef.current.abort()
    void device.stop().catch(() => { /* ignore */ })
    void motor.stop().catch(() => { /* ignore */ })
  }

  // Emergency halt. Broader than Stop in two ways that matter: it works with no
  // run in progress (a jog moves the trombone outside a run, which is when a
  // runaway is most likely), and it clears the local jog state so the UI does
  // not keep believing the motor is still being jogged.
  //
  // `/motor/stop` alone halts both a move and a jog watcher, so it goes first
  // and is never gated on anything. Everything after it is best-effort: each
  // call is caught on its own so a failing DUT cannot swallow the motor halt.
  const onEmergencyStop = () => {
    void motor.stop().catch((e: Error) => {
      log('Motor', `emergency stop failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Emergency stop' })
    })
    abortRef.current.abort()
    stopJog()
    void device.stop().catch(() => { /* ignore */ })
    log('Motor', 'EMERGENCY STOP — run aborted, motor halted', 'error')
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
          >
            <EmergencyStop onStop={onEmergencyStop} />
          </RunControls>
        }
      />

      {/* What is still missing, by name. The run has several independent
          preconditions and they are spread down the page, so a disabled Run on
          its own left the operator hunting for which one it meant. */}
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
            hint="Every stage of a point uses one of these."
            action={
              <StepMark
                done={allReady}
                label={allReady ? 'all ready' : `${missingCount} not connected`}
              />
            }
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                columnGap: 2.5,
              }}
            >
              <RigRow name="Power sensor" connected={ps.status === 'connected'} />
              <RigRow name="DC analyzer" connected={dc.status === 'connected'} />
              <RigRow name="VNA" connected={na.status === 'connected'} />
              <RigRow name="Switch" connected={sw.status === 'connected'} />
              <RigRow name="Trombone" connected={tr.status === 'connected'} />
            </Box>

            {/* Apart from the rest because it is connected from the toolbar
                rather than the Instruments panel, so a missing one is fixed
                somewhere else. */}
            <Divider sx={{ my: 1 }} />
            <RigRow
              name="BLE DUT"
              connected={dutConnected}
              detail={bleStatus?.address ?? 'connected'}
            />
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
                {/* Next to the confirmation rather than in the header: this is
                    the picture of the thing being confirmed, and it is most
                    wanted by someone who is not sure whether to tick it. */}
                <Button
                  size="small"
                  variant="text"
                  startIcon={<AccountTreeOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={() => setSetupOpen(true)}
                  sx={{ height: CONTROL_H.md }}
                >
                  View setup
                </Button>
                <PathLossChip
                  pathLossDb={pathLossDb}
                  calibrated={allCalibrated}
                  freqMhz={firstFreq ?? undefined}
                />
              </Stack>
            </Stack>
          </Section>
        </TwoCol>

        <Section title="Test point" step={3} panel>
          <FieldGrid columns={4}>
            <LabeledField
              label="Frequency" hint="MHz" value={freqSpec}
              onChange={(e) => setFreqSpec(e.target.value)}
              disabled={running}
              error={freqSpec.trim() !== '' && freqs.length === 0}
              placeholder="e.g. 915 or 900-930"
            />
            <LabeledField
              label="DUT Power" hint="dBm" value={powerSpec}
              onChange={(e) => setPowerSpec(e.target.value)}
              disabled={running}
              error={powerSpec.trim() !== '' && powers.length === 0}
              placeholder="14"
            />
            <LabeledField
              label="PA Mode" select value={paMode}
              onChange={(e) => setPaMode(Number(e.target.value))}
              disabled={running}
            >
              <MenuItem value={2}>Auto</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={0}>Off</MenuItem>
            </LabeledField>
            <LabeledField
              label="Settle" hint={`ms · min ${MIN_SETTLE_MS}`} type="number" value={settleMs}
              onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
              onBlur={() => setSettleMs((v) => clampSettleMs(v))}
              disabled={running}
              inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
            />
          </FieldGrid>
          {/* The plan multiplies out fast — three positions of a 30-point
              trombone sweep across four powers is 360 points — so state the
              total next to the fields that decide it. */}
          <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 1 }}>
            Freq / Power: "915" · "900-930" · "900-930:5" · "902.3,915,927.5"
            {positions.length > 0 && freqs.length > 0 && powers.length > 0 && (
              <>
                {' — '}
                {positions.length} {positions.length === 1 ? 'position' : 'positions'}
                {' × '}{freqs.length} {freqs.length === 1 ? 'freq' : 'freqs'}
                {' × '}{powers.length} {powers.length === 1 ? 'power' : 'powers'}
                {' = '}<b>{totalPoints}</b> points
              </>
            )}
          </Typography>
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
              {/* Same label-and-control grid as the bounds on the right, so
                  the two halves of the step read alike. Loose rows of mixed
                  button sizes made four unrelated widgets out of what is one
                  set of controls for one motor. */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr)',
                  columnGap: 1.25,
                  rowGap: 1,
                  alignItems: 'center',
                }}
              >
                <DriveLabel>RF path</DriveLabel>
                <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                  {/* Parking on VNA is how the Smith chart is watched while
                      jogging, which is why it lives in this step. */}
                  <Button
                    size="small" variant="outlined"
                    onClick={() => switchM.mutate('VNA')}
                    disabled={!swConnected || switchM.isPending || running}
                    sx={DRIVE_BTN_SX}
                  >
                    VNA
                  </Button>
                  <Button
                    size="small" variant="outlined"
                    onClick={() => switchM.mutate('PCB')}
                    disabled={!swConnected || switchM.isPending || running}
                    sx={DRIVE_BTN_SX}
                  >
                    PCB
                  </Button>
                  {!swConnected && (
                    <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>
                      switch offline
                    </Typography>
                  )}
                </Stack>

                <DriveLabel>Jog</DriveLabel>
                {/* Press-and-hold — focus it, then hold the arrow keys to run
                    the motor; release to stop. Mouse press-hold works too. */}
                <Box
                  tabIndex={motorConnected && !running ? 0 : -1}
                  onKeyDown={onJogKeyDown}
                  onKeyUp={onJogKeyUp}
                  onFocus={() => setJogFocused(true)}
                  onBlur={() => { setJogFocused(false); stopJog() }}
                  sx={{
                    height: DRIVE_H, px: 0.5, width: 'fit-content',
                    display: 'flex', alignItems: 'center', gap: 0.25,
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
                    sx={{ p: 0.25, color: jogDir < 0 ? 'primary.main' : 'text.secondary' }}
                  >
                    <ArrowBackIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                  <Typography
                    sx={{
                      fontSize: 11.5, fontWeight: 600,
                      color: jogDir !== 0 ? 'warning.main' : (jogFocused ? 'primary.main' : 'text.secondary'),
                      whiteSpace: 'nowrap', minWidth: 78, textAlign: 'center',
                    }}
                  >
                    {jogDir !== 0 ? 'jogging' : jogFocused ? 'hold arrows' : 'click + hold'}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={!motorConnected || running}
                    onMouseDown={() => startJog(true)}
                    onMouseUp={stopJog}
                    onMouseLeave={stopJog}
                    sx={{ p: 0.25, color: jogDir > 0 ? 'primary.main' : 'text.secondary' }}
                  >
                    <ArrowForwardIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Box>

                <DriveLabel>Go to</DriveLabel>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Button
                    variant="outlined" size="small" startIcon={<FirstPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => goMinM.mutate()}
                    disabled={!motorConnected || motorJogBusy || running || travelMin == null}
                    title={travelMin == null ? 'Capture zero first' : undefined}
                    sx={DRIVE_BTN_SX}
                  >
                    Zero
                  </Button>
                  <Button
                    variant="outlined" size="small" endIcon={<LastPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => goMaxM.mutate()}
                    disabled={!motorConnected || motorJogBusy || running || travelMax == null}
                    title={travelMax == null ? 'Capture end first' : undefined}
                    sx={DRIVE_BTN_SX}
                  >
                    End
                  </Button>
                </Stack>

                <DriveLabel>Speed</DriveLabel>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={jogSpeed}
                  onChange={(_e, v) => { if (v != null) setJogSpeed(Number(v)) }}
                  disabled={!motorConnected || running}
                  sx={{
                    height: DRIVE_H, width: 'fit-content',
                    '& .MuiToggleButton-root': {
                      px: 1.5, fontSize: 12, textTransform: 'none', fontWeight: 500,
                    },
                  }}
                >
                  <ToggleButton value={400}>Slow</ToggleButton>
                  <ToggleButton value={800}>Medium</ToggleButton>
                  <ToggleButton value={1500}>Fast</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>

            <Box>
              <SubHead>Mark the sweep</SubHead>
              {/* Three inputs of the same kind, so one aligned grid — label,
                  control, result — rather than two rows with their own rhythms
                  and a value hanging off the side of the last one. */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto minmax(0, 1fr)',
                  columnGap: 1.25,
                  rowGap: 1,
                  alignItems: 'center',
                }}
              >
                <BoundRow
                  label="Zero"
                  caption="sweep start"
                  value={zeroPulses}
                  onCapture={() => setZeroPulses(motorPos)}
                  onClear={() => setZeroPulses(null)}
                  captureDisabled={motorPos == null || running}
                  clearDisabled={running}
                />
                <BoundRow
                  label="End"
                  caption="sweep finish"
                  value={endPulses}
                  onCapture={() => setEndPulses(motorPos)}
                  onClear={() => setEndPulses(null)}
                  captureDisabled={motorPos == null || running}
                  clearDisabled={running}
                />

                <Typography sx={{ ...TEXT.label, color: 'text.primary', whiteSpace: 'nowrap' }}>
                  Delta X
                </Typography>
                <TextField
                  size="small"
                  type="number"
                  value={deltaXmm}
                  onChange={(e) => setDeltaXmm(Math.max(0, Number(e.target.value) || 0))}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  inputProps={{ step: 0.1, min: 0 }}
                  disabled={running}
                  sx={{ width: 104, '& input': { fontFamily: MONO } }}
                />
                {/* The plan is what these three produce, so the effect of
                    changing one shows next to it and not only in the strip at
                    the top of the page. */}
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {totalPoints > 0
                    ? <>mm = <b>{totalPoints}</b> points over {fmt(Math.abs(mm((endPulses ?? 0) - (zeroPulses ?? 0))), 2)} mm</>
                    : 'mm - capture both ends to build the plan'}
                </Typography>
              </Box>
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
                onClick={() => { setResults([]); setImportedName(null) }}
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
                startIcon={<UploadFileIcon sx={{ fontSize: 15 }} />}
                onClick={() => csvInput.current?.click()}
                disabled={running}
                sx={RESULT_ACTION_SX}
              >
                Import
              </Button>
              <Button
                size="small" variant="text"
                startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
                onClick={() => downloadCsv(results, {
                  freqSpec, powerSpec, pathLossDb, mac: bleStatus?.address ?? null,
                })}
                disabled={results.length === 0}
                sx={RESULT_ACTION_SX}
              >
                Export
              </Button>
            </Stack>
          }
        >
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Reset first: re-picking the same file fires no change event
              // otherwise, so a second import would look ignored.
              e.target.value = ''
              if (f) void importCsv(f)
            }}
          />

          {/* One height, whatever is in it. `maxHeight` let the panel grow with
              the first rows and collapse again on Clear, so everything below —
              and the page's scroll position — moved on its own. */}
          {results.length === 0 ? (
            <Box
              sx={{
                height: RESULTS_H,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                No data yet. Press Run, or Import a previous CSV.
              </Typography>
            </Box>
          ) : (
            <Box
              ref={resultsScrollRef}
              sx={{
                height: RESULTS_H,
                // `scroll`, not `auto`: a scrollbar that appears with the ninth
                // row would resize the columns under the cursor.
                overflowY: 'scroll',
                // Only below this does the table stop being readable; above it
                // the percentages below make every column fit with no sideways
                // scroll at all.
                overflowX: 'auto',
              }}
            >
              <Table
                size="small"
                stickyHeader
                sx={{ tableLayout: 'fixed', width: '100%', minWidth: 780 }}
              >
                {/* One <col> per column — there were eight for ten columns after
                    Freq and Set were added, and under `table-layout: fixed` the
                    two with no width ran off the right-hand edge. */}
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <TableHead>
                  <TableRow sx={{ '& th': { whiteSpace: 'nowrap', fontSize: 12 } }}>
                    <TableCell>#</TableCell>
                    <TableCell>Pos (mm)</TableCell>
                    {/* A row is only identified by position, frequency and
                        power together now that a run sweeps all three. */}
                    <TableCell>Freq (MHz)</TableCell>
                    <TableCell>Set (dBm)</TableCell>
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
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.freq_mhz ?? null, 2)}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmt(r.power_dbm_setting ?? null, 0)}</TableCell>
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
      <SetupDiagramModal open={setupOpen} onClose={() => setSetupOpen(false)} />

      {preflight.dialog}
    </Box>
  )
}
