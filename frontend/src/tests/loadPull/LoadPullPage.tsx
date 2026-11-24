import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  powerInstrument, powerSourceOf, powerSourceValid, spectrumSettingsOf, type PowerSourceState,
} from '../../lib/powerSource'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, Divider, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import FirstPageIcon from '@mui/icons-material/FirstPageRounded'
import LastPageIcon from '@mui/icons-material/LastPageRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import UploadFileIcon from '@mui/icons-material/UploadFileRounded'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlotRounded'
import PlayArrowIcon from '@mui/icons-material/PlayArrowRounded'
// A block-and-wire diagram, which is what the setup picture is.
import SchemaIcon from '@mui/icons-material/SchemaRounded'
import { useMutation } from '@tanstack/react-query'
import { alpha } from '@mui/material/styles'
import { PageHeader } from '../../components/PageHeader'
import { BenchCourse } from '../../components/BenchCourse'
import type { CourseStep } from '../../components/courseSteps'
import { motor } from '../../api/motor'
import { servo } from '../../api/servo'
import { device } from '../../api/device'
import { vna } from '../../api/networkAnalyzer'
import { useInstrumentValue } from '../../context/InstrumentsContext'
import { useConnection } from '../../context/ConnectionContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { formatDuration } from '../../lib/async'
import { estimateRunMs } from '../../lib/eta'
import { TopProgress } from '../../components/TopProgress'
import { usePublishLiveOutput } from '../../context/liveOutput'
import { formatRunTiming, useRunEta } from '../../ui/useRunEta'
import { parseRangeSpec } from '../../lib/numericList'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { saveBlob } from '../../lib/download'
import { fmt, num } from '../../lib/format'
import { vswr } from './smith'
import {
  ACTION_W, CONTROL_H, EmergencyStop, MONO, PageBody,
  RunControls, Section, StatusChip, TEXT, TwoCol,
  HazardGlyph, hazardRingSx,
  GRID_GAP, JogPad, CheckMark, KeySpinner, MiniAction, SegmentedChoice, type CheckState,
} from '../../ui'
import { useAppPalette } from '../../context/ThemeModeContext'
import type { TestPageProps } from '../types'
import {
  flushLoadPullPage, loadPullPageSnapshot, lteLoadPullPageStore, persistLoadPullPage,
  type LoadPullPageSnapshot, type LoadPullResultRow,
} from '../../store/loadPullPageStore'
import { STORAGE_KEYS } from '../../store/keys'
import { BandsModal } from '../lte/BandsModal'
import { ModemBootDialog } from '../lte/ModemBootDialog'
import { useLteBands, useLteChannelUnit } from '../lte/channel'
import { channelIssues, describeChannelIssues, uplinkFromEarfcn, uplinkFromMhz } from '../../lib/earfcn'
import { SmithChartModal } from './SmithChartModal'
import { TestPointSection } from './TestPointSection'
import { ATT_MAX_LIMIT_DB, legacyAttSpec, parseAttSpec } from './attSpec'
import { REMEASURE_KEY, VNA_HALF_SPAN_FRAC, useLoadPullRun, type RunTimes } from './useLoadPullRun'
import { useSnapshotState } from '../../store/useSnapshotState'
import { RemeasureDialog } from './RemeasureDialog'
import { LoadPullResultsTable } from './ResultsTable'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { findRange, isComplete, planTrombone, rangeAt, type FreqRange } from './tromboneRanges'
import { TromboneRangesModal } from './TromboneRangesModal'
import { useTromboneJog } from './useTromboneJog'
import { loadPullApi } from '../../api/loadPull'
import { useChatSource } from '../../context/ChatContext'
import { mA } from '../../lib/chatRows'
import { parseLoadPullCsv } from './importCsv'
import { SetupDiagramModal } from './SetupDiagramModal'
// Shared with the Trombone page so both agree on what a mm is.
import { JOG_SPEEDS, PULSES_PER_MM } from '../../lib/trombone'
import { selectOnFocus } from '../../lib/selectOnFocus'
import { NumberField } from '../../ui/NumberField'

/** Every stage of a point touches one of these. */
/** Beside the one that reads power, which the page's power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = [
  'dc-analyzer', 'network-analyzer', 'rf-switch', 'rf-trombone',
]

/**
 * Rough costs for the pre-run estimate, on top of the settle delays.
 *
 * Per position: the trombone move, two switch moves and the VNA reads.
 * Per point: the TX command, the power/current read and TX off. Guesses, not
 * measurements -- once the run is going the remaining time follows the
 * measured rate. Operator waits at attenuator steps are not in either.
 */
const EST_POSITION_OVERHEAD_MS = 6000
const EST_POINT_OVERHEAD_MS = 500

/**
 * Browser storage a run's saved rows may use, in characters.
 *
 * Rows are saved as they are taken so Continue can resume after a crash, and
 * that storage is ~5 MB per origin in Chrome, shared by every page. Past it a
 * save fails silently and the rows after it would be lost to Continue, so a
 * plan that cannot fit is refused instead. Held well under the limit.
 */
const STORAGE_BUDGET_CHARS = 4_000_000
/** One saved row, generously: 284 characters measured, ~340 with an error. */
const ROW_CHARS = 350

/** The span and marker the run reads `freqMhz` on, in Hz, rounded as the
 *  backend rounds them (`_hz`, then `round(hz * vna_half_span_frac)`). */
function vnaSpanHz(freqMhz: number) {
  const hz = Math.round(freqMhz * 1e6)
  const half = Math.round(hz * VNA_HALF_SPAN_FRAC)
  return { hz, startHz: hz - half, stopHz: hz + half }
}

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const LTE_MAX_POWER_DBM = 23
/** The modem power-cycle at the start of an LTE run, for the estimate. */
const LTE_MODEM_RESTART_MS = 10_000

const mm = (p: number) => p / PULSES_PER_MM

/** One measurement: a trombone position, at a frequency, at a power — and, if
 *  the run sweeps it, at an attenuator setting. */
interface PlanPoint {
  pos: number
  freqMhz: number
  /** LTE only: the channel sent to the modem; `freqMhz` is its uplink. */
  earfcn?: number
  powerDbm: number
  /** Null when the run is not sweeping attenuation. */
  attDb: number | null
}

/** One height for every control in the drive column. Four kinds of control —
 *  buttons, a jog pad, a toggle group — at three different sizes read as
 *  unrelated widgets rather than one panel for one motor. */
const DRIVE_H = 32


/** Write fields to this radio's page snapshot and schedule the save. */
function saveSnapshot(isLte: boolean, patch: Partial<LoadPullPageSnapshot>, now = false) {
  if (isLte) {
    Object.assign(lteLoadPullPageStore.snapshot, patch)
    if (now) lteLoadPullPageStore.flush()
    else lteLoadPullPageStore.persist()
  } else {
    Object.assign(loadPullPageSnapshot, patch)
    if (now) flushLoadPullPage()
    else persistLoadPullPage()
  }
}

/** Whether a saved row is the plan point it should be -- Continue's sanity
 *  check on top of the plan key. */
function rowIsPoint(r: LoadPullResultRow | undefined, p: PlanPoint | undefined): boolean {
  return !!r && !!p && r.pos_pulses === p.pos && r.freq_mhz === p.freqMhz
    && r.power_dbm_setting === p.powerDbm && (r.att_db ?? null) === p.attDb
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
function RigRow({ name, connected }: RigRowProps) {
  const p = useAppPalette()
  // One step of the connection checklist: a mark and the name, in a pill.
  // Ready is quiet (a grey pill with a tick); missing is the one thing in the
  // card with colour, so the eye lands on what is left to do. No "ready" /
  // "not connected" words: the mark and the tint say it, and the card stays
  // two short rows instead of a column of label-and-status lines.
  return (
    <Box
      role="listitem"
      aria-label={`${name}: ${connected ? 'connected' : 'not connected'}`}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75,
        height: CONTROL_H.sm, pl: 0.75, pr: 1.25, borderRadius: '7px',
        bgcolor: connected ? alpha(p.sidebar.textDim, 0.1) : alpha(p.data.warn, 0.12),
        color: connected ? 'text.primary' : p.data.warn,
        fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
      }}
    >
      <CheckMark state={connected ? 'ok' : 'block'} size={16} />
      {name}
    </Box>
  )
}

/** Step state for a section heading: the course's own mark, with the word
 *  beside it so the shape is never the only carrier. */
