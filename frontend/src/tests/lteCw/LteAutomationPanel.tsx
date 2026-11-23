import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { useState } from 'react'
import { Box, IconButton, Stack, TableCell, TableRow, TextField, Tooltip } from '@mui/material'
import TuneIcon from '@mui/icons-material/FilterListRounded'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import { parseLimit, verdictWithinMargin } from '../../lib/verdict'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch, channelIssues, shortChannelIssue } from '../../lib/earfcn'
import {
  GRID_GAP, Section, SegmentedChoice, FAIL_ROW_SX, HeadCell, NUM_CELL_SX, VerdictMark, deltaText,
} from '../../ui'
import { CSV_HEADER, parseLteCwCsv, toCsvBody } from './csv'
import { ResultsGraphModal, type GraphableRow } from '../power/LazyResultsGraphModal'
import { lteChannelPoint } from '../power/graphSeries'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls, type PointContext } from '../engine/useAutomationRun'
import {
  ColHead, ResultsCard, SettleEstimate, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import { BODY_ROW_SX, CELL_SX, useAddRowFocus } from '../engine/automationLayout'
import type { InstrumentId } from '../../context/InstrumentsContext'
import type { LteCwRequest } from '../../types/models'
import type { LteModem } from '../lte/useLteModem'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  lteCwPageSnapshot,
  persistLteCwPage,
  type LteAutomationResultRow,
  type LteAutomationRow,
} from '../../store/lteCwPageStore'
import type { ChannelUnit } from '../lte/channel'
import { selectOnFocus } from '../../lib/selectOnFocus'

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = LteAutomationResultRow
type SweepRow = LteAutomationRow

/** Instruments every measured point depends on. */
/** Beside the one that reads power, which the panel's power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

/** Budget for the commands + measurement either side of the settle delay. A
 *  point sends two frames rather than one, so this sits above the LoRa figure. */
const STEP_OVERHEAD_TIMEOUT_MS = 40_000

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const MAX_POWER_DBM = 23

/**
 * Per-point transmit duration, fixed rather than configurable.
 *
 * The run aborts each point as soon as it has measured, so this is only ever a
 * backstop: it has to outlast one settle plus a reading, and beyond that a
 * larger number just means a longer stuck transmission if an abort is ever
 * missed. 20 s clears a point many times over.
 */
const CW_TIME_MS = 20_000

/**
 * Offset from the channel centre, fixed at the centre.
 *
 * A sweep is about power against channel; moving the tone off centre as well
 * would leave every reading asking which of the two it was measuring. The
 * manual tab still exposes it.
 */
const CW_OFFSET_HZ = 0

const DEFAULT_POWER = '23'

/** The modem power-cycle at the start of a run; see `useLteModem.cycle`. */
const MODEM_RESTART_MS = 10_000

/**
 * Most channels a spec is rewritten across on a unit switch.
 *
 * Conversion is exact — every value is resolved and re-emitted as a comma
 * list, so the set of channels is unchanged — but a 200-channel sweep would
 * become an unreadable wall of text. Past this the spec is left alone and the
 * row asks to be re-entered in the new unit.
 */
const MAX_CONVERT = 32

/**
 * Sweep table columns.
 *
 * The range-spec columns flex and the readout stays fixed, so the table fills
 * the panel without every input becoming the same width.
 */
// Tolerance a fixed 80 and the readout two lines in 76, the same as LTE
// Modulated, so the two LTE sweeps line up column for column.
// Tolerance is 104 px: its heading, "Tolerance ± dB", has to fit whole --
// at 80 it was cut to "Tolerance ±…".
const COLS = '20px minmax(140px, 1fr) minmax(140px, 1fr) 104px 76px 32px'
const MIN_TABLE_W = 552

/**
 * Results table columns: shares of a table at least 624 px wide. Each
 * column's floor is its heading or its widest value, so a heading such as
 * "Measured [dBm]" is never cut; narrower than that, the table scrolls
 * sideways instead.
 */
const RESULT_MIN_W = 624
const RESULT_COLS = [40, '10.62%', '13.12%', '11.88%', '17.5%', '9.38%', '10.62%', '12.5%', '9.38%']

