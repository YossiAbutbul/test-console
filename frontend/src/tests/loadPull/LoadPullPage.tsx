import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, Divider, IconButton, MenuItem, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import FirstPageIcon from '@mui/icons-material/FirstPageRounded'
import LastPageIcon from '@mui/icons-material/LastPageRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded'
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
import { LabeledField } from '../../components/LabeledField'
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
  ACTION_W, CONTROL_H, EmergencyStop, FieldGrid, MONO, PageBody,
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
import { useLteBands, useLteChannelUnit } from '../lte/channel'
import { channelIssues, describeChannelIssues, uplinkFromEarfcn, uplinkFromMhz } from '../../lib/earfcn'
import { SmithChartModal } from './SmithChartModal'
import { RemeasureDialog } from './RemeasureDialog'
import { LoadPullResultsTable } from './ResultsTable'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { planPositions } from './plan'
import { useTromboneJog } from './useTromboneJog'
import { loadPullApi, type LoadPullRunStatus } from '../../api/loadPull'
import { useChatSource } from '../../context/ChatContext'
import { mA } from '../../lib/chatRows'
import { useAttPrompt } from './AttPrompt'
import { parseLoadPullCsv } from './importCsv'
import { SetupDiagramModal } from './SetupDiagramModal'
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

/**
 * The VNA span around each frequency, as a fraction of it either side, sent
 * with the run (vna_half_span_frac on the backend):
 * 1000 MHz is read on a 995-1005 MHz sweep.
 *
 * The run used to read on whatever span the analyzer was left on, often its
 * full range, where the marker snaps to the nearest of a few hundred points --
 * 900.21 MHz answering for 902.3 on a 201-point 3 GHz sweep. Zoomed, the same
 * points sit tens of kHz apart.
 */
const VNA_HALF_SPAN_FRAC = 0.005

/** Plan-key prefix of a one-point remeasure run, which the page keeps out of
 *  the table and the run reports. */
const REMEASURE_KEY = 'remeasure:'

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

/** The attenuator's range. It is set by hand in whole dB. */
const ATT_MAX_LIMIT_DB = 20

/** The attenuator settings a spec names, in the order typed ("20-0:5",
 *  "0-5, 8, 9, 20"), or null while it is empty or names a setting that is
 *  not a whole dB within 0-20. */
function parseAttSpec(text: string): number[] | null {
  const vs = parseRangeSpec(text)
  return vs.length > 0 && vs.every((v) => Number.isInteger(v) && v >= 0 && v <= ATT_MAX_LIMIT_DB)
    ? vs : null
}

/** The spec a snapshot saved before the single field had: its start, stop
 *  and step (or the older Att max, which always started at 0). */
function legacyAttSpec(snap: LoadPullPageSnapshot): string {
  const start = snap.attStartDb ?? 0
  const stop = snap.attStopDb ?? snap.attMaxDb ?? ATT_MAX_LIMIT_DB
  const step = snap.attStepDb ?? 1
  return step === 1 ? `${start}-${stop}` : `${start}-${stop}:${step}`
}

/** One height for every control in the drive column. Four kinds of control —
 *  buttons, a jog pad, a toggle group — at three different sizes read as
 *  unrelated widgets rather than one panel for one motor. */
const DRIVE_H = 32

/** What the Frequency, DUT power and Att values fields accept (see
 *  lib/numericList). Any of them can also mix ranges and values. */