function StepMark({ state, label }: { state: CheckState; label: string }) {
  const p = useAppPalette()
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <CheckMark state={state} size={16} />
      <Typography
        sx={{ ...TEXT.dense, color: state === 'ok' ? p.data.ok : 'text.secondary', whiteSpace: 'nowrap' }}
      >
        {label}
      </Typography>
    </Stack>
  )
}

/** Every control in the trombone cards fills the control column, so the pad,
 *  the speed choice, the key pairs and the Delta X field end on one edge --
 *  the card's own padding. They were capped at 232 px, which in a wide card
 *  left a band of empty card to the right of every control. */
const CONTROL_COL_SX = { width: '100%' } as const

/** Narrowest a trombone card gets before the three stack into one column. */
const TROMBONE_CARD_MIN = 280

/**
 * The three trombone cards side by side, matched in height, stacking once the
 * *container* (not the window) is too narrow for three -- the same rule
 * TwoCol uses, so opening the inspector behaves like a narrower window.
 */
const TROMBONE_ROW_SX = {
  display: 'grid',
  gap: `${GRID_GAP}px`,
  gridTemplateColumns: '1fr',
  [`@container (min-width:${TROMBONE_CARD_MIN * 3 + GRID_GAP * 2}px)`]: {
    gridTemplateColumns: `repeat(3, minmax(${TROMBONE_CARD_MIN}px, 1fr))`,
  },
  alignItems: 'stretch',
} as const

/**
 * The trombone cards' form: a fixed label column, then a control column,
 * every row the control height. Labels and controls line up row to row and
 * card to card.
 */
const FORM_SX = {
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 1fr)',
  gridAutoRows: `${DRIVE_H}px`,
  columnGap: 1.5,
  rowGap: 1,
  alignItems: 'center',
} as const

/** Two keys sharing the control column's width in equal halves. */
const PAIR_SX = {
  ...CONTROL_COL_SX,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 1,
} as const

/**
 * The Load Pull test, for either radio.
 *
 * One page rather than a copy per protocol: the trombone, switch, VNA and
 * measurement are the rig, and only the TX step differs -- a LoRa power
 * command and stop, or an LTE CW START and ABORT on a modem the run brings up
 * first. Each protocol keeps its own snapshot, since both pages stay mounted.
 */
