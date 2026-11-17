import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Divider, IconButton, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import UploadIcon from '@mui/icons-material/UploadRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import { useMutation } from '@tanstack/react-query'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { useNotify } from '../../context/NotifyContext'
import { formatDuration, sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { tallyVerdicts, verdictOf } from '../../lib/verdict'
import {
  DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs,
} from '../../lib/settle'
import {
  scrollBehavior, FollowLatest, useFollowBottom, CONTROL_H, GRID_GAP, MiniAction, Section,
  SegmentedChoice, TEXT, FAIL_ROW_SX, HeadCell, NUM_CELL_SX, VerdictMark, VerdictTally,
  type VerdictFilter,
} from '../../ui'
import { CSV_HEADER, parseBleCwCsv, toCsvBody } from './csv'
import {
  AUTO_TONE_MAX_S, AUTO_TONE_TYPICAL_S, autoToneSeconds, buildPlan, convertChannelSpec,
  estimateRunMs, minToneSeconds, powerChanges, rowIssues, rowPoints, specChannels, stepBudgetMs,
  type PlanPoint,
} from './plan'
import { runSequence } from '../engine/runSequence'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import { TopProgress } from '../../components/TopProgress'
import { usePublishLiveOutput } from '../../context/liveOutput'
import { RunTiming } from '../../ui/RunTiming'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { DURATION_MAX_S, channelMhz, offAirReason } from '../ble/radio'
import type { BleLink } from '../ble/useBleLink'
import {
  bleCwPageSnapshot,
  persistBleCwPage,
  type BleAutomationResultRow,
  type BleAutomationRow,
  type BleChannelUnit,
} from '../../store/bleCwPageStore'
import { selectOnFocus } from '../../lib/selectOnFocus'
import { AddToReport } from '../../components/reports/AddToReport'

type ResultRow = BleAutomationResultRow
type SweepRow = BleAutomationRow

/** Beside the one that reads power, which the panel's power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

/** Blank: auto. Every second of tone past the reading is a second the run
 *  waits per point with the DUT unreachable, so by default the run sizes it
 *  from the measurement itself (`autoToneSeconds`). A number fixes it. */
const DEFAULT_TONE_S = ''

const DEFAULT_ROW: SweepRow = { channel: '0,19,39', power: '31', minDbm: '', maxDbm: '' }

/** See LteAutomationPanel: grows with its rows, then scrolls inside. */
const PANEL_HEIGHT = 250
const PANEL_MIN_HEIGHT = 200

/** One grid template for the header and every row. */
const COLS = '20px minmax(140px, 1fr) minmax(120px, 1fr) 88px 88px 76px 32px'
const MIN_TABLE_W = 600

const BODY_ROW_SX = { '& > td': { verticalAlign: 'middle', lineHeight: '20px' } } as const

/** The wall clock, out of line so it is read when called, not in render. */
const epochNow = (): number => Date.now()

function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    channel: r.channel ?? '',
    power: r.power ?? DEFAULT_ROW.power,
    minDbm: r.minDbm ?? '',
    maxDbm: r.maxDbm ?? '',
  }
}

/** Column heading: name, then a quieter unit beside it. */
function ColHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 13, fontWeight: 500, color: 'text.primary',
        display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {label}
      {hint && (
        <Box component="span" sx={{ ml: 0.5, fontSize: 12, fontWeight: 400, color: 'text.secondary' }}>
          {hint}
        </Box>
      )}
    </Typography>
  )
}

const limitsText = (r: ResultRow): string => {
  if (r.min_dbm == null && r.max_dbm == null) return '—'
  return `${r.min_dbm ?? '…'} – ${r.max_dbm ?? '…'}`
}