const DEFAULT_ROW: SweepRow = { earfcn: '', power: DEFAULT_POWER, marginDb: '1' }

/** Fill in a row read back from storage. Snapshots written before the
 *  tolerance moved onto the row hold only the channel and power. */
function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    earfcn: r.earfcn ?? '',
    power: r.power ?? DEFAULT_POWER,
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
  earfcn: number
  band: number
  freqMhz: number
  pow: number
  /** Tolerance in dB around `pow`, or null when this row is not judged. */
  marginDb: number | null
}

/**
 * Rewrite a channel spec into the other unit.
 *
 * Switching units used to leave every row holding a number that meant
 * nothing in the new one, so the whole list lit up red before the operator
 * had typed anything. Converting keeps the channels they picked.
 *
 * Returns the spec untouched if any value cannot be resolved: a
 * half-converted list would be worse than one the operator can see is stale.
 */
function convertSpec(spec: string, from: ChannelUnit, to: ChannelUnit, bands: number[]): string {
  if (from === to || spec.trim() === '') return spec
  const nums = parseRangeSpec(spec)
  if (nums.length === 0 || nums.length > MAX_CONVERT) return spec
  const out: number[] = []
  for (const n of nums) {
    if (from === 'earfcn') {
      const ch = uplinkFromEarfcn(n)
      if (!ch) return spec
      out.push(ch.freqHz / 1e6)
    } else {
      const hits = uplinkFromMhz(n, bands)
      if (hits.length !== 1) return spec
      out.push(hits[0].earfcn)
    }
  }
  return out.join(',')
}

/**
 * Channels a spec names, read in whichever unit is selected.
 *
 * Values that resolve to nothing are dropped, as are MHz values covered by
 * more than one selected band — the row editor counts the gap and flags it,
 * rather than this quietly picking a band on the operator's behalf.
 */
function toChannels(spec: string, unit: ChannelUnit, bands: number[]): UplinkMatch[] {
  const nums = parseRangeSpec(spec)
  if (unit === 'earfcn') {
    return nums.flatMap((n) => {
      if (!Number.isInteger(n) || n < 0) return []
      const ch = uplinkFromEarfcn(n)
      return ch ? [{ ...ch, earfcn: n }] : []
    })
  }
  return nums.flatMap((m) => {
    const hits = uplinkFromMhz(m, bands)
    return hits.length === 1 ? hits : []
  })
}

/**
 * Points one row expands to.
 *
 * Channels outside the band table are dropped rather than run. The point of
 * an automation run is the measurement, and without a frequency there is
 * nothing to calibrate the sensor to or to pick a path-loss figure with — a
 * row of numbers measured against the wrong channel is worse than a row that
 * was never taken. The editor flags them so it is a config error, not a
 * surprise forty points in.
 */
function rowPoints(r: SweepRow, unit: ChannelUnit, bands: number[]): PlanPoint[] {
  const channels = toChannels(r.earfcn, unit, bands)
  if (channels.length === 0 || !marginValid(r)) return []
  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
    .filter((p) => p >= 0 && p <= MAX_POWER_DBM)
  const margin = parseLimit(r.marginDb)
  const out: PlanPoint[] = []
  for (const ch of channels) {
    for (const p of powers) {
      out.push({
        earfcn: ch.earfcn,
        band: ch.band,
        freqMhz: ch.freqHz / 1e6,
        pow: p,
        marginDb: margin,
      })
    }
  }
  return out
}