export function LoadPullPage({ protocol, group, active }: TestPageProps) {
  const isLte = protocol === 'LTE'
  // Registry id, for the run pill and the modem's TX pill to navigate back to.
  const pageId = isLte ? 'lte-load-pull' : 'load-pull'
  // Prefix for the course's scroll targets. Both pages are mounted at once,
  // so a shared DOM id would scroll whichever came first -- the hidden one.
  const anchor = (id: string) => `${isLte ? 'llp' : 'lp'}-${id}`
  const snap = isLte ? lteLoadPullPageStore.snapshot : loadPullPageSnapshot
  const title = isLte ? 'LTE Load Pull' : 'Load Pull'
  const { log } = useLog()
  const notify = useNotify()
  const reporter = useRunReporter(title, 'LoadPull')
  // What reads power: the sensor, or the spectrum analyzer at this page's
  // own settings (lib/powerSource.ts). The backend runner reads it.
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => powerSourceOf(snap.powerSource),
    (powerSource) => saveSnapshot(isLte, { powerSource }),
  )
  const powerFields = powerSrc.source === 'spectrum'
    ? { power_source: 'spectrum' as const, spectrum: spectrumSettingsOf(powerSrc) ?? undefined }
    : {}
  const preflight = useInstrumentPreflight([powerInstrument(powerSrc), ...REQUIRED_INSTRUMENTS])
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const hasBackend = protocol === 'LoRa' || isLte
  const [channelUnit, setChannelUnit] = useLteChannelUnit()
  const [lteBands, setLteBands] = useLteBands()
  const [bandsOpen, setBandsOpen] = useState(false)

  const ps = useInstrumentValue(powerInstrument(powerSrc))
  const dc = useInstrumentValue('dc-analyzer')
  const na = useInstrumentValue('network-analyzer')
  const sw = useInstrumentValue('rf-switch')
  const tr = useInstrumentValue('rf-trombone')
  const dutConnected = !!bleStatus?.connected

  // Named, because a missing one now stops the run and the operator needs to
  // know which. Every stage of a point drives one of these, so "run anyway"
  // would only produce a table of blanks.
  const rig = [
    { name: powerSrc.source === 'spectrum' ? 'spectrum analyzer' : 'power sensor', up: ps.status === 'connected' },
    { name: 'DC analyzer', up: dc.status === 'connected' },
    { name: 'VNA', up: na.status === 'connected' },
    { name: 'RF switch', up: sw.status === 'connected' },
    { name: 'trombone', up: tr.status === 'connected' },
  ]
  const missingRig = rig.filter((r) => !r.up).map((r) => r.name)
  const allReady = missingRig.length === 0 && dutConnected
  const missingCount = missingRig.length + (dutConnected ? 0 : 1)

  const [paMode, setPaMode] = useSnapshotState<number>(
    () => snap.paMode ?? 2,
    (paMode) => saveSnapshot(isLte, { paMode }),
  )
  // Clamped on read: a snapshot saved before the floor existed can hold a value
  // below it, and restoring one would quietly reintroduce the bad readings.
  // Sweep specs. Seeded from the old single values so an existing snapshot
  // keeps working and reads the same on first load.
  // LTE seeds a band 2 channel, in the unit the LTE pages are reading in, and
  // the modem's full power -- the LTE CW sweep's defaults.
  const [freqSpec, setFreqSpec] = useSnapshotState<string>(
    () => snap.freqSpec ?? (isLte
      ? (channelUnit === 'earfcn' ? '18900' : '1880')
      : String(snap.freqMhz ?? 902.3)),
    (freqSpec) => saveSnapshot(isLte, { freqSpec }),
  )
  const [powerSpec, setPowerSpec] = useSnapshotState<string>(
    () => snap.powerSpec ?? String(snap.powerDbm ?? (isLte ? LTE_MAX_POWER_DBM : 14)),
    (powerSpec) => saveSnapshot(isLte, { powerSpec }),
  )
  const [attEnabled, setAttEnabled] = useSnapshotState<boolean>(
    () => snap.attEnabled ?? false,
    (attEnabled) => saveSnapshot(isLte, { attEnabled }),
  )
  // One spec, as Frequency and DUT power take, so a sweep can be a range,
  // a stepped range or any list of settings ("0-5, 8, 9, 20").
  const [attSpec, setAttSpec] = useSnapshotState<string>(
    () => snap.attSpec ?? legacyAttSpec(snap),
    (attSpec) => saveSnapshot(isLte, { attSpec }),
  )
  const attValues = parseAttSpec(attSpec)
  /** Every setting a whole dB in range -- what a sweep needs. */
  const attRangeOk = attValues != null

  // Held as text: bound to a number, the field cannot be emptied — a blank
  // parses to 0 and 0 is written straight back.
  const [settleText, setSettleText] = useState<string>(
    () => String(clampSettleMs(snap.settleMs ?? DEFAULT_SETTLE_MS)),
  )
  /** The typed settle, or null while the field is empty or below the floor. */
  const settleMs: number | null = (() => {
    const t = settleText.trim()
    if (t === '') return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < MIN_SETTLE_MS) return null
    return Math.round(n)
  })()
  /** What the run and its timeouts actually use. The blocker below stops a run
   *  while `settleMs` is null, so the fallback never reaches the hardware. */
  const settleEffectiveMs = settleMs ?? DEFAULT_SETTLE_MS
  const [deltaXmm, setDeltaXmm] = useSnapshotState<number>(
    () => snap.deltaXmm ?? 1, (deltaXmm) => saveSnapshot(isLte, { deltaXmm }),
  )
  const [jogSpeed, setJogSpeed] = useSnapshotState<number>(
    () => snap.jogSpeed ?? 800, (jogSpeed) => saveSnapshot(isLte, { jogSpeed }),
  )
  const [zeroPulses, setZeroPulses] = useSnapshotState<number | null>(
    () => snap.zeroPulses ?? null, (zeroPulses) => saveSnapshot(isLte, { zeroPulses }),
  )
  const [endPulses, setEndPulses] = useSnapshotState<number | null>(
    () => snap.endPulses ?? null, (endPulses) => saveSnapshot(isLte, { endPulses }),
  )
  const [freqRanges, setFreqRanges] = useSnapshotState<FreqRange[]>(
    () => snap.freqRanges ?? [], (freqRanges) => saveSnapshot(isLte, { freqRanges }),
  )
  const [rangesOpen, setRangesOpen] = useState(false)
  // Starts false every session on purpose: it asserts how the bench is
  // cabled *now*, which is the one precondition nothing here can verify.
  const [pathAck, setPathAck] = useState(false)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => snap.results ?? [])
  // The plan the rows in `results` belong to, or null for none (cleared,
  // imported). See `planKey`.
  // Saved at once rather than on the debounce.
  const [runKey, setRunKey] = useSnapshotState<string | null>(
    () => snap.runKey ?? null, (runKey) => saveSnapshot(isLte, { runKey }, true),
  )
  // Rows a continued run started with; 0 for a fresh one. For the ETA.
  const [resumeBase, setResumeBase] = useState(0)
  const [smithOpen, setSmithOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  /** The frequency last put on the VNA from this page, for the range dialog's
   *  rows. Not read back from the analyzer: someone may have changed it since. */
  const [vnaShownMhz, setVnaShownMhz] = useState<number | null>(null)

  // Read live rather than from the snapshot: a Load Pull run is driven from
  // this page, so a question asked mid-run should see the rows already taken.
  /** What the Frequency field's values are, as written beside it. */
  const freqUnit = isLte && channelUnit === 'earfcn' ? 'EARFCN' : 'MHz'
  useChatSource(title, !!active, () => ({
    title: isLte
      ? `LTE Load Pull results (channel ${freqSpec || '?'} ${freqUnit}, power ${powerSpec || '?'} dBm, CW)`
      : `Load Pull results (freq ${freqSpec || '?'} MHz, power ${powerSpec || '?'} dBm, PA mode ${paMode})`,
    // The table's own columns, in the table's own units. CC is milliamps on
    // screen and amps on the row, and VSWR is not on the row at all: it is
    // derived from S11 here exactly as the table derives it.
    rows: results.map((r, i) => ({
      '#': i + 1,
      'Pos (mm)': r.pos_mm,
      'Freq (MHz)': r.freq_mhz ?? null,
      ...(isLte ? { EARFCN: r.earfcn ?? null } : {}),
      'Set (dBm)': r.power_dbm_setting ?? null,
      'Att (dB)': r.att_db ?? null,
      'Power (dBm)': r.power_dbm,
      'CC (mA)': mA(r.current_a),
      'R (Ohm)': r.r_ohm,
      'X (Ohm)': r.x_ohm,
      'S11 (dB)': r.s11_db,
      VSWR: vswr(r),
      Status: r.error ?? 'ok',
    })),
  }))

  useEffect(() => {
    if (settleMs != null) { saveSnapshot(isLte, { settleMs }) }
  }, [settleMs, isLte])

  // One frequency per run, so the correction is decided once.

  // Epoch seconds of the run the table holds, for the workbook's Run sheet.
  // Cleared on import and Clear, so a file's rows are never stamped with the
  // timing of whatever run happened to precede them.
  const runTimesRef = useRef<RunTimes>(null)
  // The backend run and everything that follows it: see useLoadPullRun.
  const {
    radio, runStatus, setRunStatus, mine, running, otherRunning, attPrompt, adoptRun,
    remeasureIdx, setRemeasureIdx, remeasureFresh, remeasureErr, remeasureRow,
    remeasuring, remeasureBlocked, remeasureM, openRemeasure, takeRemeasured,
  } = useLoadPullRun({
    isLte, active, results, setResults, runKey, runTimesRef, log, reporter,
    dutConnected, pathAck, settleMs, settleEffectiveMs, paMode, preflight, lossAt, powerFields,
  })
  // Written at once during a run rather than on the debounce, so a tab that
  // crashes or freezes mid-run has every finished row saved for Continue: a
  // frozen page never fires the timer the debounced write waits on.
  useEffect(() => { saveSnapshot(isLte, { results }, running) }, [results, isLte, running])
  // The point in hand, 1-based, as the run controls show it.
  const progressIdx = mine ? mine.completed + (running ? 1 : 0) : 0
  // Replaced per run. Stop aborts it, which cancels in-flight requests and
  // wakes every settle delay immediately.
  const abortRef = useRef(new AbortController())
  // Set while the table is showing a file rather than a run of this rig.
  // Cleared by Clear and by starting a run, so it can never outlive the
  // rows it describes.
  const [importedName, setImportedName] = useState<string | null>(null)
  const csvInput = useRef<HTMLInputElement | null>(null)

  /**
   * Read a results file back in.
   *
   * Workbooks are parsed on the backend, where openpyxl is; CSVs in the
   * browser. Both are still accepted because the CSVs exported before the
   * workbook existed are real data someone may still want to look at.
   */
  const importFile = async (file: File) => {
    try {
      const isWorkbook = file.name.toLowerCase().endsWith('.xlsx')
      const { rows, meta } = isWorkbook
        ? { rows: await loadPullApi.importXlsx(file), meta: {} as { freqMhz?: number; pathLossDb?: number } }
        : parseLoadPullCsv(await file.text())
      setResults(rows)
      setImportedName(file.name)
      setRunKey(null)
      runTimesRef.current = null
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
  // LTE reads the field as channels, in the LTE pages' shared unit, and
  // resolves each to its uplink frequency -- which is what the VNA marker, the
  // sensor's calibration and the path loss are all keyed by. A value that
  // resolves to no band, or (in MHz) to more than one selected band, is not
  // guessed at: it is counted and blocks the run, as on the LTE CW sweep.
  const specValues = parseRangeSpec(freqSpec)
  const channels: Array<{ freqMhz: number; earfcn?: number }> = isLte
    ? specValues.flatMap((v) => {
        if (channelUnit === 'earfcn') {
          if (!Number.isInteger(v) || v < 0) return []
          const ch = uplinkFromEarfcn(v)
          return ch ? [{ freqMhz: ch.freqHz / 1e6, earfcn: v }] : []
        }
        const hits = uplinkFromMhz(v, lteBands)
        return hits.length === 1 ? [{ freqMhz: hits[0].freqHz / 1e6, earfcn: hits[0].earfcn }] : []
      })
    : specValues.filter((f) => f > 0).map((f) => ({ freqMhz: f }))
  const unresolvedChannels = isLte ? specValues.length - channels.length : 0
  /**
   * The values that did not resolve, grouped by what they would need.
   *
   * A count alone ("3 channels not in the selected bands") left the operator
   * to work out which of a pasted list were wrong and which band each wanted;
   * this names both, so the fix is one trip to Edit bands.
   */
  const channelProblems: string[] = !isLte || unresolvedChannels === 0 ? []
    : describeChannelIssues(channelIssues(specValues, channelUnit === 'earfcn', lteBands))
  const freqs = channels.map((c) => c.freqMhz)
  // Positions: Zero to End for every frequency, unless a frequency has its own
  // Start/Stop captured (Trombone per frequency), in which case it is swept
  // over that and only that. Still one visit per position -- see planTrombone.
  const tromb = planTrombone(freqs, freqRanges, zeroPulses, endPulses, deltaPulses)
  const positions = deltaXmm <= 0 ? [] : tromb.positions
  /** Frequencies with a range of their own, among the plan's. */
  const ownRanges = tromb.ranges.filter((r) => r?.own).length
  /** Frequencies with only one end of their own range captured. Saved as
   *  taken, so leaving the dialog loses nothing; the run waits for both. */
  const halfRanged = channels.filter((c) => {
    const r = findRange(freqRanges, c.freqMhz)
    return r != null && !isComplete(r)
  })
  /** Some frequency has no range of its own, so Zero/End are needed. */
  const needsZeroEnd = freqs.length === 0
    || tromb.ranges.some((r, i) => !r?.own && !halfRanged.some((c) => c.freqMhz === freqs[i]))
  /** The positions' extent, for the Sweep bounds header. */
  const spanPulses = positions.length ? Math.max(...positions) - Math.min(...positions) : 0
  /** Every captured end the sweep can reach: the All frequencies range and
   *  each frequency's own. Their extent is the motor's travel limits. */
  const rangeEnds = [
    zeroPulses, endPulses,
    ...tromb.ranges.flatMap((r) => (r ? [r.startPulses, r.stopPulses] : [])),
  ].filter((p): p is number => p != null)
  const rangeLo = rangeEnds.length ? Math.min(...rangeEnds) : null
  const rangeHi = rangeEnds.length ? Math.max(...rangeEnds) : null

  // Trombone status + jog + soft-limit sync + wait-for-idle, all in one hook.
  // No limits while the range dialog is open: it is where the ends are
  // found, and limits from the old ones would stop the jog short of new ones.
  const {
    motorConnected, motorMoving, motorPos,
    jogDir, jogFocused, setJogFocused,
    startJog, stopJog, onJogKeyDown, onJogKeyUp,
  } = useTromboneJog({
    running, active: !!active,
    // Treated as running until the first status poll has answered. A page
    // opened (or reloaded) mid-run used to push its own travel limits in the
    // moment before it learned a run was going, and the run's moves outside
    // them were refused for the rest of it: 20 points of a 600-point run
    // failed "outside soft limits" that way.
    anyRunning: running || otherRunning || runStatus == null,
    limitLo: rangesOpen ? null : rangeLo,
    limitHi: rangesOpen ? null : rangeHi,
    jogSpeed, abortRef,
  })

  // VNA span: puts the analyzer on the span and marker the run reads a
  // frequency on (one of the plan's, or any typed), so what a point will measure can be seen on
  // the instrument (and the Smith chart) before running. Only the VNA: the RF
  // switch is left where it is, on its own keys above.
  // Any frequency can be typed as well as picked from the plan's; empty
  // means the plan's first, so the field never needs filling in to be used.
  const [spanText, setSpanText] = useState('')
  const spanTyped = spanText.trim() === '' ? null : Number(spanText)
  const spanTypedOk = spanTyped != null && Number.isFinite(spanTyped) && spanTyped > 0
  const spanFreq: number | null = spanTyped == null ? (channels[0]?.freqMhz ?? null)
    : spanTypedOk ? spanTyped : null
  /** The trombone range of the VNA span's frequency (All frequencies when
   *  there is none, or it has no range of its own), for Go to Start / Stop. */
  const spanRange = spanFreq != null
    ? rangeAt(freqRanges, zeroPulses, endPulses, spanFreq)
    : zeroPulses != null && endPulses != null
      ? { startPulses: zeroPulses, stopPulses: endPulses, own: false } : null
  const spanRangeName = spanFreq != null && spanRange?.own ? `${num(spanFreq, 3)} MHz` : 'All frequencies'
  const spanM = useMutation({
    mutationFn: async (freqMhz: number) => {
      const { hz, startHz, stopHz } = vnaSpanHz(freqMhz)
      await vna.setFreq(startHz, stopHz)
      await vna.setMarkers([hz])
    },
    onSuccess: (_d, f) => {
      setVnaShownMhz(f)
      const { startHz, stopHz } = vnaSpanHz(f)
      log('VNA', `span ${num(startHz / 1e6, 2)}-${num(stopHz / 1e6, 2)} MHz, marker ${num(f, 3)} MHz`)
    },
    onError: (e: Error) => {
      log('VNA', `span failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'VNA span' })
    },
  })
  const powers = parseRangeSpec(powerSpec)
  // The modem takes 0-23 dBm and refuses anything else, so an out-of-range
  // power is a setup error here rather than forty failed rows.
  const powersOutOfRange = isLte
    && powers.some((p) => p < 0 || p > LTE_MAX_POWER_DBM)
  // Attenuation is the outermost axis: it is set by hand, so the run does a
  // whole trombone cycle at one setting before asking for the next.
  // In the order typed, so a sweep can run down from the most attenuation
  // as well as up from the least.
  const attSteps: Array<number | null> = attEnabled && attValues ? attValues : [null]
  const plan: PlanPoint[] = []
  for (const attDb of attSteps) {
    for (const pos of positions) {
      for (const k of tromb.at.get(pos) ?? []) {
        const { freqMhz, earfcn } = channels[k]
        for (const pw of powers) plan.push({ pos, freqMhz, earfcn, powerDbm: pw, attDb })
      }
    }
  }
  const totalPoints = plan.length
  // What else is in storage, so the cap is what is really left for this page:
  // the other Load Pull page's saved rows count against the same 5 MB.
  // Re-read when a run starts or ends and when the page is shown, not every
  // render -- the other page's rows can be megabytes of string to copy.
  const ownKey = isLte ? STORAGE_KEYS.lteLoadPullPage : STORAGE_KEYS.loadPullPage
  const otherChars = useMemo(() => {
    let n = 0
    try {
      for (const k of Object.keys(localStorage)) {
        if (k !== ownKey) n += k.length + (localStorage.getItem(k)?.length ?? 0)
      }
    } catch { /* storage blocked: nothing to subtract */ }
    return n
  }, [ownKey, active, running]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxPoints = Math.max(0, Math.floor((STORAGE_BUDGET_CHARS - otherChars) / ROW_CHARS))
  const planTooBig = totalPoints > maxPoints
  /**
   * What decides the plan's points, in order. Saved with a run's rows, so
   * Continue only resumes into the plan those rows were taken against --
   * a changed channel list or Delta X would otherwise splice two different
   * runs into one table. Settle is left out: it changes timing, not points.
   */
  const planKey = JSON.stringify({
    c: channels, p: powers, a: attSteps, z: zeroPulses, e: endPulses, d: deltaPulses,
    // Only when some frequency has its own range, so a plan saved before
    // per-frequency ranges existed still matches and can be continued.
    // `g`: the shared position grid. A run saved when each range stepped from
    // its own Start took other points, and must not be continued into these.
    ...(ownRanges ? { r: tromb.ranges, g: 1 } : {}),
    m: isLte ? null : paMode,
  })
  // Each attenuator step re-runs the trombone cycle, and every position visit
  // settles twice (VNA, then PCB) on top of each point's own settle.
  const positionVisits = totalPoints > 0 ? attSteps.length * positions.length : 0
  const estimatedRunMs = estimateRunMs(
    totalPoints,
    settleEffectiveMs + EST_POINT_OVERHEAD_MS,
    // A settle per zoomed VNA span, and one more back on the PCB.
    positionVisits * ((freqs.length + 1) * settleEffectiveMs + EST_POSITION_OVERHEAD_MS)
      // An LTE run power-cycles the modem once before its first point.
      + (isLte && totalPoints > 0 ? LTE_MODEM_RESTART_MS : 0),
  )
  // Progress is the 1-based point in hand.
  const completedPoints = Math.max(0, progressIdx - 1)
  // A continued run is timed on the points it has left, so the rate is not
  // flattered by the rows it started with.
  const runEta = useRunEta({
    running,
    completed: Math.max(0, completedPoints - resumeBase),
    total: totalPoints - resumeBase,
    plannedTotalMs: totalPoints > 0 ? estimatedRunMs * (totalPoints - resumeBase) / totalPoints : 0,
  })
  // A "Run" pill in the top bar, visible from every page while this runs:
  // it moves the trombone and keys the DUT. The id is this page's registry id.
  usePublishLiveOutput(`run:${pageId}`, running ? {
    kind: 'run',
    label: 'Run',
    detail: `${title} ${progressIdx}/${totalPoints}`,
    pageId,
  } : null)

  // Calibration across the whole plan is shown on the page's Path loss check
  // (BenchCourse), not repeated here.

  // Instruments are deliberately not gated here — the preflight connects them
  // on Run, and gating would make an unconnected rig look like a broken page.
  // The DUT link is different: nothing can connect it on the operator's behalf.
  //
  // Each blocker is named rather than folded into one disabled button. Four
  // separate preconditions can hold the run, and a greyed Run said which one
  // about as well as saying nothing.
  const blockers: string[] = []
  if (!hasBackend) blockers.push(`${protocol} has no backend wired up`)
  if (otherRunning) blockers.push(`wait for the ${runStatus?.radio} Load Pull run to finish`)
  if (!dutConnected) blockers.push('connect the DUT over BLE')
  if (missingRig.length) blockers.push(`connect the ${missingRig.join(', ')}`)
  if (!pathAck) blockers.push('confirm the RF path')
  if (needsZeroEnd && (zeroPulses == null || endPulses == null)) {
    blockers.push('capture the trombone range (Sweep bounds, Edit)')
  }
  if (halfRanged.length) {
    blockers.push(`capture the other end of the trombone range at ${halfRanged.map((c) => `${num(c.freqMhz, 3)} MHz`).join(', ')}`)
  }
  if (deltaXmm <= 0) blockers.push('set Delta X above 0')
  if (freqs.length === 0) blockers.push(isLte ? 'enter at least one channel' : 'enter at least one frequency')
  if (unresolvedChannels > 0) {
    blockers.push(`channels not in the selected bands: ${channelProblems.join('; ')}`)
  }
  if (powers.length === 0) blockers.push('enter at least one power')
  if (powersOutOfRange) blockers.push(`keep power within 0–${LTE_MAX_POWER_DBM} dBm`)
  if (planTooBig) {
    blockers.push(`cut the plan to ${maxPoints.toLocaleString()} points or fewer (it is ${totalPoints.toLocaleString()}), so its rows fit in browser storage`)
  }
  if (settleMs == null) blockers.push(`set a settle of at least ${MIN_SETTLE_MS} ms`)
  if (!powerSourceValid(powerSrc)) blockers.push('set the spectrum analyzer settings to positive numbers')
  if (attEnabled && !attRangeOk) {
    blockers.push(`set the attenuator values (whole dB, 0–${ATT_MAX_LIMIT_DB})`)
  }
  const canRun = blockers.length === 0 && !running

  // Continue: the saved rows are a prefix of this plan, short of its end.
  const doneRows = results.length
  const sameRun = runKey === planKey && rowIsPoint(results[doneRows - 1], plan[doneRows - 1])
  const canResume = canRun && !importedName && sameRun && doneRows > 0 && doneRows < totalPoints
  const resumeWhy = running ? ''
    : importedName ? 'The table holds an imported file, not a run'
      : doneRows === 0 ? 'No run to continue'
        // Same plan, rows out of step with it: the attenuator was jumped or
        // set off the plan at a prompt, and where to resume is not known.
        : !sameRun && runKey === planKey ? 'The attenuator was changed mid-run, so where to continue is unknown'
        : !sameRun ? 'The settings changed since this run, so its remaining points are unknown'
          : doneRows >= totalPoints ? 'This run finished'
            : blockers.length ? `Continue from point ${doneRows + 1} of ${totalPoints} once ${blockers[0]}`
              : `Run the remaining ${totalPoints - doneRows} of ${totalPoints} points, from point ${doneRows + 1}`

  // The course on top of the page. Same facts as `blockers`, grouped by the
  // section that settles them, so the rail says which part of a long page is
  // holding Run.
  const pointOk = freqs.length > 0 && powers.length > 0 && settleMs != null
    && !(attEnabled && !attRangeOk) && unresolvedChannels === 0 && !powersOutOfRange && !planTooBig
  const tromboneOk = (!needsZeroEnd || (zeroPulses != null && endPulses != null))
    && halfRanged.length === 0 && deltaXmm > 0
  /** The first check still in the way, named on the Run button and the Run
   *  step. Same order as the rail. */
  const firstBlocked = !dutConnected ? 'DUT'
    : missingRig.length ? 'Instruments'
      : !pathAck ? 'RF path'
        : !pointOk ? 'Test point'
          : !tromboneOk ? 'Trombone'
            : blockers.length ? 'setup' : undefined
  const courseSteps: CourseStep[] = [
    {
      id: 'rig',
      label: 'Instruments',
      state: missingRig.length ? 'block' : 'ok',
      summary: missingRig.length ? `${missingRig.length} not connected` : 'all ready',
      targetId: anchor('instruments'),
    },
    {
      id: 'rf-path',
      label: 'RF path',
      state: pathAck ? 'ok' : 'block',
      summary: pathAck ? 'confirmed' : 'not confirmed',
      targetId: anchor('rf-path'),
    },
    {
      id: 'test-point',
      label: 'Test point',
      state: pointOk ? 'ok' : 'block',
      summary: pointOk
        ? `${freqs.length} ${isLte ? 'channel' : 'freq'} × ${powers.length} power`
        : freqs.length === 0 ? (isLte ? 'no channel' : 'no frequency')
          : unresolvedChannels > 0 ? 'channel not in bands'
            : powers.length === 0 ? 'no power'
              : powersOutOfRange ? 'power out of range'
                : planTooBig ? `over ${maxPoints.toLocaleString()} points` : 'settle or attenuator',
      targetId: anchor('test-point'),
    },
    {
      id: 'trombone',
      label: 'Trombone',
      state: tromboneOk ? 'ok' : 'block',
      summary: tromboneOk
        ? `${totalPoints} points`
        : halfRanged.length ? 'one end missing'
          : needsZeroEnd && (zeroPulses == null || endPulses == null) ? 'capture the range' : 'set Delta X',
      targetId: anchor('trombone'),
    },
  ]

  const goToM = useMutation({
    mutationFn: (pos: number) => motor.move(pos, true),
    onSuccess: (_d, pos) => log('Motor', `go to ${fmt(pos / PULSES_PER_MM, 2)} mm ok`),
    onError: (e: Error) => notify.error(e.message, { title: 'Trombone go to' }),
  })

  const runM = useMutation({
    // `resume` continues the saved rows instead of starting over: only the
    // plan points after them are run, appended to them. The backend
    // re-establishes everything it assumes about the bench -- the trombone is
    // driven to the next point's position, the VNA re-read there, the
    // attenuator asked for again and (LTE) the modem restarted.
    mutationFn: async (resume: boolean) => {
      if (!(await preflight.run())) {
        reporter.note('cancelled — instruments not ready', 'warn')
        return
      }
      const start = resume ? results.length : 0
      // Per frequency: named once each rather than once per point.
      const uncal = freqs.filter((f) => !lossAt(f).calibrated)
      if (uncal.length) {
        reporter.note(
          `path loss not calibrated at ${uncal.join(', ')} MHz - those points `
          + `use the default ${defaultDb} dB, and their measured power is only `
          + 'as good as that figure.',
          'warn',
        )
      }
      const status = await loadPullApi.start({
        radio,
        points: plan.map((p) => ({
          pos: p.pos, freq_mhz: p.freqMhz, earfcn: p.earfcn ?? null,
          power_dbm: p.powerDbm, att_db: p.attDb,
        })),
        start_index: start,
        settle_ms: settleEffectiveMs,
        ...(isLte ? {} : { pa_mode: paMode }),
        path_loss: freqs.map((f) => {
          const l = lossAt(f)
          return { freq_mhz: f, db: l.db, calibrated: l.calibrated }
        }),
        ...powerFields,
        vna_half_span_frac: VNA_HALF_SPAN_FRAC,
        plan_key: planKey,
      })
      // Only once the backend has taken the run: a refused start must not
      // clear the table or claim its rows for a plan that never ran.
      if (!resume) setResults([])
      setImportedName(null)
      setRunKey(planKey)
      setResumeBase(start)
      const startedAt = resume
        ? (runTimesRef.current?.started_at ?? snap.runStartedAt ?? Date.now() / 1000)
        : Date.now() / 1000
      runTimesRef.current = { started_at: startedAt, finished_at: null }
      saveSnapshot(isLte, { runStartedAt: startedAt }, true)
      adoptRun(status)
      reporter.started(totalPoints - start)
      if (resume) reporter.note(`continuing from point ${start + 1} of ${totalPoints}`)
      if (isLte) reporter.note('restarting the modem')
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  // The preconditions used to go to the notice stack in the corner as a
  // "Before running" toast. They are on the check course at the top of the
  // page now, each beside the step that settles it, so a toast repeating them
  // -- and fading while the operator read it -- only added a second list.

  useEffect(() => {
    notify.notice(
      `${pageId}-imported`,
      'info',
      active && importedName ? `${importedName}: imported rows, not a run of this rig` : null,
      'Viewing a file',
    )
  }, [notify, active, importedName, pageId])

  const exportXlsx = useMutation({
    mutationFn: () => loadPullApi.exportXlsx(results, {
      radio: protocol,
      power_source: powerSrc.source,
      // An LTE spec is channels, so the unit goes with it; the per-frequency
      // sheets and path loss below are by uplink MHz either way.
      freq_spec: isLte ? `${freqSpec} (${freqUnit})` : freqSpec,
      power_spec: powerSpec,
      settle_ms: settleEffectiveMs,
      ...(isLte ? {} : { pa_mode: paMode }),
      delta_x_mm: deltaXmm,
      zero_pulses: zeroPulses,
      end_pulses: endPulses,
      path_loss_default_db: defaultDb,
      // Per frequency, and flagged when the figure was the default rather than
      // a measured one — the file should not hide that.
      path_loss_points: freqs.map((f) => {
        const l = lossAt(f)
        return { freq_mhz: f, db: l.db, calibrated: l.calibrated }
      }),
      // Only when some frequency had its own range: otherwise Zero/End above
      // already say what every frequency was swept over.
      trombone_ranges: ownRanges ? freqs.flatMap((f, i) => {
        const r = tromb.ranges[i]
        return r ? [{ freq_mhz: f, start_pulses: r.startPulses, stop_pulses: r.stopPulses, own: r.own }] : []
      }) : [],
      dut_mac: bleStatus?.address ?? null,
      started_at: runTimesRef.current?.started_at ?? null,
      finished_at: runTimesRef.current?.finished_at ?? null,
    }),
    onSuccess: async ({ blob, filename }) => {
      // Logged only once it is written -- see the note on the sweep export.
      const outcome = await saveBlob(blob, filename)
      if (outcome === 'saved') log('LoadPull', `Exported ${filename}`)
    },
    onError: (e: Error) => {
      log('LoadPull', `Excel export failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Export' })
    },
  })

  const onStop = () => {
    // Releases a run waiting on the attenuator prompt, which would otherwise
    // sit there after the abort.
    attPrompt.cancel()
    // The backend stops the run and keys the DUT down; the motor is halted
    // here as well so the carriage stops even if that request is slow.
    void loadPullApi.cancel().then(setRunStatus).catch(() => { /* ignore */ })
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
    attPrompt.cancel()
    void motor.stop().catch((e: Error) => {
      log('Motor', `emergency stop failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Emergency stop' })
    })
    abortRef.current.abort()
    stopJog()
    void loadPullApi.cancel().then(setRunStatus).catch(() => { /* ignore */ })
    // LoRa keys down straight away, run or not; an LTE run's CW is aborted by
    // the backend as it stops, and a CW outside a run ends by itself.
    if (!isLte) void device.stop().catch(() => { /* ignore */ })
    log('Motor', 'EMERGENCY STOP — run aborted, motor halted', 'error')
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <TopProgress
        pct={totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0}
        hidden={!running}
      />
      <PageHeader
        protocol={protocol}
        group={group}
        label="Load Pull Test"
        actions={
          <RunControls
            running={running}
            canRun={canRun}
            blockedBy={firstBlocked}
            progress={mine?.phase === 'modem' ? 'Modem…' : `${progressIdx}/${totalPoints}`}
            onRun={() => runM.mutate(false)}
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
        <BenchCourse
          freqsMhz={freqs}
          steps={courseSteps}
          order={['rig', 'rf-path', 'path-loss', 'test-point', 'trombone']}
        />

        {/* No Zero / End / Plan strip here: Zero and End are in the trombone
            card's "Mark the sweep" grid beside their Capture keys, the point
            count is on the course and under Delta X, and the run's time is in
            that same Delta X line. The strip said each of those a second
            time, a card's height above the controls that set them. */}

        <TwoCol stretch>
          <Section
            title="Connections"
            anchorId={anchor('instruments')}
            panel
            action={
              <StepMark
                state={allReady ? 'ok' : 'block'}
                label={allReady ? 'all connected' : `${6 - missingCount} of 6 connected`}
              />
            }
          >
            {/* What must be up before Run, as a checklist of pills that wraps
                to the card's width -- the DUT with the rest, since a missing
                DUT blocks a point the same way a missing instrument does. Its
                address is in the Bench inspector, not repeated here. */}
            <Box role="list" aria-label="Connections" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              <RigRow name="Power sensor" connected={ps.status === 'connected'} />
              <RigRow name="DC analyzer" connected={dc.status === 'connected'} />
              <RigRow name="VNA" connected={na.status === 'connected'} />
              <RigRow name="Switch" connected={sw.status === 'connected'} />
              <RigRow name="Trombone" connected={tr.status === 'connected'} />
              <RigRow name="DUT" connected={dutConnected} />
            </Box>
          </Section>

          <Section
            title="RF path"
            anchorId={anchor('rf-path')}
            panel
            action={
              <StepMark state={pathAck ? 'ok' : 'block'} label={pathAck ? 'confirmed' : 'not confirmed'} />
            }
          >
            <Stack spacing={1.25}>
              <Typography sx={{ ...TEXT.hint, color: pathAck ? 'text.secondary' : 'warning.main' }}>
                Check the cabling: <b>DUT to switch to coupler to power sensor</b>.
              </Typography>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                {/* Grey in both states: filled blue is kept for Run. */}
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
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
                  startIcon={<SchemaIcon sx={{ fontSize: 16 }} />}
                  onClick={() => setSetupOpen(true)}
                  sx={{ height: CONTROL_H.md }}
                >
                  View setup
                </Button>
              </Stack>
            </Stack>
          </Section>
        </TwoCol>

        <TestPointSection
          anchorId={anchor('test-point')} isLte={isLte} running={running}
          channelUnit={channelUnit} setChannelUnit={setChannelUnit} lteBands={lteBands}
          onEditBands={() => setBandsOpen(true)}
          freqSpec={freqSpec} setFreqSpec={setFreqSpec} freqUnit={freqUnit} nFreqs={freqs.length}
          unresolvedChannels={unresolvedChannels} channelProblems={channelProblems}
          powerSpec={powerSpec} setPowerSpec={setPowerSpec} nPowers={powers.length} powersOutOfRange={powersOutOfRange}
          paMode={paMode} setPaMode={setPaMode}
          settleText={settleText} setSettleText={setSettleText} settleMs={settleMs}
          attEnabled={attEnabled} setAttEnabled={setAttEnabled} attSpec={attSpec} setAttSpec={setAttSpec}
          attRangeOk={attRangeOk} nAttSteps={attSteps.length}
          nPositions={positions.length}
        />

        {/* What reads power at each point, beside the plan it measures. */}
        <Section title="Measure" anchorId={anchor('measure')} panel>
          <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} />
        </Section>

        {/* The trombone step as three short cards in a row: moving the
            carriage, the one-press commands, and marking where the sweep
            starts and ends. Each is a form -- a fixed
            label column, then controls of fixed widths -- so its rows line up
            on both edges. One card holding both, in columns, had keys that
            never quite met across them. */}
        <Box sx={TROMBONE_ROW_SX}>
          <Section
            title="Move trombone"
            anchorId={anchor('trombone')}
            panel
            action={
              <Stack direction="row" alignItems="center" spacing={1.5}>
                {/* Always rendered, blank while unknown (a lone dash read as
                    noise), in tabular figures, so the digits ticking over
                    mid-jog never move anything. */}
                <Typography
                  title={motorPos == null
                    ? `${PULSES_PER_MM} pulses/mm`
                    : `${motorPos.toLocaleString()} pulses · ${PULSES_PER_MM} pulses/mm`}
                  sx={{
                    fontFamily: MONO, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: motorPos == null ? 'text.disabled' : 'text.primary', whiteSpace: 'nowrap',
                    // Room for "000.00 mm", so the status beside it never moves.
                    minWidth: 80, textAlign: 'right',
                  }}
                >
                  {motorPos != null && (
                    <>
                      {mm(motorPos).toFixed(2)}
                      <Box component="span" sx={{ ...TEXT.hint, fontFamily: 'inherit', fontWeight: 400, color: 'text.secondary', ml: 0.5 }}>mm</Box>
                    </>
                  )}
                </Typography>
                {/* Plain: a dot and a word beside the reading, not a second
                    boxed thing competing with it. */}
                <StatusChip
                  plain
                  label={motorConnected ? (motorMoving ? 'Moving' : 'Idle') : 'Offline'}
                  tone={motorConnected ? (motorMoving ? 'busy' : 'ok') : 'off'}
                  spinning={motorConnected && motorMoving}
                />
              </Stack>
            }
          >
            <Box sx={FORM_SX}>
              <DriveLabel>Jog</DriveLabel>
              {/* Press-and-hold — focus it, then hold the arrow keys to run
                  the motor; release to stop. Mouse press-hold works too. */}
              <JogPad
                dir={jogDir}
                focused={jogFocused}
                disabled={!motorConnected || running}
                onStart={startJog}
                onStop={stopJog}
                onKeyDown={onJogKeyDown}
                onKeyUp={onJogKeyUp}
                onFocusChange={setJogFocused}
              />

              {/* Under Jog and named for it: the speed applies to the jog
                  only, not to Go to or to the run's moves. */}
              <DriveLabel>Speed</DriveLabel>
              <Box sx={CONTROL_COL_SX}>
                <SegmentedChoice
                  text
                  fullWidth
                  size="md"
                  aria-label="Jog speed"
                  value={String(jogSpeed)}
                  options={JOG_SPEEDS}
                  onChange={(v) => setJogSpeed(Number(v))}
                  disabled={!motorConnected || running}
                />
              </Box>
            </Box>
          </Section>

          {/* One-press commands, kept apart from the jog: they drive the RF
              switch or send the carriage to a captured end on their own. */}
          <Section title="Controls" panel>
            <Box sx={FORM_SX}>
                <DriveLabel>RF path</DriveLabel>
                {/* The RF switch, not the trombone -- but parking on VNA is
                    how the Smith chart is watched while jogging, which is why
                    it sits beside the jog. The glyphs are one glyph mirrored left
                    to right, one per side of the switch. */}
                <Box sx={PAIR_SX}>
                  <Button
                    size="small" variant="outlined"
                    startIcon={<HazardGlyph kind="path" sx={{ fontSize: 16 }} />}
                    onClick={() => switchM.mutate('VNA')}
                    disabled={!swConnected || switchM.isPending || running}
                    sx={[{ height: DRIVE_H }, hazardRingSx('path')]}
                  >
                    VNA
                  </Button>
                  <Button
                    size="small" variant="outlined"
                    startIcon={<HazardGlyph kind="path" sx={{ fontSize: 16, transform: 'scaleX(-1)' }} />}
                    onClick={() => switchM.mutate('PCB')}
                    disabled={!swConnected || switchM.isPending || running}
                    sx={[{ height: DRIVE_H }, hazardRingSx('path')]}
                  >
                    PCB
                  </Button>
                </Box>

                {/* The Start / Stop of the frequency picked under VNA span
                    below -- its own range, or All frequencies -- so the
                    carriage and the analyzer can be put on the same point. */}
                <DriveLabel>Go to</DriveLabel>
                <Box sx={PAIR_SX}>
                  <Button
                    variant="outlined" size="small" startIcon={<FirstPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => { if (spanRange) goToM.mutate(spanRange.startPulses) }}
                    disabled={!motorConnected || goToM.isPending || running || otherRunning || spanRange == null}
                    title={spanRange == null ? 'Capture the trombone range first'
                      : `${spanRangeName} start · ${fmt(mm(spanRange.startPulses), 2)} mm`}
                    sx={[{ height: DRIVE_H }, hazardRingSx('move')]}
                  >
                    Start
                  </Button>
                  <Button
                    variant="outlined" size="small" endIcon={<LastPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => { if (spanRange) goToM.mutate(spanRange.stopPulses) }}
                    disabled={!motorConnected || goToM.isPending || running || otherRunning || spanRange == null}
                    title={spanRange == null ? 'Capture the trombone range first'
                      : `${spanRangeName} stop · ${fmt(mm(spanRange.stopPulses), 2)} mm`}
                    sx={[{ height: DRIVE_H }, hazardRingSx('move')]}
                  >
                    Stop
                  </Button>
                </Box>

                <DriveLabel>VNA span</DriveLabel>
                <Box sx={PAIR_SX}>
                  <Autocomplete
                    // The chevron freeSolo hides, so it reads as the list it is.
                    size="small" freeSolo disableClearable openOnFocus forcePopupIcon
                    options={channels.map((c) => num(c.freqMhz, 3))}
                    // Every plan frequency stays listed whatever is typed: the
                    // field is a picker first, and filtering left one option
                    // or none once a value was in it.
                    filterOptions={(o) => o}
                    // As wide as its rows, not the field: in a narrow window
                    // the field is ~140 px and every option wrapped in two.
                    slotProps={{ paper: { sx: { width: 'max-content', minWidth: '100%' } } }}
                    inputValue={spanText}
                    onInputChange={(_e, v) => setSpanText(v ?? '')}
                    disabled={running}
                    renderOption={(props, o) => {
                      const { startHz, stopHz } = vnaSpanHz(Number(o))
                      return (
                        <Box
                          component="li" {...props} key={o}
                          sx={{
                            display: 'flex', justifyContent: 'space-between', gap: 2,
                            fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>{o} MHz</span>
                          <Box component="span" sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                            span {num(startHz / 1e6, 2)}-{num(stopHz / 1e6, 2)}
                          </Box>
                        </Box>
                      )
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={channels.length ? `${num(channels[0].freqMhz, 3)} MHz` : 'MHz'}
                        error={spanTyped != null && !spanTypedOk}
                        inputProps={{ ...params.inputProps, 'aria-label': 'Frequency to show the VNA span of, MHz' }}
                        // Enter applies, as the key beside it does.
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && spanFreq != null && na.status === 'connected' && !spanM.isPending) {
                            spanM.mutate(spanFreq)
                          }
                        }}
                        // Pointer, as a menu: it opens the plan's list on a
                        // click. The text caret comes back once focused, for typing.
                        sx={{
                          '& .MuiInputBase-root': { height: DRIVE_H, fontSize: 13, py: 0 },
                          '& .MuiInputBase-root, & input': { cursor: 'pointer' },
                          '& .Mui-focused input': { cursor: 'text' },
                        }}
                      />
                    )}
                  />
                  <Button
                    size="small" variant="outlined"
                    startIcon={spanM.isPending ? <KeySpinner /> : undefined}
                    onClick={() => { if (spanFreq != null) spanM.mutate(spanFreq) }}
                    disabled={na.status !== 'connected' || spanM.isPending || running || spanFreq == null}
                    title={spanFreq != null
                      ? `VNA to ${num(vnaSpanHz(spanFreq).startHz / 1e6, 2)}-${num(vnaSpanHz(spanFreq).stopHz / 1e6, 2)} MHz, marker on ${num(spanFreq, 3)}`
                      : undefined}
                    sx={{ height: DRIVE_H }}
                  >
                    Apply
                  </Button>
                </Box>
            </Box>
          </Section>

          {/* The plan these produce, with what it costs -- the estimate
              before Run, the run's own timing during it -- in the header, so
              it costs the cards no row. Empty until both ends are captured;
              the header's height is the title's either way. */}
          <Section
            title="Sweep bounds"
            panel
            // Short, with the whole of it on hover: the full "600 points over
            // 125.00 mm · 11m 52s elapsed · ~12m 43s left" squeezed the title
            // onto two lines and ran under it.
            action={totalPoints > 0 && (
              <Typography
                title={`${totalPoints} points over ${fmt(mm(spanPulses), 2)} mm · ${
                  runEta ? formatRunTiming(runEta) : `≈ ${formatDuration(estimatedRunMs)}`}`}
                sx={{
                  ...TEXT.hint, color: 'text.secondary', whiteSpace: 'nowrap',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums',
                }}
              >
                <Box component="b" sx={{ color: 'text.primary' }}>{totalPoints}</Box> pts
                {' · '}
                {runEta?.remainingMs != null ? `~${formatDuration(runEta.remainingMs)} left`
                  : runEta ? `${formatDuration(runEta.elapsedMs)} elapsed`
                    : `≈ ${formatDuration(estimatedRunMs)}`}
              </Typography>
            )}
          >
            <Box sx={FORM_SX}>
              {/* One row whatever is captured, so the card never changes
                  height: the extent swept, and the key that sets it. */}
              {/* One row: how many ranges and where they span, every
                  frequency's figures on hover. The ranges themselves are
                  drawn in the dialog, beside the keys that capture them --
                  drawn here too, at card size, they were a cramped copy. */}
              <DriveLabel>Range</DriveLabel>
              <Box sx={{ ...CONTROL_COL_SX, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 88px', columnGap: 1, alignItems: 'center' }}>
                <Tooltip
                  placement="top"
                  slotProps={{ tooltip: { sx: { maxWidth: 'none' } } }}
                  title={rangeLo == null ? 'Capture where the trombone sweeps' : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 1.5, rowGap: 0.25, fontVariantNumeric: 'tabular-nums' }}>
                      {(ownRanges > 0 || halfRanged.length > 0 ? channels : []).map((c, i) => {
                        const r = halfRanged.includes(c) ? null : tromb.ranges[i]
                        return (
                          <Box key={c.freqMhz} sx={{ display: 'contents' }}>
                            <span>{c.earfcn != null ? `${c.earfcn} · ${num(c.freqMhz, 1)} MHz` : `${num(c.freqMhz, 3)} MHz`}</span>
                            <Box component="span" sx={{ fontFamily: MONO, opacity: r?.own ? 1 : 0.7 }}>
                              {r ? `${fmt(mm(r.startPulses), 2)} – ${fmt(mm(r.stopPulses), 2)} mm${r.own ? '' : '  (all)'}` : 'one end missing'}
                            </Box>
                          </Box>
                        )
                      })}
                      {ownRanges === 0 && halfRanged.length === 0 && (
                        <span>Every frequency sweeps {fmt(mm(rangeLo), 2)} – {fmt(mm(rangeHi ?? rangeLo), 2)} mm</span>
                      )}
                    </Box>
                  )}
                >
                  <Typography
                    component="div"
                    sx={{
                      display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0,
                      whiteSpace: 'nowrap', overflow: 'hidden', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {rangeLo == null || rangeHi == null ? (
                      <Box component="span" sx={{ ...TEXT.hint, color: 'text.secondary' }}>not set</Box>
                    ) : ownRanges > 0 || halfRanged.length > 0 ? (
                      <>
                        <Box component="span" sx={{ fontSize: 13, fontWeight: 600, color: halfRanged.length ? 'warning.main' : 'text.primary' }}>
                          {halfRanged.length ? `${halfRanged.length} unfinished` : `${ownRanges} ${ownRanges === 1 ? 'range' : 'ranges'}`}
                        </Box>
                        <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {fmt(mm(rangeLo), 1)}–{fmt(mm(rangeHi), 1)}
                        </Box>
                      </>
                    ) : (
                      <Box component="span" sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fmt(mm(rangeLo), 2)} – {fmt(mm(rangeHi), 2)} mm
                      </Box>
                    )}
                  </Typography>
                </Tooltip>
                <Button
                  size="small" variant="outlined" color="inherit"
                  onClick={() => setRangesOpen(true)}
                  disabled={running}
                  sx={{ width: 88, minWidth: 88, height: DRIVE_H }}
                >
                  {rangeLo == null ? 'Set…' : 'Edit…'}
                </Button>
              </Box>

              <DriveLabel>Delta X</DriveLabel>
              <NumberField
                size="small"
                value={deltaXmm}
                onChange={(e) => setDeltaXmm(Math.max(0, Number(e.target.value) || 0))}
                onFocus={selectOnFocus}
                inputProps={{ step: 0.1, min: 0, 'aria-label': 'Delta X in mm' }}
                InputProps={{ endAdornment: <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>mm</Typography> }}
                disabled={running}
                sx={{ ...CONTROL_COL_SX, '& input': { fontFamily: MONO } }}
              />
            </Box>
          </Section>
        </Box>

        <Section
          title="Results"
          anchorId={anchor('results')}
          panel
          action={
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
              {/* Always on the row, disabled with the reason on hover when
                  there is nothing to continue, so the actions never shift. */}
              <Tooltip title={resumeWhy}>
                <span>
                  <MiniAction
                    startIcon={<PlayArrowIcon />}
                    onClick={() => runM.mutate(true)}
                    disabled={!canResume}
                  >
                    Continue
                  </MiniAction>
                </span>
              </Tooltip>
              <MiniAction
                startIcon={<ScatterPlotIcon />}
                onClick={() => setSmithOpen(true)}
                disabled={results.length === 0}
              >
                Smith chart
              </MiniAction>
              <MiniAction
                // The label stays "Export" while the workbook builds and the
                // icon turns into a spinner, so the action row does not shift.
                startIcon={exportXlsx.isPending ? <KeySpinner /> : <DownloadIcon />}
                onClick={() => exportXlsx.mutate()}
                disabled={results.length === 0 || exportXlsx.isPending}
              >
                Export
              </MiniAction>
              <MiniAction
                startIcon={<UploadFileIcon />}
                onClick={() => csvInput.current?.click()}
                disabled={running}
              >
                Import
              </MiniAction>
              {/* Clear last and apart, in the same order as every results
                  panel: it is the one action here that throws results away. */}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
              <MiniAction
                tone="destructive"
                startIcon={<DeleteSweepIcon />}
                onClick={() => { setResults([]); setImportedName(null); setRunKey(null); runTimesRef.current = null }}
                disabled={results.length === 0 || running}
              >
                Clear
              </MiniAction>
            </Stack>
          }
        >
          <input
            ref={csvInput}
            type="file"
            accept=".xlsx,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Reset first: re-picking the same file fires no change event
              // otherwise, so a second import would look ignored.
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />

          <LoadPullResultsTable results={results} lossAt={lossAt} judgeSensorRange={powerSrc.source === 'sensor'} />
        </Section>
      </PageBody>

      <SmithChartModal
        open={smithOpen}
        onClose={() => setSmithOpen(false)}
        results={results}
        keepToolbar={running}
        onRemeasure={openRemeasure}
      />
      <RemeasureDialog
        idx={remeasureRow ? remeasureIdx : null}
        row={remeasureRow}
        fresh={remeasureFresh}
        busy={remeasuring || remeasureM.isPending}
        phase={remeasuring ? mine?.phase ?? null : null}
        error={remeasureErr}
        blocked={remeasureBlocked}
        goToBusy={goToM.isPending}
        goToBlocked={!motorConnected ? 'The trombone is not connected' : running ? 'A run is going' : null}
        keepToolbar={running}
        onGoTo={() => { if (remeasureRow) goToM.mutate(remeasureRow.pos_pulses) }}
        onRemeasure={() => { if (remeasureIdx != null) remeasureM.mutate(remeasureIdx) }}
        onReplace={takeRemeasured}
        onClose={() => setRemeasureIdx(null)}
      />
      <TromboneRangesModal
        open={rangesOpen}
        onClose={() => setRangesOpen(false)}
        freqs={channels.map((c) => ({
          freqMhz: c.freqMhz,
          label: c.earfcn != null ? `${c.earfcn} · ${num(c.freqMhz, 1)}` : `${num(c.freqMhz, 3)} MHz`,
        }))}
        ranges={freqRanges}
        // Saved under their old names: Zero/End were this range, and a
        // page's saved ends (and a run's plan key) carry straight over.
        defaultRange={{ startPulses: zeroPulses, stopPulses: endPulses }}
        onChange={(r, d) => { setFreqRanges(r); setZeroPulses(d.startPulses); setEndPulses(d.stopPulses) }}
        locked={running || otherRunning}
        onEmergencyStop={onEmergencyStop}
        vna={{
          ready: na.status === 'connected',
          busy: spanM.isPending,
          shownMhz: vnaShownMhz,
          pendingMhz: spanM.isPending ? spanM.variables ?? null : null,
          onShow: (f) => spanM.mutate(f),
          describe: (f) => {
            const { startHz, stopHz } = vnaSpanHz(f)
            return `span ${num(startHz / 1e6, 2)}-${num(stopHz / 1e6, 2)} MHz`
          },
        }}
        trombone={{
          connected: motorConnected, moving: motorMoving, position: motorPos,
          jogDir, jogFocused,
          onJogStart: startJog, onJogStop: stopJog,
          onJogKeyDown, onJogKeyUp, onJogFocusChange: setJogFocused,
          jogSpeed, onJogSpeed: setJogSpeed,
        }}
      />
      <SetupDiagramModal open={setupOpen} onClose={() => setSetupOpen(false)} keepToolbar={running} />

      {attPrompt.dialog}
      {preflight.dialog}
      {/* The run's first step on LTE is cycling the modem, ~10 s with
          nothing else to see: the same notice LTE CW shows for the boot,
          below the toolbar so Stop and E-STOP stay in reach. */}
      {/* A Remeasure says so in its own dialog. */}
      {isLte && (
        <ModemBootDialog
          open={running && mine?.phase === 'modem' && !mine.plan_key?.startsWith(REMEASURE_KEY)}
          keepToolbar
        />
      )}
      {isLte && (
        <BandsModal
          open={bandsOpen}
          onClose={() => setBandsOpen(false)}
          bands={lteBands}
          onSave={setLteBands}
        />
      )}
    </Box>
  )
}
