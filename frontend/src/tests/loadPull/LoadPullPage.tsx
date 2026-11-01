import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, Divider, IconButton, MenuItem, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from '@mui/material'
import FirstPageIcon from '@mui/icons-material/FirstPageRounded'
import LastPageIcon from '@mui/icons-material/LastPageRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import UploadFileIcon from '@mui/icons-material/UploadFileRounded'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlotRounded'
// A block-and-wire diagram, which is what the setup picture is.
import SchemaIcon from '@mui/icons-material/SchemaRounded'
import { useMutation } from '@tanstack/react-query'
import { alpha } from '@mui/material/styles'
import { PageHeader } from '../../components/PageHeader'
import { BenchCourse } from '../../components/BenchCourse'
import type { CourseStep } from '../../components/courseSteps'
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
import { formatDuration, sleep } from '../../lib/async'
import { estimateRunMs } from '../../lib/eta'
import { TopProgress } from '../../components/TopProgress'
import { usePublishLiveOutput } from '../../context/liveOutput'
import { formatRunTiming, useRunEta } from '../../ui/useRunEta'
import { parseRangeSpec } from '../../lib/numericList'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { saveBlob } from '../../lib/download'
import { fmt } from '../../lib/format'
import { vswr, vswrLabel } from './smith'
import {
  scrollBehavior,
  ACTION_W, CONTROL_H, EmergencyStop, FieldGrid, MONO, PageBody,
  RunControls, Section, StatusChip, TEXT, TwoCol,
  HeadCell, NUM_CELL_SX,
  HazardGlyph, hazardRingSx,
  GRID_GAP, JogPad, CheckMark, KeySpinner, MiniAction, RESULTS_H, SegmentedChoice, type CheckState,
} from '../../ui'
import { useAppPalette } from '../../context/ThemeModeContext'
import type { TestPageProps } from '../types'
import {
  loadPullPageSnapshot, lteLoadPullPageStore, persistLoadPullPage,
  type LoadPullPageSnapshot, type LoadPullResultRow,
} from '../../store/loadPullPageStore'
import { useLteModem } from '../lte/useLteModem'
import { useLteBands, useLteChannelUnit } from '../lte/channel'
import { uplinkFromEarfcn, uplinkFromMhz } from '../../lib/earfcn'
import type { LteCwRequest } from '../../types/models'
import { SmithChartModal } from './SmithChartModal'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { planPositions } from './plan'
import { useTromboneJog } from './useTromboneJog'
import { loadPullApi } from '../../api/loadPull'
import { useChatSource } from '../../context/ChatContext'
import { mA } from '../../lib/chatRows'
import { useAttPrompt } from './AttPrompt'
import { parseLoadPullCsv } from './importCsv'
import { SetupDiagramModal } from './SetupDiagramModal'
import { confidenceColor, powerConfidence } from './powerConfidence'
// Shared with the Trombone page so both agree on what a mm is.
import { JOG_SPEEDS, PULSES_PER_MM } from '../../lib/trombone'
import { selectOnFocus } from '../../lib/selectOnFocus'

/** Every stage of a point touches one of these. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = [
  'power-sensor', 'dc-analyzer', 'network-analyzer', 'rf-switch', 'rf-trombone',
]

/**
 * Rough costs for the pre-run estimate, on top of the settle delays.
 *
 * Per position: the trombone move, two switch moves and a VNA acquisition.
 * Per point: the TX command, the power/current read and TX off. Guesses, not
 * measurements -- once the run is going the remaining time follows the
 * measured rate. Operator waits at attenuator steps are not in either.
 */
const EST_POSITION_OVERHEAD_MS = 6000
const EST_POINT_OVERHEAD_MS = 500

/** Budget for the motor travel, switching and measuring around the delays. */
const STEP_OVERHEAD_TIMEOUT_MS = 90_000

/**
 * LTE: per-point CW duration, a backstop only. Each point is aborted as soon
 * as it has measured; this just bounds a transmission whose abort was missed.
 * Same figure and reasoning as the LTE CW sweep (CW_TIME_MS there).
 */
const LTE_CW_TIME_MS = 20_000
/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const LTE_MAX_POWER_DBM = 23
/** The modem power-cycle at the start of an LTE run; see `useLteModem.cycle`. */
const LTE_MODEM_RESTART_MS = 10_000