/** Examples of the four forms, in the field's own unit. */
const SPEC_EXAMPLES = {
  mhz: ['915', '900-930', '900-930:5', '902.3, 915'],
  lteMhz: ['1880', '1860-1900', '1860-1900:10', '1860, 1880'],
  earfcn: ['18900', '18700-19100', '18700-19100:100', '18700, 18900'],
  dbm: ['14', '10-20', '10-20:2', '10, 14, 20'],
  lteDbm: ['23', '10-23', '10-23:1', '10, 17, 23'],
  att: ['10', '0-20', '0-20:2', '0-5, 8, 9, 20'],
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
  const [channelUnit] = useLteChannelUnit()
  const [lteBands, setLteBands] = useLteBands()
  const [bandsOpen, setBandsOpen] = useState(false)

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
  // One spec, as Frequency and DUT power take, so a sweep can be a range,
  // a stepped range or any list of settings ("0-5, 8, 9, 20").
  const [attSpec, setAttSpec] = useState<string>(() => snap.attSpec ?? legacyAttSpec(snap))
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
  const [deltaXmm, setDeltaXmm] = useState<number>(() => snap.deltaXmm ?? 1)
  const [jogSpeed, setJogSpeed] = useState<number>(() => snap.jogSpeed ?? 800)
  const [zeroPulses, setZeroPulses] = useState<number | null>(() => snap.zeroPulses ?? null)
  const [endPulses, setEndPulses] = useState<number | null>(() => snap.endPulses ?? null)
  // Starts false every session on purpose: it asserts how the bench is
  // cabled *now*, which is the one precondition nothing here can verify.
  const [pathAck, setPathAck] = useState(false)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => snap.results ?? [])
  // The plan the rows in `results` belong to, or null for none (cleared,
  // imported). See `planKey`.
  const [runKey, setRunKey] = useState<string | null>(() => snap.runKey ?? null)
  // Rows a continued run started with; 0 for a fresh one. For the ETA.
  const [resumeBase, setResumeBase] = useState(0)
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
  useEffect(() => { saveSnapshot(isLte, { attSpec }) }, [attSpec, isLte])
  useEffect(() => {
    if (settleMs != null) { saveSnapshot(isLte, { settleMs }) }
  }, [settleMs, isLte])
  useEffect(() => { saveSnapshot(isLte, { deltaXmm }) }, [deltaXmm, isLte])
  useEffect(() => { saveSnapshot(isLte, { jogSpeed }) }, [jogSpeed, isLte])
  useEffect(() => { saveSnapshot(isLte, { zeroPulses }) }, [zeroPulses, isLte])
  useEffect(() => { saveSnapshot(isLte, { runKey }, true) }, [runKey, isLte])
  useEffect(() => { saveSnapshot(isLte, { endPulses }) }, [endPulses, isLte])

  // One frequency per run, so the correction is decided once.

  // ---------- The run, driven by the backend ----------
  //
  // The loop used to run in this page and died with the tab: twice at ~890
  // points of an attenuator sweep Chrome killed the page mid-run. The backend
  // drives it now (backend/loadpull/runner.py). This page sends the plan,
  // polls the run, copies its rows into the table and answers its attenuator
  // prompts, and a reloaded page picks the run back up on its first poll.
  const radio: 'LoRa' | 'LTE' = isLte ? 'LTE' : 'LoRa'
  const [runStatus, setRunStatus] = useState<LoadPullRunStatus | null>(null)
  /** The backend run, when it is this page's radio. */
  const mine = runStatus?.radio === radio ? runStatus : null
  const running = mine?.state === 'running'
  /** The other Load Pull page's run holds the rig: one run at a time. */
  const otherRunning = runStatus?.state === 'running' && runStatus.radio !== radio
  // Written at once during a run rather than on the debounce, so a tab that
  // crashes or freezes mid-run has every finished row saved for Continue: a
  // frozen page never fires the timer the debounced write waits on.
  useEffect(() => { saveSnapshot(isLte, { results }, running) }, [results, isLte, running])
  // The point in hand, 1-based, as the run controls show it.
  const progressIdx = mine ? mine.completed + (running ? 1 : 0) : 0
  // Replaced per run. Stop aborts it, which cancels in-flight requests and
  // wakes every settle delay immediately.
  const abortRef = useRef(new AbortController())
  const attPrompt = useAttPrompt()
  // Epoch seconds of the run the table holds, for the workbook's Run sheet.
  // Cleared on import and Clear, so a file's rows are never stamped with the
  // timing of whatever run happened to precede them.
  const runTimesRef = useRef<{ started_at: number; finished_at: number | null } | null>(null)
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

  // Trombone status + jog + soft-limit sync + wait-for-idle, all in one hook.
  const {
    motorConnected, motorMoving, motorPos,
    jogDir, jogFocused, setJogFocused,
    startJog, stopJog, onJogKeyDown, onJogKeyUp,
    goMinM, goMaxM, motorJogBusy,
    travelMin, travelMax,
  } = useTromboneJog({
    running, active: !!active, anyRunning: running || otherRunning,
    zeroPulses, endPulses, jogSpeed, abortRef,
  })

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
  const spanM = useMutation({
    mutationFn: async (freqMhz: number) => {
      const { hz, startHz, stopHz } = vnaSpanHz(freqMhz)
      await vna.setFreq(startHz, stopHz)
      await vna.setMarkers([hz])
    },
    onSuccess: (_d, f) => {
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
      for (const { freqMhz, earfcn } of channels) {
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
  // runSequence reports the 1-based point in hand.
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
  if (zeroPulses == null) blockers.push('capture the zero position')
  if (endPulses == null) blockers.push('capture the end position')
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
        : zeroPulses == null || endPulses == null ? 'capture Zero and End' : 'set Delta X',
      targetId: anchor('trombone'),
    },
  ]

  // Poll the run: every second while one is live, every few while this page
  // is on screen (to notice a run started from another tab), and once on
  // mount, so a page reloaded mid-run re-attaches whichever page it lands on.
  const pollMs = running ? 1000 : active ? (otherRunning ? 1000 : 3000) : 0
  const pollStatus = useCallback(async () => {
    try { setRunStatus(await loadPullApi.status()) } catch { /* backend down: keep the last */ }
  }, [])
  useEffect(() => { void pollStatus() }, [pollStatus])
  useEffect(() => {
    if (!pollMs) return
    const id = window.setInterval(() => { void pollStatus() }, pollMs)
    return () => window.clearInterval(id)
  }, [pollMs, pollStatus])

  // Copy new rows into the table -- only for the run these rows belong to
  // (same plan key), and appended after the rows a Continue started from.
  const resultsRef = useRef(results)
  useEffect(() => { resultsRef.current = results }, [results])
  const runRows = mine?.rows ?? 0
  const runBase = mine?.start_index ?? 0
  const runPlanKey = mine?.plan_key ?? null
  useEffect(() => {
    if (runPlanKey == null || runPlanKey !== runKey) return
    const have = resultsRef.current.length - runBase
    if (have < 0 || runRows <= have) return
    let stale = false
    loadPullApi.rows(have)
      .then((rows) => {
        if (stale || rows.length === 0) return
        // Appended only onto the table the request was made from, so two
        // overlapping fetches cannot add the same rows twice.
        setResults((prev) => (prev.length === runBase + have ? [...prev, ...rows] : prev))
      })
      .catch(() => { /* the next poll tries again */ })
    return () => { stale = true }
  }, [runRows, runBase, runPlanKey, runKey])

  // The attenuator prompt: shown once per prompt the run raises, answered back.
  // One answered from another tab disappears from the status, and this copy
  // closes; the stale answer it posts is ignored by the backend.
  const promptSeqRef = useRef(0)
  const prompt = mine?.att_prompt ?? null
  const promptSeq = prompt?.seq ?? 0
  useEffect(() => {
    if (!prompt) {
      if (promptSeqRef.current) attPrompt.cancel()
      return
    }
    if (prompt.seq === promptSeqRef.current) return
    promptSeqRef.current = prompt.seq
    const seq = prompt.seq
    void attPrompt.ask(prompt.db, prompt.cycle, prompt.cycles, prompt.upcoming ?? []).then((a) => {
      if (a.db != null) log('LoadPull', `attenuator set to ${a.db} dB (asked ${prompt.db} dB)`)
      loadPullApi.answerPrompt(seq, a.proceed, a.db)
        .then(setRunStatus)
        .catch((e: Error) => reporter.note(`could not answer the attenuator prompt: ${e.message}`, 'error'))
    })
  }, [promptSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  // Report the end of a run once, whichever way it ended.
  const lastStateRef = useRef<string | null>(null)
  const runState = mine?.state ?? null
  useEffect(() => {
    const prev = lastStateRef.current
    lastStateRef.current = runState
    if (prev !== 'running' || runState === 'running' || !mine) return
    // A remeasure reports in its own dialog, not as a run finishing.
    if (mine.plan_key?.startsWith(REMEASURE_KEY)) return
    if (runTimesRef.current) {
      runTimesRef.current.finished_at = mine.finished_at ?? Date.now() / 1000
    }
    // Points jumped over at the attenuator prompt were never going to be
    // measured, so they are not "of" the total either.
    const summary = {
      completed: mine.rows, total: mine.total - mine.start_index - (mine.skipped ?? 0), errors: mine.errors,
    }
    if (runState === 'done') reporter.finished(summary)
    else if (runState === 'cancelled') {
      reporter.stopped(summary)
      if (mine.error) reporter.note(mine.error, 'warn')
    } else if (runState === 'error') reporter.failed(mine.error ?? 'run failed')
  }, [runState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Remeasure: one saved point taken again, from the Smith chart. It runs as
  // a one-point run on the backend, so the move, VNA read, attenuator prompt,
  // Stop and E-STOP all behave as in a run; its own plan key keeps its row
  // out of the table until Use new puts it in place of the old one.
  const [remeasureIdx, setRemeasureIdx] = useState<number | null>(null)
  const [remeasureFresh, setRemeasureFresh] = useState<LoadPullResultRow | null>(null)
  const [remeasureErr, setRemeasureErr] = useState<string | null>(null)
  const [remeasureKey, setRemeasureKey] = useState<string | null>(null)
  const openRemeasure = useCallback((idx: number) => {
    setRemeasureIdx(idx)
    setRemeasureFresh(null)
    setRemeasureErr(null)
  }, [])
  const remeasureRow = remeasureIdx != null ? results[remeasureIdx] ?? null : null
  const remeasuring = running && remeasureKey != null && mine?.plan_key === remeasureKey
  const remeasureBlocked = otherRunning ? `The ${isLte ? 'LoRa' : 'LTE'} Load Pull run is going`
    : running && !remeasuring ? 'A run is going'
      : !dutConnected ? 'Connect the DUT over BLE first'
        : !pathAck ? 'Confirm the RF path first'
          : settleMs == null ? `Set the settle (min ${MIN_SETTLE_MS} ms) first`
            : null
  const remeasureM = useMutation({
    mutationFn: async (idx: number) => {
      const r = results[idx]
      if (!r || r.freq_mhz == null || r.power_dbm_setting == null) throw new Error('this row has no settings to remeasure at')
      if (!(await preflight.run())) throw new Error('cancelled, instruments not ready')
      // The row's own settings, not today's plan: the fields may have
      // changed since it was taken. Settle and PA mode are the page's now.
      const key = `${REMEASURE_KEY}${idx}:${Date.now()}`
      const l = lossAt(r.freq_mhz)
      const status = await loadPullApi.start({
        radio,
        points: [{
          pos: r.pos_pulses, freq_mhz: r.freq_mhz, earfcn: r.earfcn ?? null,
          power_dbm: r.power_dbm_setting, att_db: r.att_db ?? null,
        }],
        start_index: 0,
        settle_ms: settleEffectiveMs,
        ...(isLte ? {} : { pa_mode: paMode }),
        path_loss: [{ freq_mhz: r.freq_mhz, db: l.db, calibrated: l.calibrated }],
        vna_half_span_frac: VNA_HALF_SPAN_FRAC,
        plan_key: key,
      })
      promptSeqRef.current = 0
      lastStateRef.current = 'running'
      setRemeasureKey(key)
      setRemeasureFresh(null)
      setRemeasureErr(null)
      setRunStatus(status)
      log('LoadPull', `remeasuring point #${idx + 1}`)
    },
    onError: (e: Error) => setRemeasureErr(e.message),
  })
  // Its reading, once the one-point run has ended.
  const remeasureState = remeasureKey != null && mine?.plan_key === remeasureKey ? mine.state : null
  useEffect(() => {
    if (!remeasureKey || !remeasureState || remeasureState === 'running') return
    setRemeasureKey(null)
    if (remeasureState !== 'done') {
      setRemeasureErr(remeasureState === 'cancelled' ? (mine?.error ?? 'Stopped') : (mine?.error ?? 'Remeasure failed'))
      return
    }
    loadPullApi.rows(0)
      .then((rows) => {
        if (rows[0]) setRemeasureFresh(rows[0])
        else setRemeasureErr('No reading came back')
      })
      .catch((e: Error) => setRemeasureErr(`could not fetch the reading: ${e.message}`))
  }, [remeasureState]) // eslint-disable-line react-hooks/exhaustive-deps
  const takeRemeasured = () => {
    if (remeasureIdx == null || !remeasureFresh) return
    const idx = remeasureIdx
    const fresh = remeasureFresh
    setResults((prev) => prev.map((r, i) => (i === idx ? fresh : r)))
    log('LoadPull', `point #${idx + 1} replaced with its remeasurement`)
    setRemeasureIdx(null)
  }
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
      promptSeqRef.current = 0
      lastStateRef.current = 'running'
      setRunStatus(status)
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
            <Tooltip title={<SpecTip examples={SPEC_EXAMPLES.att} />} placement="top-start">
              <Box>
                <LabeledField
                  label="Att values" hint={`dB · 0–${ATT_MAX_LIMIT_DB}`} value={attSpec}
                  onChange={(e) => setAttSpec(e.target.value)}
                  disabled={running || !attEnabled}
                  error={attEnabled && !attRangeOk}
                  placeholder="0-20, 0-20:2 or 0-5, 8, 20"
                />
              </Box>
            </Tooltip>
          </FieldGrid>
          {/* The plan multiplies out fast — three positions of a 30-point
              trombone sweep across four powers is 360 points — so say what it
              is a product of next to the fields that decide it. The total is
              on the Plan tile and beside Delta X; this line is only the
              factors. Always one line tall, so the card does not grow when
              the plan becomes complete. */}
          {/* LTE: the same line names any channel the selected bands cannot
              resolve, and carries Edit bands, so the band list can be fixed
              here rather than only on the LTE CW page. One line either way,
              cut with an ellipsis, so the card keeps its height. */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, minHeight: isLte ? 26 : 18 }}>
          {channelProblems.length > 0 ? (
            <Typography
              title={`Not in bands ${lteBands.join(', ')}: ${channelProblems.join('; ')}`}
              sx={{ ...TEXT.micro, color: 'warning.main', flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              Not in bands {lteBands.join(', ')}: {channelProblems.join(' · ')}
            </Typography>
          ) : (
          <Typography sx={{ ...TEXT.micro, color: 'text.secondary', flexGrow: 1, minWidth: 0 }}>
            {positions.length > 0 && freqs.length > 0 && powers.length > 0 ? (
              <>
                {positions.length} {positions.length === 1 ? 'position' : 'positions'}
                {' × '}{freqs.length} {isLte ? (freqs.length === 1 ? 'channel' : 'channels') : (freqs.length === 1 ? 'freq' : 'freqs')}
                {' × '}{powers.length} {powers.length === 1 ? 'power' : 'powers'}
                {attEnabled && attRangeOk && (
                  <>{' × '}{attSteps.length} att</>
                )}
              </>
            ) : ' '}
          </Typography>
          )}
          {isLte && (
            <MiniAction onClick={() => setBandsOpen(true)} disabled={running}>
              Edit bands
            </MiniAction>
          )}
          </Stack>
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

          <LoadPullResultsTable results={results} lossAt={lossAt} />
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
      <SetupDiagramModal open={setupOpen} onClose={() => setSetupOpen(false)} keepToolbar={running} />

      {attPrompt.dialog}
      {preflight.dialog}
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