const ResultTableRow = memo(function ResultTableRow({ r, i }: { r: ResultRow; i: number }) {
  return (
    <TableRow sx={[BODY_ROW_SX, r.verdict === 'fail' && FAIL_ROW_SX]}>
      <TableCell sx={NUM_CELL_SX}>{i + 1}</TableCell>
      <TableCell sx={NUM_CELL_SX}>{r.channel}</TableCell>
      <TableCell sx={NUM_CELL_SX}>{r.freq_mhz}</TableCell>
      <TableCell sx={NUM_CELL_SX}>{r.power_param}</TableCell>
      <TableCell sx={{ ...NUM_CELL_SX, color: r.verdict === 'fail' ? 'error.main' : undefined }}>
        {fmt(r.measured_dbm, 2)}
      </TableCell>
      <TableCell sx={{ ...NUM_CELL_SX, color: 'text.secondary' }}>{limitsText(r)}</TableCell>
      <TableCell sx={NUM_CELL_SX}>
        {fmt(r.current_a == null ? null : r.current_a * 1000, 1)}
      </TableCell>
      <TableCell>
        <VerdictMark verdict={r.verdict} />
      </TableCell>
      <TableCell sx={{ fontSize: 12 }}>
        {r.error
          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
          : r.ok
            ? <Box component="span" sx={{ color: 'text.secondary' }}>ok</Box>
            : '—'}
      </TableCell>
    </TableRow>
  )
})

function downloadCsv(rows: ResultRow[], mac: string | null): void {
  void saveCsv([...CSV_HEADER], toCsvBody(rows), exportName('ble-cw-automation', mac, 'csv'), {
    test: 'BLE CW automation', dut_mac: mac,
  })
}

function snap(): NonNullable<typeof bleCwPageSnapshot.automation> {
  if (!bleCwPageSnapshot.automation) bleCwPageSnapshot.automation = {}
  return bleCwPageSnapshot.automation
}

/** What the page header needs to drive the run. See LteAutomationPanel. */
export interface AutomationControls {
  running: boolean
  canRun: boolean
  progress: string
  onRun: () => void
  onStop: () => void
  totalPoints: number
  plannedMs: number
  freqsMhz: number[]
}

interface Props {
  /** The DUT's BLE radio, owned by the page -- both tabs drive one radio. */
  link: BleLink
  /** Channel numbers or MHz, page-wide so both tabs agree. */
  unit: BleChannelUnit
  onUnitChange: (u: BleChannelUnit) => void
  /** The manual tab has a tone in flight; a run must not start into it. */
  blocked?: boolean
  onControlsChange?: (c: AutomationControls) => void
}