const blankRow = (item: PlanPoint): LoadPullResultRow => ({
  pos_pulses: item.pos,
  pos_mm: mm(item.pos),
  freq_mhz: item.freqMhz,
  ...(item.earfcn == null ? {} : { earfcn: item.earfcn }),
  power_dbm_setting: item.powerDbm,
  ...(item.attDb == null ? {} : { att_db: item.attDb }),
  power_dbm: null,
  current_a: null,
  r_ohm: null,
  x_ohm: null,
  s11_db: null,
  error: null,
})

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

/** Attenuator sweep. Fixed 1 dB steps from a start to a stop setting, either
 *  way round, within the attenuator's 0-20 dB. */
const ATT_STEP_DB = 1
const ATT_MAX_LIMIT_DB = 20

/** A typed attenuator setting, or null while empty or out of range. */
function parseAttDb(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > ATT_MAX_LIMIT_DB) return null
  return Math.round(n)
}

/** One height for every control in the drive column. Four kinds of control —
 *  buttons, a jog pad, a toggle group — at three different sizes read as
 *  unrelated widgets rather than one panel for one motor. */
const DRIVE_H = 32

/** What the Frequency and DUT power fields accept (see lib/numericList). */
/** Examples of the four forms, in the field's own unit. */
const SPEC_EXAMPLES = {
  mhz: ['915', '900-930', '900-930:5', '902.3, 915'],
  lteMhz: ['1880', '1860-1900', '1860-1900:10', '1860, 1880'],
  earfcn: ['18900', '18700-19100', '18700-19100:100', '18700, 18900'],
  dbm: ['14', '10-20', '10-20:2', '10, 14, 20'],
  lteDbm: ['23', '10-23', '10-23:1', '10, 17, 23'],
} as const

/**
 * The list syntax as four labelled examples. It was one sentence naming the
 * forms in prose ("a stepped range \"a-b:step\" …"), which read as a rule to
 * decode rather than something to copy.
 */
function SpecTip({ examples }: { examples: readonly string[] }) {
  const names = ['One', 'Range', 'Step', 'List']
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 1.5, rowGap: 0.25 }}>
      {examples.map((ex, i) => (
        <Box key={names[i]} sx={{ display: 'contents' }}>
          <span>{names[i]}</span>
          <Box component="span" sx={{ fontFamily: MONO }}>{ex}</Box>
        </Box>
      ))}
    </Box>
  )
}