const blankRow = (item: PlanPoint): ResultRow => ({
  earfcn: item.earfcn,
  band: item.band,
  freq_mhz: item.freqMhz,
  set_power_dbm: item.pow,
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

const paramsFor = (item: PlanPoint): LteCwRequest => ({
  earfcn: item.earfcn,
  time_ms: CW_TIME_MS,
  tx_power_dbm: item.pow,
  offset_hz: CW_OFFSET_HZ,
})

const renderResultRow = (r: ResultRow, i: number) => (
  <TableRow sx={[BODY_ROW_SX, r.verdict === 'fail' && FAIL_ROW_SX]}>
    <TableCell sx={NUM_CELL_SX}>{i + 1}</TableCell>
    <TableCell sx={NUM_CELL_SX}>{r.earfcn}</TableCell>
    <TableCell sx={NUM_CELL_SX}>
      {r.freq_mhz.toFixed(1)}
      {r.band != null && (
        <Box component="span" sx={{ color: 'text.secondary', ml: 0.5 }}>B{r.band}</Box>
      )}
    </TableCell>
    <TableCell sx={NUM_CELL_SX}>{r.set_power_dbm}</TableCell>
    <TableCell sx={NUM_CELL_SX}>{fmt(r.measured_dbm, 2)}</TableCell>
    {/* Measured minus set: how far the point missed, which the eye
        otherwise has to work out from two columns apart. */}
    <TableCell sx={{ ...NUM_CELL_SX, color: r.verdict === 'fail' ? 'error.main' : undefined }}>
      {deltaText(r.measured_dbm, r.set_power_dbm)}
    </TableCell>
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
          // Neutral: green is PASS's colour, and "ok" only means
          // the point was measured.
          ? <Box component="span" sx={{ color: 'text.secondary' }}>ok</Box>
          : '—'}
    </TableCell>
  </TableRow>
)

/** Graph row, named by band and EARFCN — what the operator typed. */
const toGraphRow = (r: ResultRow): GraphableRow => ({
  ...r, point: lteChannelPoint(r.band, r.earfcn, r.freq_mhz),
})

/** Export the results table. The column list and the row mapping live in
 *  `./csv`, alongside the parser that reads them back. */
function downloadCsv(rows: ResultRow[], mac: string | null): void {
  void saveCsv([...CSV_HEADER], toCsvBody(rows), exportName('lte-cw-automation', mac, 'csv'), {
    test: 'LTE CW automation', dut_mac: mac,
  })
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that LteCwPage owns. */
function snap(): NonNullable<typeof lteCwPageSnapshot.automation> {
  if (!lteCwPageSnapshot.automation) lteCwPageSnapshot.automation = {}
  return lteCwPageSnapshot.automation
}

interface Props {
  /**
   * The modem, owned by the page.
   *
   * Power is page-level rather than per-tab because it is one piece of
   * hardware: if this panel kept its own idea of it, a run would send a
   * MODEM_ON the manual tab had already sent, and the modem refuses that.
   */
  modem: LteModem
  /** Whether the channel column is read as EARFCNs or MHz. Page-level, so
   *  both tabs agree on what a number in a channel field means. */
  unit: ChannelUnit
  /** Bands a MHz value is allowed to resolve within. */
  bands: number[]
  onUnitChange: (u: ChannelUnit) => void
  onEditBands: () => void
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
}

export function LteAutomationPanel({
  modem, unit, bands, onUnitChange, onEditBands, onControlsChange,
}: Props) {
  const { lossAt } = usePathLoss()
  const { status: bleStatus } = useConnection()
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  // What reads power for the sweep: the sensor, or the spectrum analyzer at
  // this panel's own settings (lib/powerSource.ts).
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => powerSourceOf(snap().powerSource),
    (v) => { snap().powerSource = v; persistLteCwPage() },
  )
  const sourceOk = powerSourceValid(powerSrc)
  const preflight = useInstrumentPreflight([powerInstrument(powerSrc), ...REQUIRED_INSTRUMENTS])

  const [rows, setRows] = useSnapshotState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    // The starting row follows the unit the panel opens in — the same channel
    // either way round, so a page reopening in MHz does not greet the operator
    // with an EARFCN flagged invalid.
    return [{ ...DEFAULT_ROW, earfcn: unit === 'mhz' ? '1880' : '18900' }]
  }, (v) => { snap().rows = v; persistLteCwPage() })
  // Clamped on read: a snapshot saved before the floor existed can hold a
  // value below it, and restoring one would reintroduce the bad readings.
  const [settleMs, setSettleMs] = useSnapshotState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
    (v) => { snap().settleMs = v; persistLteCwPage() },
  )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const addFocus = useAddRowFocus(rows.length)

  // Convert during render on the unit's rising edge rather than in an effect.
  // React's documented way to adjust state when a prop changes; an effect would
  // paint the stale rows — all flagged invalid — for a frame first. Same
  // pattern as PathLossModal's open→ edge.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, earfcn: convertSpec(r.earfcn, lastUnit, unit, bands) })))
  }

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects. The new row copies
    // the last one's power and tolerance: adding a channel to an existing
    // sweep is far more common than starting a different kind of measurement.
    addFocus.request(rows.length)
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, earfcn: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const plan: PlanPoint[] = rows.flatMap((r) => rowPoints(r, unit, bands))
  // Settle dominates; the two commands + measure round trips add roughly 400 ms.
  const estimatedRunMs = plan.length * (settleMs + 400)
  // The run power-cycles the modem before its first point, inside the
  // running window, so the countdown has to allow for it too.
  const plannedRunMs = estimatedRunMs + MODEM_RESTART_MS
  // A row with a bad tolerance contributes no points, so it would otherwise
  // vanish from the plan silently rather than blocking the run.
  const anyInvalid = rows.some((r) => r.earfcn.trim() !== '' && !marginValid(r))

  /**
   * One point: CW on → settle → read power/CC → abort.
   *
   * The abort is not just tidiness. The modem takes one test at a time and
   * drops a START that arrives while another is running, so without it every
   * point after the first would silently measure the first point's channel.
   * It runs in `finally` for the same reason the LoRa panel stops the PA there
   * — a failed point must not leave the DUT transmitting into the next one.
   *
   * Never throws; failures land in the row.
   */
  const measurePoint = async (item: PlanPoint, { signal, noteUncalibrated }: PointContext<ResultRow>) => {
    const row = blankRow(item)
    if (signal.aborted) return row
    const params = paramsFor(item)
    const fHz = Math.round(item.freqMhz * 1e6)
    try {
      const tx = await device.lteCw({ ...params, start: true }, { signal })
      row.ok = tx.ok
      row.status = tx.status
      if (!tx.ok) {
        row.error = `tx status=${tx.status}`
      } else {
        modem.setRunning({
          label: 'CW',
          abort: () => device.lteCw({ ...params, start: false }),
        })
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        // The analyzer is ranged to this point's power as it arrives after
        // the cable; the sensor ignores it.
        const m = await instrumentsApi.measure(fHz, {
          signal, spectrum: measureSpectrumOf(powerSrc), expectedDbm: item.pow - lossAt(item.freqMhz).db,
        })
        row.measured_dbm_raw = m.power_dbm
        // Looked up per point: a run sweeps channels, so a single figure would
        // be right for at most one of them.
        const pl = lossAt(item.freqMhz)
        row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
        if (!pl.calibrated) noteUncalibrated(item.freqMhz)
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
      try {
        await device.lteCw({ ...params, start: false })
        modem.setRunning(null)
      } catch { /* reported by the end-of-run abort */ }
    }
    return row
  }

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'LTE CW automation',
    // The id is this page's registry id.
    live: { id: 'run:lte-cw', detail: 'LTE CW', pageId: 'lte-cw' },
    loadResults: () => snap().results ?? [],
    saveResults: (v) => { snap().results = v; persistLteCwPage() },
    plan,
    freqMhz: (p) => p.freqMhz,
    formatFreq: (f) => f.toFixed(1),
    plannedMs: plannedRunMs,
    ready: !anyInvalid && sourceOk,
    preflight,
    blankRow,
    measure: measurePoint,
    stepTimeoutMs: settleMs + STEP_OVERHEAD_TIMEOUT_MS,
    // Once for the whole run, not per point: the boot is ~10 s and every
    // point after the first would pay it for nothing. Cycling rather
    // than skipping when the modem looks up means the sweep starts from
    // a modem in a known state, with nothing left running on it.
    before: async ({ reporter }) => {
      reporter.note('restarting the modem')
      await modem.cycle()
    },
    // Modem power is left as it was found: the key is the only thing that
    // powers it down, so a run does not silently undo it.
    after: async () => {
      const live = modem.getRunning()
      if (!live) return
      try { await live.abort() } catch { /* ignore */ }
      modem.setRunning(null)
    },
    // Independently tell the DUT to stop transmitting — the abort only ends our
    // side of the conversation. The modem is left powered, as everywhere else
    // on this page.
    onStop: (reporter) => {
      const live = modem.getRunning()
      if (live) {
        void live.abort()
          .then(() => modem.setRunning(null))
          .catch((e: Error) => reporter.note(`abort failed: ${e.message}`, 'error'))
      }
    },
    parseCsv: parseLteCwCsv,
    onControlsChange,
  })
  const { results, running } = run
  const isEarfcn = unit === 'earfcn'

  // The range-spec syntax under the table. Built once for both the footer
  // line and its tooltip, which shows it whole when the line is cut short.
  const syntaxHint = (
    <>
      {isEarfcn
        ? 'EARFCN / Power: "18900" · "18900-18910" · "18900-18910:5" · "18900,20175"'
        : 'MHz / Power: "1880" · "1850-1910" · "1850-1910:0.5" · "1850,1880,1909.9"'}
      <Box component="span" sx={{ ml: 1.5 }}>
        Tolerance: within ± dB of the set power · blank for no verdict
      </Box>
    </>
  )
  // The line itself, cut down so it fits a 1440 window with the inspector
  // open; the tooltip above still carries every form.
  const syntaxLine = isEarfcn
    ? 'EARFCN / Power: "18900" · "18900-18910:5" · "18900,20175" · Tolerance blank = no verdict'
    : 'MHz / Power: "1880" · "1850-1910:0.5" · "1850,1880" · Tolerance blank = no verdict'

  return (
    <Stack spacing={`${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      <SweepCard
        running={running}
        totalPoints={run.totalPoints}
        completedPoints={run.completedPoints}
        plannedRunMs={plannedRunMs}
        controls={<>
          <SegmentedChoice
            value={unit}
            options={[
              { value: 'mhz', label: 'MHz' },
              { value: 'earfcn', label: 'EARFCN' },
            ]}
            onChange={onUnitChange}
            disabled={running}
          />
          <Tooltip title="Bands in use">
            <span>
              <IconButton
                size="small"
                aria-label="Bands in use"
                onClick={onEditBands}
                disabled={running}
              >
                <TuneIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <SettleField value={settleMs} onChange={setSettleMs} disabled={running} />
        </>}
        onAdd={addRow}
        cols={COLS}
        minTableW={MIN_TABLE_W}
        heads={<>
          <ColHead
            label={isEarfcn ? 'EARFCN' : 'Frequency'}
            hint={isEarfcn ? 'uplink' : 'MHz'}
          />
          <ColHead label="Power" hint="dBm" />
          <ColHead label="Tolerance" hint="± dB" />
        </>}
        bodyRef={addFocus.bodyRef}
        syntaxHint={syntaxHint}
        syntaxLine={syntaxLine}
        estimate={run.totalPoints > 0 && (
          <SettleEstimate
            ms={estimatedRunMs} settleMs={settleMs}
            suffix=" · plus ~10 s to restart the modem"
          />
        )}
      >
        {rows.map((r, i) => {
          const parsed = parseRangeSpec(r.earfcn)
          const good = toChannels(r.earfcn, unit, bands)
          // Two different faults, two different messages: nothing
          // parsed at all, versus parsed but not resolvable to a
          // channel — the second is the one worth naming, because the
          // fix is a band setting, not retyping the number.
          const badSpec = r.earfcn.trim() !== '' && parsed.length === 0
          const unresolved = parsed.length > 0 && good.length < parsed.length
          // Each value that does not resolve, named with the bands it
          // is in: "in more than one selected band" left the operator
          // to work out which value, and which bands to untick.
          const issues = unresolved ? channelIssues(parsed, isEarfcn, bands) : []
          const badChannel = badSpec || unresolved
          const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
          const inRange = powers.filter((p) => p >= 0 && p <= MAX_POWER_DBM)
          const badPower = r.power.trim() !== ''
            && (powers.length === 0 || inRange.length < powers.length)
          const badMargin = !marginValid(r)
          const steps = rowPoints(r, unit, bands).length
          const first = good[0] ?? null
          return (
            <SweepRowShell
              key={i} index={i} cols={COLS} points={steps}
              onRemove={() => removeRow(i)} disabled={running}
              readout={
                // Shows whichever unit is *not* being typed, so the row
                // always states the channel it resolved to. Stacked,
                // resolved channel over the count, so the readout fits a
                // narrow column inside the row's 32 px: side by side it
                // needed 108-118 px and pushed the modulated grid past its
                // card. "points" is the heading's word for the same count.
                <Box sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  <Box sx={{ visibility: first ? 'visible' : 'hidden' }}>
                    {first
                      ? (isEarfcn ? `${(first.freqHz / 1e6).toFixed(1)} MHz` : first.earfcn)
                      : '—'}
                  </Box>
                  <Box>{steps} point{steps === 1 ? '' : 's'}</Box>
                </Box>
              }
            >
              <TextField
                size="small" sx={CELL_SX}
                value={r.earfcn}
                onChange={(e) => updateRow(i, { earfcn: e.target.value })}
                inputRef={addFocus.inputRef(i)}
                placeholder={isEarfcn ? '18900 or 18900-18910' : '1880 or 1850-1910'}
                disabled={running}
                error={badChannel}
                onFocus={(e) => { selectOnFocus(e); setFocusKey(`${i}-ch`) }}
                onBlur={() => setFocusKey((k) => (k === `${i}-ch` ? null : k))}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={shouldShowValidation(r.earfcn, !badChannel, focusKey === `${i}-ch`)}
                      message={
                        r.earfcn.trim() === ''
                          ? 'Enter a value'
                          : !unresolved
                            ? 'Not a number, range or list'
                            : shortChannelIssue(issues) || 'Not in the selected bands'
                      }
                    />
                  ),
                }}
              />

              <TextField
                size="small" sx={CELL_SX}
                placeholder="23 or 10-23"
                value={r.power}
                onChange={(e) => updateRow(i, { power: e.target.value })}
                onFocus={(e) => { selectOnFocus(e); setFocusKey(`${i}-power`) }}
                onBlur={() => setFocusKey((k) => (k === `${i}-power` ? null : k))}
                disabled={running}
                error={badPower}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={shouldShowValidation(r.power, !badPower, focusKey === `${i}-power`)}
                      message={`Invalid. Try 23 or 10-23 (max ${MAX_POWER_DBM} dBm)`}
                    />
                  ),
                }}
              />

              {/* No "±" in front of the field: the column heading
                  already says "± dB", and printing it again on every
                  row read as a second, different sign. */}
              <TextField
                size="small" type="number"
                sx={{ ...CELL_SX, minWidth: 0 }}
                value={r.marginDb}
                placeholder="—"
                disabled={running}
                error={badMargin}
                onChange={(e) => updateRow(i, { marginDb: e.target.value })}
                onFocus={selectOnFocus}
                inputProps={{ min: 0, step: 0.5 }}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={badMargin}
                      message="A tolerance in dB, 0 or more, or blank for no verdict"
                    />
                  ),
                }}
              />
            </SweepRowShell>
          )
        })}
      </SweepCard>

      {/* What reads power for the sweep, as the manual tab's Measure
          section has it. Between the plan and its results: it decides
          what every row's power came from. */}
      <Section title="Measure" panel>
        <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} />
      </Section>

      <ResultsCard
        results={results}
        running={running}
        totalPoints={run.totalPoints}
        onGraph={() => setGraphOpen(true)}
        onExport={() => downloadCsv(results, bleStatus?.address ?? null)}
        report={() => ({
          test: 'lte-cw-automation', title: 'LTE CW automation',
          settings: [['Settle', `${settleMs} ms`]],
          columns: [...CSV_HEADER], rows: toCsvBody(results),
        })}
        onImport={(f) => void run.importFile(f)}
        onClear={() => run.replaceResults([])}
        minWidth={RESULT_MIN_W}
        colWidths={RESULT_COLS}
        heads={<>
          <HeadCell label="#" numeric />
          <HeadCell label="EARFCN" numeric />
          <HeadCell label="Freq" unit="MHz" numeric />
          <HeadCell label="Set" unit="dBm" numeric />
          <HeadCell label="Measured" unit="dBm" numeric />
          <HeadCell label="Δ" unit="dB" numeric />
          <HeadCell label="CC" unit="mA" numeric />
          <HeadCell label="Verdict" />
          <HeadCell label="Status" />
        </>}
        renderRow={renderResultRow}
      />

      <ResultsGraphModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        results={results.map(toGraphRow)}
      />
      {preflight.dialog}
    </Stack>
  )
}