export function BleAutomationPanel({ link, unit, onUnitChange, blocked, onControlsChange }: Props) {
  const { lossAt, defaultDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const reporter = useRunReporter('BLE CW automation', 'Automation')
  const [powerSrc, setPowerSrc] = useState<PowerSourceState>(() => powerSourceOf(snap().powerSource))
  const sourceOk = powerSourceValid(powerSrc)
  const preflight = useInstrumentPreflight([powerInstrument(powerSrc), ...REQUIRED_INSTRUMENTS])
  const notify = useNotify()

  const [rows, setRows] = useState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    return [unit === 'mhz' ? { ...DEFAULT_ROW, channel: '2402,2440,2480' } : DEFAULT_ROW]
  })
  const [settleMs, setSettleMs] = useState<number>(() => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS))
  const [toneSeconds, setToneSeconds] = useState<string>(() => snap().toneFixedSeconds ?? DEFAULT_TONE_S)
  const [results, setResults] = useState<ResultRow[]>(() => snap().results ?? [])
  const resultsRef = useRef<ResultRow[]>(results)

  useEffect(() => { snap().rows = rows; persistBleCwPage() }, [rows])
  useEffect(() => { snap().settleMs = settleMs; persistBleCwPage() }, [settleMs])
  useEffect(() => { snap().toneFixedSeconds = toneSeconds; persistBleCwPage() }, [toneSeconds])
  useEffect(() => { snap().powerSource = powerSrc; persistBleCwPage() }, [powerSrc])
  useEffect(() => { snap().results = results; persistBleCwPage() }, [results])

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const abortRef = useRef(new AbortController())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const channelRefs = useRef<Array<HTMLInputElement | null>>([])
  const pendingFocusRef = useRef<number | null>(null)
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)
  const uncalibrated = useRef<Set<number>>(new Set())
  const fileInput = useRef<HTMLInputElement | null>(null)

  const importFile = async (f: File) => {
    try {
      const imported = parseBleCwCsv(await f.text())
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

  // Rows are rewritten into the new unit on its rising edge, during render
  // rather than in an effect -- an effect would paint the stale rows, all
  // flagged invalid, for a frame first. Same pattern as LteAutomationPanel.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, channel: convertChannelSpec(r.channel, lastUnit, unit) })))
  }

  const addRow = () => {
    pendingFocusRef.current = rows.length
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, channel: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  // Tone duration: whole seconds, and long enough that the reading lands
  // while the tone is still on air -- one that ends first measures the noise
  // floor and records it as the DUT's power.
  const toneAuto = toneSeconds.trim() === ''
  const toneS = Number(toneSeconds)
  const toneMin = minToneSeconds(settleMs)
  const toneValid = toneAuto
    || (Number.isInteger(toneS) && toneS >= toneMin && toneS <= DURATION_MAX_S)
  /** What the estimate and the step budget assume a point's tone is. */
  const planToneS = toneAuto ? AUTO_TONE_TYPICAL_S : toneS

  const plan = useMemo(() => buildPlan(rows, unit), [rows, unit])
  const totalPoints = plan.length
  const resets = powerChanges(plan)
  const planFreqKey = [...new Set(plan.map((p) => p.freqMhz))].join(',')
  const planFreqs = useMemo(
    () => (planFreqKey ? planFreqKey.split(',').map(Number) : []),
    [planFreqKey],
  )
  const plannedRunMs = toneValid ? estimateRunMs(plan, planToneS) : 0
  const completedPoints = Math.max(0, progressIdx - 1)
  usePublishLiveOutput('run:ble-cw', running ? {
    kind: 'run',
    label: 'Run',
    detail: `BLE CW ${progressIdx}/${totalPoints}`,
    pageId: 'ble-cw',
  } : null)
  // A row with a bad field contributes no points; it blocks the run rather
  // than vanishing from the plan.
  const anyInvalid = rows.some((r) => {
    if (r.channel.trim() === '') return false
    const i = rowIssues(r, unit)
    return !!(i.channel || i.power || i.limits)
  })

  const blankRow = (item: PlanPoint): ResultRow => ({
    channel: item.channel,
    freq_mhz: item.freqMhz,
    power_param: item.power,
    measured_dbm: null,
    measured_dbm_raw: null,
    current_a: null,
    voltage_v: null,
    min_dbm: item.minDbm,
    max_dbm: item.maxDbm,
    verdict: null,
    status: null,
    ok: false,
    error: null,
  })

  /** Set by a point whose DUT did not come back; the next point ends the run. */
  const lostRef = useRef<string | null>(null)
  /** Longest time yet, this run, from a tone's start being sent to its
   *  reading finishing -- what an auto tone is sized from. */
  const slowestWindowRef = useRef<number | null>(null)
  /** The auto tone last used, so a change is reported once, not per point. */
  const lastAutoToneRef = useRef<number | null>(null)

  /**
   * One point: tone on -> settle -> read power/CC -> wait out the tone -> relink.
   *
   * The relink is in `finally` for the same reason the LTE panel's abort is:
   * a failed or stopped point must not leave the next one -- or the operator
   * -- with a DUT that is off the link. It is not abortable: the tone runs to
   * its end whatever we do, so Stop waits for it rather than leaving the DUT
   * stranded mid-tone.
   *
   * Never throws; failures land in the row.
   */
  const measurePoint = async (item: PlanPoint): Promise<ResultRow> => {
    const { signal } = abortRef.current
    const row = blankRow(item)
    if (signal.aborted) return row
    const fHz = item.freqMhz * 1e6
    let started = false
    const pointToneS = toneAuto ? autoToneSeconds(slowestWindowRef.current) : toneS
    if (toneAuto && pointToneS !== lastAutoToneRef.current) {
      const w = slowestWindowRef.current
      reporter.note(w == null
        ? `auto tone: ${pointToneS} s for the first point, until a reading has been timed`
        : `auto tone: ${pointToneS} s per point (slowest reading finished ${(w / 1000).toFixed(1)} s into its tone)`)
      lastAutoToneRef.current = pointToneS
    }
    try {
      const r = await link.tone({ channel: item.channel, duration_s: pointToneS, offset: 0 }, signal)
      started = true
      // Unanswered is the expected shape: the link goes with the tone.
      row.status = r.acknowledged ? r.status : null
      await sleep(settleMs, signal)
      if (signal.aborted) return row
      const pl = lossAt(item.freqMhz)
      const readStart = performance.now()
      const m = await instrumentsApi.measure(fHz, { signal, spectrum: measureSpectrumOf(powerSrc) })
      const readMs = performance.now() - readStart
      row.measured_dbm_raw = m.power_dbm
      row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
      if (!pl.calibrated) uncalibrated.current.add(item.freqMhz)
      row.current_a = m.current_a
      row.voltage_v = m.voltage_v
      row.verdict = verdictOf(row.measured_dbm, item.minDbm, item.maxDbm)
      row.ok = !m.error
      if (m.error) row.error = m.error
      // The numbers stay in the row, so a late read can be seen for what it
      // was, but it is not judged or counted as measured.
      const readEnd = epochNow()
      const until = link.onAirUntil()
      const offAir = offAirReason(readEnd, until, readMs)
      if (offAir) {
        row.ok = false
        row.verdict = null
        row.error = m.error ? `${offAir}; ${m.error}` : offAir
      }
      // Timed from when the start went out, so it covers everything the tone
      // has to outlast: the link release, the settle and the reads.
      if (until != null) {
        const spanMs = readEnd - (until - pointToneS * 1000)
        slowestWindowRef.current = Math.max(slowestWindowRef.current ?? 0, spanMs)
      }
      // On screen now rather than after the reconnect, which is seconds away
      // and changes nothing in the row unless it fails -- then the row is
      // updated with why. Not yet in `resultsRef`: runSequence records the
      // finished row, and drops it if the run is stopped before then.
      setResults([...resultsRef.current, { ...row }])
    } catch (e) {
      row.error = signal.aborted ? null : (e as Error).message
    } finally {
      if (started) {
        try {
          await link.finishTone()
        } catch (e) {
          const message = `DUT did not come back after the tone: ${(e as Error).message}`
          lostRef.current = message
          row.ok = false
          row.error ??= message
        }
      }
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
      lostRef.current = null
      slowestWindowRef.current = null
      lastAutoToneRef.current = null
      setRunning(true)
      setResults([])
      resultsRef.current = []
      setProgressIdx(0)
      uncalibrated.current.clear()
      try {
        await runSequence<PlanPoint, ResultRow>({
          items: plan,
          abort,
          // Outside the step timeout: a power change waits on a reboot, and
          // has its own bound in the relink. A DUT that did not come back from
          // the last point ends the run here, rather than failing every point
          // after it in milliseconds.
          beforeItem: async (item, i) => {
            if (lostRef.current) throw new Error(lostRef.current)
            const prev = i > 0 ? plan[i - 1].power : null
            if (prev === item.power) return
            reporter.note(`tone power ${item.power} — resetting the DUT`)
            // The first power is set even if the page believes the DUT is on
            // it: a run starts from a power it set itself, the way the LTE
            // run power-cycles its modem.
            if (i === 0) await link.setPower(item.power, abort.signal)
            else await link.ensurePower(item.power, abort.signal)
          },
          measure: measurePoint,
          markRowError: (item, _i, message) => ({ ...blankRow(item), error: message }),
          // A tone left on air -- a point abandoned by its timeout -- is
          // waited out, so the run ends with the DUT back on the link.
          after: () => link.finishTone(),
          rowHasError: (r) => !!r.error,
          judge: tallyVerdicts,
          onRows: (next) => { resultsRef.current = next; setResults(next) },
          onProgress: setProgressIdx,
          stepTimeoutMs: stepBudgetMs(toneAuto ? AUTO_TONE_MAX_S : toneS),
          reporter,
        })
      } finally {
        setRunning(false)
        // A point shown early whose run was stopped before it finished is not
        // part of the results; put the table back to what was recorded.
        setResults(resultsRef.current)
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
    abortRef.current.abort()
    // The tone itself cannot be stopped; say so, rather than letting the run
    // look hung while it waits for the DUT to come back.
    const until = link.onAirUntil()
    if (until != null) {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000))
      reporter.note(`stopping — the tone on air cannot be cut short; reconnecting when it ends in ${left} s`, 'warn')
    }
  }, [link, reporter])

  const runMutate = runM.mutate
  const onRun = useCallback(() => { runMutate() }, [runMutate])

  useEffect(() => {
    onControlsChange?.({
      running,
      canRun: totalPoints > 0 && !anyInvalid && sourceOk && toneValid && !blocked && !link.busy,
      progress: `${progressIdx}/${totalPoints}`,
      onRun,
      onStop,
      totalPoints,
      plannedMs: plannedRunMs,
      freqsMhz: planFreqs,
    })
  }, [
    running, totalPoints, anyInvalid, sourceOk, toneValid, blocked, link.busy, progressIdx,
    onRun, onStop, onControlsChange, plannedRunMs, planFreqs,
  ])

  useEffect(() => {
    const idx = pendingFocusRef.current
    if (idx == null) return
    pendingFocusRef.current = null
    channelRefs.current[idx]?.focus()
    const body = bodyRef.current
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: scrollBehavior() })
  }, [rows.length])

  const follow = useFollowBottom(resultsScrollRef, results.length)

  const cellSx = { '& .MuiInputBase-root': { height: CONTROL_H.md } }
  const isChannelUnit = unit === 'channel'

  const syntaxHint = (
    <>
      {isChannelUnit
        ? 'Channel: "22" · "0-39" · "0-39:3" · "0,19,39"'
        : 'MHz: "2446" · "2402-2480:2" · "2402,2440,2480"'}
      <Box component="span" sx={{ ml: 1.5 }}>Power: tone param 6–31, "31" · "6-31:5"</Box>
      <Box component="span" sx={{ ml: 1.5 }}>Min / Max: dBm · blank for no verdict</Box>
    </>
  )
  const syntaxLine = isChannelUnit
    ? 'Channel: "0-39:3" · "0,19,39" · Power: param 6–31 · Min/Max blank = no verdict'
    : 'MHz: "2402-2480:2" · Power: param 6–31 · Min/Max blank = no verdict'

  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const verdictCounts = tallyVerdicts(results)
  const shownVerdict: VerdictFilter = verdictFilter !== 'all' && verdictCounts[verdictFilter as 'pass' | 'fail'] === 0
    ? 'all'
    : verdictFilter

  return (
    <Stack spacing={`${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      <Box
        sx={{
          maxHeight: PANEL_HEIGHT, minHeight: PANEL_MIN_HEIGHT,
          display: 'flex', flexDirection: 'column', flexShrink: 0,
        }}
      >
        <TopProgress
          pct={totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0}
          hidden={!running}
        />
        <Section
          title="Sweep"
          panel
          grow
          action={
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {totalPoints} point{totalPoints === 1 ? '' : 's'}
              </Typography>
              <SegmentedChoice
                value={unit}
                options={[
                  { value: 'channel', label: 'Channel' },
                  { value: 'mhz', label: 'MHz' },
                ]}
                onChange={onUnitChange}
                disabled={running}
              />
              {/* Run-wide: both are about timing, not about the channel. */}
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Settle</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={settleMs}
                  onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
                  onBlur={() => setSettleMs((v) => clampSettleMs(v))}
                  disabled={running}
                  inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
                  sx={{ width: 84, '& .MuiInputBase-root': { height: CONTROL_H.sm } }}
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>ms</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Tone</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={toneSeconds}
                  placeholder="auto"
                  onChange={(e) => setToneSeconds(e.target.value)}
                  onFocus={(e) => { selectOnFocus(e); setFocusKey('tone') }}
                  onBlur={() => setFocusKey((k) => (k === 'tone' ? null : k))}
                  disabled={running}
                  error={!toneValid}
                  inputProps={{ min: toneMin, max: DURATION_MAX_S, step: 1 }}
                  InputProps={{
                    endAdornment: (
                      <ValidationAdornment
                        show={shouldShowValidation(toneSeconds, toneValid, focusKey === 'tone')}
                        message={`Blank for auto, or whole seconds ${toneMin}–${DURATION_MAX_S}: the reading must land inside the tone`}
                      />
                    ),
                  }}
                  sx={{ width: 76, '& .MuiInputBase-root': { height: CONTROL_H.sm } }}
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>s</Typography>
              </Stack>
              <MiniAction startIcon={<AddIcon />} onClick={addRow} disabled={running}>
                Add
              </MiniAction>
            </Stack>
          }
        >
          <Box ref={bodyRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
            <Box sx={{ minWidth: MIN_TABLE_W }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'end', mb: 0.75 }}>
                <Box />
                <ColHead label={isChannelUnit ? 'Channel' : 'Frequency'} hint={isChannelUnit ? '0–39' : 'MHz'} />
                <ColHead label="Power" hint="param" />
                <ColHead label="Min" hint="dBm" />
                <ColHead label="Max" hint="dBm" />
                <Box />
                <Box />
              </Box>

              <Stack spacing={0.75}>
                {rows.map((r, i) => {
                  const issues = rowIssues(r, unit)
                  const steps = rowPoints(r, unit).length
                  const first = specChannels(r.channel, unit)[0]
                  // Shared by every cell of the row. The channel cell passes
                  // its ref inline below, where the focus-on-Add finds it.
                  const fieldProps = (key: keyof SweepRow, issue: string | null, placeholder: string) => ({
                    size: 'small' as const,
                    sx: { ...cellSx, minWidth: 0 },
                    value: r[key],
                    placeholder,
                    disabled: running,
                    error: !!issue,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateRow(i, { [key]: e.target.value }),
                    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { selectOnFocus(e); setFocusKey(`${i}-${key}`) },
                    onBlur: () => setFocusKey((k) => (k === `${i}-${key}` ? null : k)),
                    InputProps: {
                      endAdornment: (
                        <ValidationAdornment
                          show={!!issue && (r[key].trim() !== '' || key === 'power') && focusKey !== `${i}-${key}`}
                          message={issue ?? ''}
                        />
                      ),
                    },
                  })
                  return (
                    <Box key={i} sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right' }}>
                        {i + 1}.
                      </Typography>
                      <TextField
                        {...fieldProps('channel', issues.channel, isChannelUnit ? '0-39 or 0,19,39' : '2402-2480:2')}
                        inputRef={(el: HTMLInputElement | null) => { channelRefs.current[i] = el }}
                      />
                      <TextField {...fieldProps('power', issues.power, '31 or 6-31:5')} />
                      {/* One message for the pair: a limit is only wrong
                          against the other one. */}
                      <TextField type="number" {...fieldProps('minDbm', issues.limits, '—')} />
                      <TextField type="number" {...fieldProps('maxDbm', issues.limits, '—')} />
                      {/* The unit not being typed, so the row states what it
                          resolved to; the count under it. */}
                      <Box sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        <Box sx={{ visibility: first != null ? 'visible' : 'hidden' }}>
                          {first == null ? '—' : isChannelUnit ? `${channelMhz(first)} MHz` : `ch ${first}`}
                        </Box>
                        <Box>{steps} point{steps === 1 ? '' : 's'}</Box>
                      </Box>
                      <Box sx={{ display: 'flex', position: 'sticky', right: 0, zIndex: 1, bgcolor: 'background.paper' }}>
                        <Tooltip title="Remove row">
                          <span>
                            <IconButton
                              size="small"
                              aria-label={`Remove row ${i + 1}`}
                              onClick={() => removeRow(i)}
                              disabled={running}
                            >
                              <DeleteIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
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
            <Tooltip title={syntaxHint} placement="top-start">
              <Typography
                sx={{
                  fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {syntaxLine}
              </Typography>
            </Tooltip>
            {running ? (
              <RunTiming
                running={running}
                completed={completedPoints}
                total={totalPoints}
                plannedTotalMs={plannedRunMs}
                sx={{ flexShrink: 0 }}
              />
            ) : totalPoints > 0 && toneValid && (
              // Every point waits out its tone and a reconnect, and every
              // power a reset, so state the cost before it is paid.
              <Typography sx={{ ...TEXT.micro, whiteSpace: 'nowrap', flexShrink: 0, color: 'text.secondary' }}>
                ≈ {formatDuration(plannedRunMs)} · {resets} reset{resets === 1 ? '' : 's'} · {toneAuto ? `auto tone, ~${planToneS} s` : `${toneS} s tone`} per point
              </Typography>
            )}
          </Stack>
        </Section>
      </Box>

      <Section title="Measure" panel>
        <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} />
      </Section>

      <Section
        title="Results"
        panel
        grow
        action={
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
            <MiniAction
              startIcon={<DownloadIcon />}
              onClick={() => downloadCsv(results, bleStatus?.address ?? null)}
              disabled={results.length === 0}
            >
              Export
            </MiniAction>
            <AddToReport
              disabled={results.length === 0 || running}
              build={() => ({
                test: 'ble-cw-automation', title: 'BLE CW automation',
                settings: [['Settle', `${settleMs} ms`], ['Tone', toneAuto ? 'auto' : `${toneSeconds} s`]],
                columns: [...CSV_HEADER], rows: toCsvBody(results),
              })}
            />
            <MiniAction
              startIcon={<UploadIcon />}
              onClick={() => fileInput.current?.click()}
              disabled={running}
            >
              Import
            </MiniAction>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
            <MiniAction
              tone="destructive"
              startIcon={<DeleteSweepIcon />}
              onClick={() => { resultsRef.current = []; setResults([]) }}
              disabled={results.length === 0 || running}
            >
              Clear
            </MiniAction>
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
            e.target.value = ''
            if (f) void importFile(f)
          }}
        />

        <VerdictTally
          pass={verdictCounts.pass}
          fail={verdictCounts.fail}
          na={results.length - verdictCounts.total}
          measured={results.length}
          planned={running ? totalPoints : undefined}
          filter={shownVerdict}
          onFilter={setVerdictFilter}
        />

        <Box ref={resultsScrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
          <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%', minWidth: 624 }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <TableHead>
              <TableRow>
                <HeadCell label="#" numeric />
                <HeadCell label="Channel" numeric />
                <HeadCell label="Freq" unit="MHz" numeric />
                <HeadCell label="Power" unit="param" numeric />
                <HeadCell label="Measured" unit="dBm" numeric />
                <HeadCell label="Limits" unit="dBm" numeric />
                <HeadCell label="CC" unit="mA" numeric />
                <HeadCell label="Verdict" />
                <HeadCell label="Status" />
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((r, i) => (shownVerdict === 'all' || r.verdict === shownVerdict) && (
                <ResultTableRow key={i} r={r} i={i} />
              ))}
            </TableBody>
          </Table>
          <FollowLatest follow={follow} />
        </Box>
      </Section>

      {preflight.dialog}
    </Stack>
  )
}