/** Write fields to this radio's page snapshot and schedule the save. */
function saveSnapshot(isLte: boolean, patch: Partial<LoadPullPageSnapshot>) {
  if (isLte) {
    Object.assign(lteLoadPullPageStore.snapshot, patch)
    lteLoadPullPageStore.persist()
  } else {
    Object.assign(loadPullPageSnapshot, patch)
    persistLoadPullPage()
  }
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

interface BoundRowProps {
  label: string
  value: number | null
  onCapture: () => void
  onClear: () => void
  captureDisabled: boolean
  clearDisabled: boolean
}

/**
 * One end of the sweep, as two cells of the bounds form: its label, then its
 * captured position, the Capture key and a clear icon -- all in the control
 * column, so Zero and End line up and end where Delta X does.
 */
function BoundRow({
  label, value, onCapture, onClear, captureDisabled, clearDisabled,
}: BoundRowProps) {
  return (
    <>
      <DriveLabel>{label}</DriveLabel>
      <Box sx={{ ...CONTROL_COL_SX, display: 'grid', gridTemplateColumns: '1fr 112px', columnGap: 1, alignItems: 'center' }}>
        <Stack direction="row" alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums',
              color: value == null ? 'text.secondary' : 'text.primary',
              fontWeight: value == null ? 400 : 600, whiteSpace: 'nowrap', flexGrow: 1,
            }}
          >
            {value == null ? 'not set' : `${(value / PULSES_PER_MM).toFixed(2)} mm`}
          </Typography>
          {/* Icon only, and only once there is something to clear; held in
              its slot with `visibility` so the value never shifts. `span` so
              the tooltip still fires while the key is disabled mid-run. */}
          <Tooltip title={`Clear ${label.toLowerCase()}`}>
            <span style={{ visibility: value == null ? 'hidden' : 'visible' }}>
              <IconButton
                size="small"
                onClick={onClear}
                disabled={clearDisabled || value == null}
                aria-label={`Clear ${label.toLowerCase()}`}
                sx={{ color: 'text.secondary', '&:hover': { color: 'error.main', bgcolor: 'transparent' } }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Button
          size="small"
          // Grey in both states: filled blue is kept for Run.
          variant="outlined"
          color="inherit"
          onClick={onCapture}
          disabled={captureDisabled}
          // Fixed: "Capture" and "Recapture" share one width.
          sx={{ width: 112, minWidth: 112, height: DRIVE_H }}
        >
          {value == null ? 'Capture' : 'Recapture'}
        </Button>
      </Box>
    </>
  )
}

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
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const hasBackend = protocol === 'LoRa' || isLte
  // Called on both pages (hooks cannot be conditional); only LTE's uses it.
  const modem = useLteModem({ pageId: isLte ? pageId : undefined })
  const [channelUnit] = useLteChannelUnit()
  const [lteBands] = useLteBands()

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

  const [paMode, setPaMode] = useState<number>(() => snap.paMode ?? 2)
  // Clamped on read: a snapshot saved before the floor existed can hold a value
  // below it, and restoring one would quietly reintroduce the bad readings.
  // Sweep specs. Seeded from the old single values so an existing snapshot
  // keeps working and reads the same on first load.
  // LTE seeds a band 2 channel, in the unit the LTE pages are reading in, and
  // the modem's full power -- the LTE CW sweep's defaults.
  const [freqSpec, setFreqSpec] = useState<string>(
    () => snap.freqSpec ?? (isLte
      ? (channelUnit === 'earfcn' ? '18900' : '1880')
      : String(snap.freqMhz ?? 902.3)),
  )
  const [powerSpec, setPowerSpec] = useState<string>(
    () => snap.powerSpec ?? String(snap.powerDbm ?? (isLte ? LTE_MAX_POWER_DBM : 14)),
  )
  const [attEnabled, setAttEnabled] = useState<boolean>(
    () => snap.attEnabled ?? false,
  )
  // Held as text: a number field bound to a number cannot be cleared — the
  // moment it is empty the parse gives 0 and 0 is written straight back.
  const [attStartText, setAttStartText] = useState<string>(
    () => String(snap.attStartDb ?? 0),
  )
  const [attStopText, setAttStopText] = useState<string>(
    () => String(snap.attStopDb ?? snap.attMaxDb ?? ATT_MAX_LIMIT_DB),
  )
  const attStartDb = parseAttDb(attStartText)
  const attStopDb = parseAttDb(attStopText)
  /** Both ends typed and in range -- what a sweep needs. */
  const attRangeOk = attStartDb != null && attStopDb != null

  // Text for the same reason as the attenuator fields: bound to a number, the field cannot
  // be emptied — a blank parses to 0 and 0 is written straight back.
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
  const [deltaXmm, setDeltaXmm] = useState<number>(() => snap.deltaXmm ?? 1)
  const [jogSpeed, setJogSpeed] = useState<number>(() => snap.jogSpeed ?? 800)
  const [zeroPulses, setZeroPulses] = useState<number | null>(() => snap.zeroPulses ?? null)
  const [endPulses, setEndPulses] = useState<number | null>(() => snap.endPulses ?? null)
  // Starts false every session on purpose: it asserts how the bench is
  // cabled *now*, which is the one precondition nothing here can verify.
  const [pathAck, setPathAck] = useState(false)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => snap.results ?? [])
  const [smithOpen, setSmithOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)

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

  useEffect(() => { saveSnapshot(isLte, { paMode }) }, [paMode, isLte])
  useEffect(() => { saveSnapshot(isLte, { freqSpec }) }, [freqSpec, isLte])
  useEffect(() => { saveSnapshot(isLte, { powerSpec }) }, [powerSpec, isLte])
  useEffect(() => { saveSnapshot(isLte, { attEnabled }) }, [attEnabled, isLte])
  useEffect(() => {
    // Only a usable value is persisted; a half-typed field is not worth
    // restoring on the next visit.
    if (attStartDb != null) { saveSnapshot(isLte, { attStartDb }) }
  }, [attStartDb, isLte])
  useEffect(() => {
    if (attStopDb != null) { saveSnapshot(isLte, { attStopDb }) }
  }, [attStopDb, isLte])
  useEffect(() => {
    if (settleMs != null) { saveSnapshot(isLte, { settleMs }) }
  }, [settleMs, isLte])
  useEffect(() => { saveSnapshot(isLte, { deltaXmm }) }, [deltaXmm, isLte])
  useEffect(() => { saveSnapshot(isLte, { jogSpeed }) }, [jogSpeed, isLte])
  useEffect(() => { saveSnapshot(isLte, { zeroPulses }) }, [zeroPulses, isLte])
  useEffect(() => { saveSnapshot(isLte, { endPulses }) }, [endPulses, isLte])
  useEffect(() => { saveSnapshot(isLte, { results }) }, [results, isLte])

  // One frequency per run, so the correction is decided once.

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  // Replaced per run. Stop aborts it, which cancels in-flight requests and
  // wakes every settle delay immediately.
  const abortRef = useRef(new AbortController())
  const attPrompt = useAttPrompt()
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  // Position the trombone is currently parked at, so the plan's remaining
  // points at that position skip the move. Reset per run, never read for
  // rendering — a ref rather than state.
  const posRef = useRef<number | null>(null)
  // Epoch seconds of the run the table holds, for the workbook's Run sheet.
  // Cleared on import and Clear, so a file's rows are never stamped with the
  // timing of whatever run happened to precede them.
  const runTimesRef = useRef<{ started_at: number; finished_at: number | null } | null>(null)
  // Attenuator setting the operator has confirmed for the cycle in progress.
  const attRef = useRef<number | null>(null)
  // VNA markers for the current position, keyed by requested frequency (Hz).
  const markersRef = useRef<Map<number, VnaMarkerResult>>(new Map())
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

  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() })
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
  const freqs = channels.map((c) => c.freqMhz)
  const powers = parseRangeSpec(powerSpec)
  // The modem takes 0-23 dBm and refuses anything else, so an out-of-range
  // power is a setup error here rather than forty failed rows.
  const powersOutOfRange = isLte
    && powers.some((p) => p < 0 || p > LTE_MAX_POWER_DBM)
  // Attenuation is the outermost axis: it is set by hand, so the run does a
  // whole trombone cycle at one setting before asking for the next.
  // Start to stop in either direction, so a sweep can run down from the most
  // attenuation as well as up from the least.
  const attSteps: Array<number | null> = attEnabled && attRangeOk
    ? Array.from(
        { length: Math.floor(Math.abs(attStopDb - attStartDb) / ATT_STEP_DB) + 1 },
        (_v, i) => attStartDb + Math.sign(attStopDb - attStartDb) * i * ATT_STEP_DB,
      )
    : [null]
  const plan: PlanPoint[] = []
  for (const attDb of attSteps) {
    for (const pos of positions) {
      for (const { freqMhz, earfcn } of channels) {
        for (const pw of powers) plan.push({ pos, freqMhz, earfcn, powerDbm: pw, attDb })
      }
    }
  }
  const totalPoints = plan.length
  // Each attenuator step re-runs the trombone cycle, and every position visit
  // settles twice (VNA, then PCB) on top of each point's own settle.
  const positionVisits = totalPoints > 0 ? attSteps.length * positions.length : 0
  const estimatedRunMs = estimateRunMs(
    totalPoints,
    settleEffectiveMs + EST_POINT_OVERHEAD_MS,
    positionVisits * (2 * settleEffectiveMs + EST_POSITION_OVERHEAD_MS)
      // An LTE run power-cycles the modem once before its first point.
      + (isLte && totalPoints > 0 ? LTE_MODEM_RESTART_MS : 0),
  )
  // runSequence reports the 1-based point in hand.
  const completedPoints = Math.max(0, progressIdx - 1)
  const runEta = useRunEta({
    running, completed: completedPoints, total: totalPoints, plannedTotalMs: estimatedRunMs,
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
  if (!dutConnected) blockers.push('connect the DUT over BLE')
  if (missingRig.length) blockers.push(`connect the ${missingRig.join(', ')}`)
  if (!pathAck) blockers.push('confirm the RF path')
  if (zeroPulses == null) blockers.push('capture the zero position')
  if (endPulses == null) blockers.push('capture the end position')
  if (deltaXmm <= 0) blockers.push('set Delta X above 0')
  if (freqs.length === 0) blockers.push(isLte ? 'enter at least one channel' : 'enter at least one frequency')
  if (unresolvedChannels > 0) {
    blockers.push(`${unresolvedChannels} channel${unresolvedChannels === 1 ? '' : 's'} not in the selected bands`)
  }
  if (powers.length === 0) blockers.push('enter at least one power')
  if (powersOutOfRange) blockers.push(`keep power within 0–${LTE_MAX_POWER_DBM} dBm`)
  if (settleMs == null) blockers.push(`set a settle of at least ${MIN_SETTLE_MS} ms`)
  if (attEnabled && !attRangeOk) {
    blockers.push(`set the attenuator start and stop (0–${ATT_MAX_LIMIT_DB} dB)`)
  }
  const canRun = blockers.length === 0 && !running

  // The course on top of the page. Same facts as `blockers`, grouped by the
  // section that settles them, so the rail says which part of a long page is
  // holding Run.
  const pointOk = freqs.length > 0 && powers.length > 0 && settleMs != null
    && !(attEnabled && !attRangeOk) && unresolvedChannels === 0 && !powersOutOfRange
  const tromboneOk = zeroPulses != null && endPulses != null && deltaXmm > 0
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
              : powersOutOfRange ? 'power out of range' : 'settle or attenuator',
      targetId: anchor('test-point'),
    },
    {
      id: 'trombone',
      label: 'Trombone',
      state: tromboneOk ? 'ok' : 'block',
      summary: tromboneOk
        ? `${totalPoints} points`
        : zeroPulses == null || endPulses == null ? 'capture Zero and End' : 'set Delta X',
      targetId: anchor('trombone'),
    },
  ]

  /** The LTE CW frame for a point: at the channel centre, as on the CW sweep. */
  const lteParams = (item: PlanPoint): LteCwRequest => ({
    earfcn: item.earfcn ?? 0,
    time_ms: LTE_CW_TIME_MS,
    tx_power_dbm: item.powerDbm,
    offset_hz: 0,
  })

  /**
   * Key the DUT for one point -- the only step that differs by radio.
   *
   * LTE records the test as live on the modem, so Stop, E-Stop and the top
   * bar's TX pill can abort it with the parameters it was started with.
   */
  const txOn = async (item: PlanPoint, freqHz: number, signal: AbortSignal) => {
    if (!isLte) {
      return device.loraPower(
        { freq_hz: freqHz, power_dbm: item.powerDbm, pa_mode: paMode },
        { signal },
      )
    }
    const params = lteParams(item)
    const tx = await device.lteCw({ ...params, start: true }, { signal })
    if (tx.ok) modem.setRunning({ label: 'CW', abort: () => device.lteCw({ ...params, start: false }) })
    return tx
  }

  /**
   * Un-key after a point, on success and failure alike. Never throws.
   *
   * On LTE this is not tidiness: the modem takes one test at a time and drops
   * a START that arrives while another runs, so a point left un-aborted would
   * have every later point silently measure its channel.
   */
  const txOff = async (item: PlanPoint) => {
    try {
      if (!isLte) { await device.stop(); return }
      await device.lteCw({ ...lteParams(item), start: false })
      modem.setRunning(null)
    } catch { /* the end-of-run stop tries again */ }
  }

  /** Abort whatever the page last keyed, wherever the run is. Never throws. */
  const stopTx = async () => {
    if (!isLte) { try { await device.stop() } catch { /* ignore */ } return }
    const live = modem.getRunning()
    if (!live) return
    try { await live.abort() } catch { /* ignore */ }
    modem.setRunning(null)
  }

  // One plan point. The trombone moves only when the position changes, and the
  // VNA is read once per position for every frequency in the plan — both are
  // the expensive parts, and repeating them per (freq, power) combination would
  // multiply a run by the size of the electrical sweep for no new information.
  //
  // Never throws: failures are recorded on the returned row.
  const measurePoint = async (item: PlanPoint): Promise<LoadPullResultRow> => {
    const { signal } = abortRef.current
    const row = blankRow(item)
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
        await sleep(settleEffectiveMs, signal)
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
        await sleep(settleEffectiveMs, signal)
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
      const tx = await txOn(item, freqHz, signal)
      if (!tx.ok) {
        row.error = (row.error ? row.error + '; ' : '') + `tx status=${tx.status}`
      } else {
        await sleep(settleEffectiveMs, signal)
        // 5. measure power + CC; correct with the loss for *this* frequency
        const meas = await instrumentsApi.measure(freqHz, { signal })
        const pl = lossAt(item.freqMhz)
        // Both: the corrected figure is what the run is measuring, the raw one
        // is what says whether the sensor was anywhere near the edge of its
        // range when it measured it.
        row.power_dbm_raw = meas.power_dbm
        row.power_dbm = meas.power_dbm == null ? null : meas.power_dbm + pl.db
        row.current_a = meas.current_a
        if (meas.error) row.error = (row.error ? row.error + '; ' : '') + meas.error
      }
      // 6. TX off
      await txOff(item)
    } catch (e) {
      // A cancelled request is the operator stopping, not a measurement fault.
      if (!signal.aborted) row.error = (e as Error).message
      await txOff(item)
    }
    return row
  }

  /**
   * Stop at each attenuator step and wait for the operator.
   *
   * Runs outside the per-point timeout: the wait is unbounded by nature, and
   * inside `measurePoint` it counted against the step budget and failed the
   * point with "timed out after 92s" while the run was only waiting to be
   * answered.
   */
  const beforeItem = async (item: PlanPoint) => {
    if (item.attDb == null || attRef.current === item.attDb) return
    // Park the switch on the VNA before asking. The DUT is not transmitting
    // between cycles, so the analyzer is the only way to watch the attenuator
    // take effect while it is being dialled in.
    try {
      await servo.goto('VNA')
    } catch (e) {
      // Non-fatal: the operator can still set the attenuator blind, and the
      // next point re-routes the switch itself.
      reporter.note(`could not park the switch on VNA: ${(e as Error).message}`, 'warn')
    }
    const idx = attSteps.indexOf(item.attDb)
    const ok = await attPrompt.ask(item.attDb, Math.max(0, idx), attSteps.length)
    if (!ok) {
      abortRef.current.abort()
      return
    }
    attRef.current = item.attDb
    // Forget where the trombone is, so the first point of the new cycle drives
    // it back to the start rather than assuming it is already there.
    posRef.current = null
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
      runTimesRef.current = { started_at: Date.now() / 1000, finished_at: null }
      posRef.current = null
      attRef.current = null
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
          markRowError: (item, _i, message) => ({ ...blankRow(item), error: message }),
          // A point moves the trombone and settles three times, so its budget
          // has to cover the motor travel as well as the delays.
          stepTimeoutMs: settleEffectiveMs * 3 + STEP_OVERHEAD_TIMEOUT_MS,
          before: async () => {
            try { await vna.setMarkers(freqs.map((f) => Math.round(f * 1_000_000))) }
            catch (e) { reporter.note(`setMarkers failed: ${(e as Error).message}`, 'warn') }
            // Once per run, as on the LTE CW sweep: down and up again, so the
            // run starts from a known modem with nothing left running on it.
            // A modem that will not come up fails the run here, before the
            // trombone has moved.
            if (isLte) {
              reporter.note('restarting the modem')
              await modem.cycle()
            }
          },
          beforeItem,
          measure: (item) => measurePoint(item),
          // TX off only; an LTE run powers the modem down in `finally` below.
          after: stopTx,
          rowHasError: (r) => !!r.error,
          onRows: setResults,
          onProgress: setProgressIdx,
          reporter,
        })
      } finally {
        // LTE: the run owns the modem from its first point to its last, so it
        // hands it back off once every cycle is done -- or the run was stopped
        // or failed, including a modem that never came up. Here rather than
        // in `after`, which a failed start skips. A refusal is most likely a
        // modem that was already down, which is where this was going.
        if (isLte) {
          try { await modem.powerOff() } catch (e) {
            reporter.note(`modem off failed: ${(e as Error).message}`, 'warn')
          }
        }
        if (runTimesRef.current) runTimesRef.current.finished_at = Date.now() / 1000
        setRunning(false)
      }
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
    abortRef.current.abort()
    void stopTx()
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
    void stopTx()
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

        <Section title="Test point" anchorId={anchor('test-point')} panel>
          <FieldGrid columns={4}>
            {/* The list syntax lives on the two fields that take it, rather
                than as a line of its own under the grid. A wrapper because
                LabeledField does not forward a ref for the tooltip. */}
            <Tooltip
              title={<SpecTip examples={!isLte ? SPEC_EXAMPLES.mhz : channelUnit === 'earfcn' ? SPEC_EXAMPLES.earfcn : SPEC_EXAMPLES.lteMhz} />}
              placement="top-start"
            >
              <Box>
                {/* LTE takes channels in the unit every LTE page reads (set on
                    the LTE CW page), resolved within its selected bands. */}
                <LabeledField
                  label={isLte ? 'Channel' : 'Frequency'} hint={freqUnit} value={freqSpec}
                  onChange={(e) => setFreqSpec(e.target.value)}
                  disabled={running}
                  error={freqSpec.trim() !== '' && (freqs.length === 0 || unresolvedChannels > 0)}
                  placeholder={!isLte ? '915, 900-930:5 or 902.3,915'
                    : channelUnit === 'earfcn' ? '18900 or 18700-19100:100' : '1880 or 1860-1900:10'}
                />
              </Box>
            </Tooltip>
            <Tooltip title={<SpecTip examples={isLte ? SPEC_EXAMPLES.lteDbm : SPEC_EXAMPLES.dbm} />} placement="top-start">
              <Box>
                <LabeledField
                  label="DUT power" hint="dBm" value={powerSpec}
                  onChange={(e) => setPowerSpec(e.target.value)}
                  disabled={running}
                  error={powerSpec.trim() !== '' && (powers.length === 0 || powersOutOfRange)}
                  placeholder={isLte ? '23 or 10-23:1' : '14 or 10-20:2'}
                />
              </Box>
            </Tooltip>
            {/* LoRa's PA selection. The LTE modem has no such setting. */}
            {!isLte && (
              <LabeledField
                label="PA mode" select value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
                disabled={running}
              >
                <MenuItem value={2}>Auto</MenuItem>
                <MenuItem value={1}>On</MenuItem>
                <MenuItem value={0}>Off</MenuItem>
              </LabeledField>
            )}
            <LabeledField
              label="Settle" hint={`ms · min ${MIN_SETTLE_MS}`} type="number" value={settleText}
              onChange={(e) => setSettleText(e.target.value)}
              // Raise a typed-but-too-low value to the floor on blur; leave an
              // empty field empty, so it can be cleared and retyped.
              onBlur={() => setSettleText((t) => (
                t.trim() === '' ? t : String(clampSettleMs(Number(t)))
              ))}
              disabled={running}
              error={settleMs == null}
              inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
            />
            {/* The attenuator sits on the trombone's second output and is set
                by hand, so sweeping it is opt-in — off, the run behaves exactly
                as it did before. Filed with the other test-point fields rather
                than in a row of its own, which read as a different kind of
                setting. */}
            <LabeledField
              label="Attenuator" select value={attEnabled ? 1 : 0}
              onChange={(e) => setAttEnabled(Number(e.target.value) === 1)}
              disabled={running}
            >
              <MenuItem value={0}>Off</MenuItem>
              <MenuItem value={1}>Sweep</MenuItem>
            </LabeledField>
            <LabeledField
              label="Att start" hint={`dB · 0–${ATT_MAX_LIMIT_DB}`}
              type="number" value={attStartText}
              onChange={(e) => setAttStartText(e.target.value)}
              onBlur={() => setAttStartText((t) => (attStartDb == null ? t : String(attStartDb)))}
              disabled={running || !attEnabled}
              error={attEnabled && attStartDb == null}
              inputProps={{ min: 0, max: ATT_MAX_LIMIT_DB, step: ATT_STEP_DB }}
            />
            <LabeledField
              label="Att stop" hint={`dB · 0–${ATT_MAX_LIMIT_DB}`}
              type="number" value={attStopText}
              onChange={(e) => setAttStopText(e.target.value)}
              onBlur={() => setAttStopText((t) => (attStopDb == null ? t : String(attStopDb)))}
              disabled={running || !attEnabled}
              error={attEnabled && attStopDb == null}
              inputProps={{ min: 0, max: ATT_MAX_LIMIT_DB, step: ATT_STEP_DB }}
            />
          </FieldGrid>
          {/* The plan multiplies out fast — three positions of a 30-point
              trombone sweep across four powers is 360 points — so say what it
              is a product of next to the fields that decide it. The total is
              on the Plan tile and beside Delta X; this line is only the
              factors. Always one line tall, so the card does not grow when
              the plan becomes complete. */}
          <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 1, minHeight: 18 }}>
            {positions.length > 0 && freqs.length > 0 && powers.length > 0 ? (
              <>
                {positions.length} {positions.length === 1 ? 'position' : 'positions'}
                {' × '}{freqs.length} {isLte ? (freqs.length === 1 ? 'channel' : 'channels') : (freqs.length === 1 ? 'freq' : 'freqs')}
                {' × '}{powers.length} {powers.length === 1 ? 'power' : 'powers'}
                {attEnabled && attRangeOk && (
                  <>{' × '}{attSteps.length} att ({ATT_STEP_DB} dB steps)</>
                )}
              </>
            ) : ' '}
          </Typography>
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

                <DriveLabel>Go to</DriveLabel>
                <Box sx={PAIR_SX}>
                  <Button
                    variant="outlined" size="small" startIcon={<FirstPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => goMinM.mutate()}
                    disabled={!motorConnected || motorJogBusy || running || travelMin == null}
                    title={travelMin == null ? 'Capture zero first' : undefined}
                    sx={[{ height: DRIVE_H }, hazardRingSx('move')]}
                  >
                    Zero
                  </Button>
                  <Button
                    variant="outlined" size="small" endIcon={<LastPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => goMaxM.mutate()}
                    disabled={!motorConnected || motorJogBusy || running || travelMax == null}
                    title={travelMax == null ? 'Capture end first' : undefined}
                    sx={[{ height: DRIVE_H }, hazardRingSx('move')]}
                  >
                    End
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
            action={totalPoints > 0 && (
              <Typography sx={{ ...TEXT.hint, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                <Box component="b" sx={{ color: 'text.primary' }}>{totalPoints}</Box> points over {fmt(Math.abs(mm((endPulses ?? 0) - (zeroPulses ?? 0))), 2)} mm
                {' · '}
                {runEta ? formatRunTiming(runEta) : `≈ ${formatDuration(estimatedRunMs)}`}
              </Typography>
            )}
          >
            <Box sx={FORM_SX}>
              <BoundRow
                label="Zero"
                value={zeroPulses}
                onCapture={() => setZeroPulses(motorPos)}
                onClear={() => setZeroPulses(null)}
                captureDisabled={motorPos == null || running}
                clearDisabled={running}
              />
              <BoundRow
                label="End"
                value={endPulses}
                onCapture={() => setEndPulses(motorPos)}
                onClear={() => setEndPulses(null)}
                captureDisabled={motorPos == null || running}
                clearDisabled={running}
              />

              <DriveLabel>Delta X</DriveLabel>
              <TextField
                size="small"
                type="number"
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
                onClick={() => { setResults([]); setImportedName(null); runTimesRef.current = null }}
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

          {/* One height, whatever is in it. `maxHeight` let the panel grow with
              the first rows and collapse again on Clear, so everything below —
              and the page's scroll position — moved on its own. */}
          {/* No "no data yet" line: the table itself, header and an empty
              body, so the panel looks the same before the first row as after. */}
          {(
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
                  {/* Set and Att wide enough for "Set [dBm]", "Att [dB]" and
                      "Power [dBm]" whole;
                      the room comes from Status, which holds "ok". */}
                  <col style={{ width: 40 }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <HeadCell label="#" numeric />
                    <HeadCell label="Pos" unit="mm" numeric />
                    {/* A row is only identified by position, frequency and
                        power together now that a run sweeps all three. */}
                    <HeadCell label="Freq" unit="MHz" numeric />
                    <HeadCell label="Set" unit="dBm" numeric />
                    <HeadCell label="Att" unit="dB" numeric />
                    <HeadCell label="Power" unit="dBm" numeric />
                    <HeadCell label="CC" unit="mA" numeric />
                    <HeadCell label="R" unit="Ω" numeric />
                    <HeadCell label="X" unit="Ω" numeric />
                    <HeadCell label="S11" unit="dB" numeric />
                    <HeadCell label="VSWR" numeric />
                    <HeadCell label="Status" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r, i) => {
                    // Judged on the raw reading. Older rows have none, so the
                    // correction is undone with the loss for that row's own
                    // frequency -- exact for anything this app measured, and
                    // the best available for a file imported from elsewhere.
                    const raw = r.power_dbm_raw
                      ?? (r.power_dbm == null ? null : r.power_dbm - lossAt(r.freq_mhz).db)
                    const confidence = powerConfidence(raw)
                    return (
                    <TableRow key={i}>
                      <TableCell sx={NUM_CELL_SX}>{i + 1}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.pos_mm, 2)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.freq_mhz ?? null, 2)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.power_dbm_setting ?? null, 0)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.att_db ?? null, 0)}</TableCell>
                      <TableCell
                        sx={{
                          ...NUM_CELL_SX,
                          color: confidenceColor(confidence),
                          fontWeight: confidence === 'ok' ? undefined : 600,
                        }}
                      >
                        {fmt(r.power_dbm, 2)}
                      </TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.r_ohm, 2)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.x_ohm, 2)}</TableCell>
                      <TableCell sx={NUM_CELL_SX}>{fmt(r.s11_db, 2)}</TableCell>
                      {/* Derived from the point's own S11, not stored on it, so
                          an imported file shows one whether or not it was
                          exported with the column. */}
                      <TableCell sx={NUM_CELL_SX}>{vswrLabel(r)}</TableCell>
                      {/* The numeric cells' type and baseline, left-aligned,
                          so "ok" sits on the same line as the figures beside
                          it. One line like them: a long error is cut with an
                          ellipsis and given in full on hover. */}
                      <TableCell
                        title={r.error ?? undefined}
                        sx={{
                          ...NUM_CELL_SX, textAlign: 'left', verticalAlign: 'middle',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {r.error
                          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
                          : <Box component="span" sx={{ color: 'text.secondary' }}>ok</Box>}
                      </TableCell>
                    </TableRow>
                    )
                  })}
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
        keepToolbar={running}
      />
      <SetupDiagramModal open={setupOpen} onClose={() => setSetupOpen(false)} keepToolbar={running} />

      {attPrompt.dialog}
      {preflight.dialog}
      {isLte && modem.dialog}
    </Box>
  )
}
