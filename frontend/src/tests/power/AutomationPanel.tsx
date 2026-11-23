import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { useState } from 'react'
import { Box, MenuItem, Stack, TableCell, TableRow, TextField } from '@mui/material'
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
import {
  GRID_GAP, Section, FAIL_ROW_SX, HeadCell, NUM_CELL_SX, VerdictMark, deltaText,
} from '../../ui'
import { CSV_HEADER, PA_MODE_LABEL, parsePowerCsv, toCsvBody } from './csv'
import { ResultsGraphModal, type GraphableRow } from './LazyResultsGraphModal'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls, type PointContext } from '../engine/useAutomationRun'
import {
  ColHead, ResultsCard, SettleEstimate, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import {
  BODY_ROW_SX, CELL_SX, STEP_OVERHEAD_TIMEOUT_MS, useAddRowFocus,
} from '../engine/automationLayout'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  powerPageSnapshot,
  persistPowerPage,
  type AutomationResultRow,
  type AutomationSweepRow,
} from '../../store/powerPageStore'
import { selectOnFocus } from '../../lib/selectOnFocus'

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = AutomationResultRow
type SweepRow = AutomationSweepRow

/** Instruments every measured point depends on. */
/** Beside the one that reads power, which the panel's power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

const PA_AUTO = 2
const DEFAULT_POWER = '14'

/**
 * Sweep table columns.
 *
 * The range-spec columns flex and the pickers stay fixed, so the table fills
 * the panel without the five inputs becoming equal-width — a picker stretched
 * to match a text field reads as a form inflated to fill space.
 */
// 120 px floors on the two spec columns (was 150): the rows then need 600 px,
// which is under what the panel has inside its padding on a 1280 px laptop
// with the log docked, so the sweep does not scroll sideways there. Tolerance
// is one short number, fixed at 80 like the other three sweep pages, and the
// points readout gets 64 for "128 points".
// Tolerance is 104 px: its heading, "Tolerance ± dB", has to fit whole --
// at 80 it was cut to "Tolerance ±…".
const COLS = '20px minmax(120px, 1fr) minmax(120px, 1fr) 116px 104px 64px 32px'
const MIN_TABLE_W = 624

/**
 * Results table columns: shares of a table at least 624 px wide. Each
 * column's floor is its heading or its widest value, so a heading such as
 * "Measured [dBm]" is never cut; narrower than that, the table scrolls
 * sideways instead. Status is "ok" or a short error that wraps, and PA one of
 * three words: their old 19 % and 8 % starved the readings.
 */
const RESULT_COLS = [40, '13.46%', '12.18%', '8.33%', '17.95%', '9.62%', '10.9%', '12.82%', '9.62%']

const DEFAULT_ROW: SweepRow = {
  freq: '',
  power: DEFAULT_POWER,
  paMode: PA_AUTO,
  marginDb: '1',
}

/** Fill in a row read back from storage. Snapshots written before PA mode and
 *  the tolerance moved onto the row hold only freq and power. */
function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    freq: r.freq ?? '',
    power: r.power ?? DEFAULT_POWER,
    paMode: r.paMode ?? PA_AUTO,
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
  freq: number
  pow: number
  paMode: number
  /** Tolerance in dB around `pow`, or null when this row is not judged. */
  marginDb: number | null
}

/** Points one row expands to. An empty power falls back to the default. */
function rowPoints(r: SweepRow): PlanPoint[] {
  const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
  if (freqs.length === 0 || !marginValid(r)) return []
  const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
  const out: PlanPoint[] = []
  for (const f of freqs) {
    for (const p of powers) {
      out.push({ freq: f, pow: p, paMode: r.paMode, marginDb: parseLimit(r.marginDb) })
    }
  }
  return out
}

const blankRow = (item: PlanPoint): ResultRow => ({
  freq_mhz: item.freq,
  set_power_dbm: item.pow,
  pa_mode: item.paMode,
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

const renderResultRow = (r: ResultRow, i: number) => (
  <TableRow sx={[BODY_ROW_SX, r.verdict === 'fail' && FAIL_ROW_SX]}>
    <TableCell sx={NUM_CELL_SX}>{i + 1}</TableCell>
    <TableCell sx={NUM_CELL_SX}>{r.freq_mhz.toFixed(3)}</TableCell>
    <TableCell sx={NUM_CELL_SX}>{r.set_power_dbm}</TableCell>
    <TableCell>{PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode}</TableCell>
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

/** Graph row: PA mode is the only thing besides freq and set power that tells
 *  two points apart, so it names the series. */
const toGraphRow = (r: ResultRow): GraphableRow => ({
  ...r, series: `PA ${PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode}`,
})

/** Export the results table. The column list and the row mapping live in
 *  `./csv`, alongside the parser that reads them back. */
function downloadCsv(rows: ResultRow[], mac: string | null): void {
  void saveCsv([...CSV_HEADER], toCsvBody(rows), exportName('tx-cw-automation', mac, 'csv'), {
    test: 'TX CW automation', dut_mac: mac,
  })
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that PowerPage owns. */
function snap(): NonNullable<typeof powerPageSnapshot.automation> {
  if (!powerPageSnapshot.automation) powerPageSnapshot.automation = {}
  return powerPageSnapshot.automation
}

// The range-spec syntax under the table. Built once for both the footer
// line and its tooltip, which shows it whole when the line is cut short.
const SYNTAX_HINT = (
  <>
    Freq / Power: "915" · "900-930" · "900-930:5" · "902.3,915,927.5"
    <Box component="span" sx={{ ml: 1.5 }}>
      Tolerance: within ± dB of the set power · blank for no verdict
    </Box>
  </>
)
const SYNTAX_LINE = 'Freq / Power: "915" · "900-930" · "900-930:5" · "902.3,915" · Tolerance blank = no verdict'

interface AutomationPanelProps {
  protocol: string
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
}

export function AutomationPanel({ protocol, onControlsChange }: AutomationPanelProps) {
  const { lossAt } = usePathLoss()
  const { status: bleStatus } = useConnection()
  // Every point reads power and current; without these the run completes with
  // a table of blanks.
  // What reads power for the sweep: the sensor, or the spectrum analyzer at
  // this panel's own settings (lib/powerSource.ts).
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => powerSourceOf(snap().powerSource),
    (v) => { snap().powerSource = v; persistPowerPage() },
  )
  const sourceOk = powerSourceValid(powerSrc)
  const preflight = useInstrumentPreflight([powerInstrument(powerSrc), ...REQUIRED_INSTRUMENTS])
  const hasBackend = protocol === 'LoRa'

  const [rows, setRows] = useSnapshotState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    return [
      { ...DEFAULT_ROW, freq: '902.3' },
      { ...DEFAULT_ROW, freq: '915.0' },
      { ...DEFAULT_ROW, freq: '927.5' },
    ]
  }, (v) => { snap().rows = v; persistPowerPage() })
  // Clamped on read: a snapshot saved before the floor existed can hold a
  // value below it, and restoring one would reintroduce the bad readings.
  const [settleMs, setSettleMs] = useSnapshotState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
    (v) => { snap().settleMs = v; persistPowerPage() },
  )
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const addFocus = useAddRowFocus(rows.length)

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects. The new row copies
    // the last one's settings: adding a frequency to an existing sweep is far
    // more common than starting a different kind of measurement.
    addFocus.request(rows.length)
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, freq: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const plan: PlanPoint[] = rows.flatMap(rowPoints)
  // Settle dominates; the command + measure round trips add roughly 300 ms.
  const estimatedRunMs = plan.length * (settleMs + 300)
  // A row with a bad tolerance contributes no points, so it would otherwise
  // vanish from the plan silently rather than blocking the run.
  const anyInvalid = rows.some((r) => r.freq.trim() !== '' && !marginValid(r))

  /**
   * One point: TX on at this (freq, power) → settle → read power/CC → TX off.
   *
   * The DUT is switched off after every point rather than left transmitting
   * into the next one, so each reading starts from the same state and the PA
   * is never keyed between points. Never throws — failures land in the row.
   */
  const measurePoint = async (item: PlanPoint, { signal, noteUncalibrated }: PointContext<ResultRow>) => {
    const fHz = Math.round(item.freq * 1_000_000)
    const row = blankRow(item)
    if (signal.aborted) return row
    try {
      const tx = await device.loraPower(
        { freq_hz: fHz, power_dbm: item.pow, pa_mode: item.paMode },
        { signal },
      )
      row.ok = tx.ok
      row.status = tx.status
      if (!tx.ok) {
        row.error = `tx status=${tx.status}`
      } else {
        await sleep(settleMs, signal)
        if (signal.aborted) return row
        // The analyzer is ranged to this point's power as it arrives after
        // the cable; the sensor ignores it.
        const m = await instrumentsApi.measure(fHz, {
          signal, spectrum: measureSpectrumOf(powerSrc), expectedDbm: item.pow - lossAt(item.freq).db,
        })
        row.measured_dbm_raw = m.power_dbm
        // Looked up per point: an automation run sweeps frequencies, so a
        // single figure would be right for at most one of them.
        const pl = lossAt(item.freq)
        row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
        if (!pl.calibrated) noteUncalibrated(item.freq)
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
      // TX off before the next point — always, including on failure, so a bad
      // point cannot leave the DUT keyed.
      try { await device.stop() } catch { /* reported by the end-of-run stop */ }
    }
    return row
  }

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'TX CW automation',
    // The id is this page's registry id.
    live: { id: 'run:power', detail: 'LoRa CW', pageId: 'power' },
    loadResults: () => snap().results ?? [],
    saveResults: (v) => { snap().results = v; persistPowerPage() },
    plan,
    freqMhz: (p) => p.freq,
    plannedMs: estimatedRunMs,
    ready: !anyInvalid && sourceOk,
    preflight,
    blankRow,
    measure: measurePoint,
    stepTimeoutMs: settleMs + STEP_OVERHEAD_TIMEOUT_MS,
    refuse: () => (hasBackend ? null : 'no backend for this protocol'),
    after: async () => { try { await device.stop() } catch { /* ignore */ } },
    // Independently tell the DUT to stop transmitting — the abort only ends
    // our side of the conversation.
    onStop: (reporter) => {
      if (hasBackend) {
        void device.stop().catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
      }
    },
    parseCsv: parsePowerCsv,
    onControlsChange,
  })
  const { results, running } = run

  return (
    <Stack spacing={`${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      <SweepCard
        running={running}
        totalPoints={run.totalPoints}
        completedPoints={run.completedPoints}
        plannedRunMs={estimatedRunMs}
        controls={<SettleField value={settleMs} onChange={setSettleMs} disabled={running} />}
        onAdd={addRow}
        cols={COLS}
        minTableW={MIN_TABLE_W}
        heads={<>
          <ColHead label="Freq" hint="MHz" />
          <ColHead label="Power" hint="dBm" />
          <ColHead label="PA mode" />
          <ColHead label="Tolerance" hint="± dB" />
        </>}
        bodyRef={addFocus.bodyRef}
        syntaxHint={SYNTAX_HINT}
        syntaxLine={SYNTAX_LINE}
        estimate={run.totalPoints > 0 && <SettleEstimate ms={estimatedRunMs} settleMs={settleMs} />}
      >
        {rows.map((r, i) => {
          const freqs = parseRangeSpec(r.freq).filter((f) => f > 0)
          const badFreq = r.freq.trim() !== '' && freqs.length === 0
          const powers = parseRangeSpec(r.power, Number(DEFAULT_POWER))
          const badPower = r.power.trim() !== '' && powers.length === 0
          const badMargin = !marginValid(r)
          return (
            <SweepRowShell
              key={i} index={i} cols={COLS} points={rowPoints(r).length}
              onRemove={() => removeRow(i)} disabled={running}
            >
              <TextField
                size="small" sx={CELL_SX}
                value={r.freq}
                onChange={(e) => updateRow(i, { freq: e.target.value })}
                inputRef={addFocus.inputRef(i)}
                placeholder="915 or 900-930"
                disabled={running}
                error={badFreq}
                onFocus={(e) => { selectOnFocus(e); setFocusKey(`${i}-freq`) }}
                onBlur={() => setFocusKey((k) => (k === `${i}-freq` ? null : k))}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={shouldShowValidation(r.freq, !badFreq, focusKey === `${i}-freq`)}
                      message={r.freq.trim() === '' ? 'Enter a value' : 'Invalid. Try 915 or 900-930'}
                    />
                  ),
                }}
              />

              <TextField
                size="small" sx={CELL_SX}
                placeholder="14 or 10-20"
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
                      message="Invalid. Try 14 or 10-20"
                    />
                  ),
                }}
              />

              <TextField
                size="small" select sx={CELL_SX}
                value={r.paMode}
                disabled={running}
                onChange={(e) => updateRow(i, { paMode: Number(e.target.value) })}
              >
                {PA_MODE_LABEL.map((label, code) => (
                  <MenuItem key={code} value={code}>{label}</MenuItem>
                ))}
              </TextField>

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
          test: 'tx-cw-automation', title: 'LoRa CW automation',
          settings: [['Settle', `${settleMs} ms`]],
          columns: [...CSV_HEADER], rows: toCsvBody(results),
        })}
        onImport={(f) => void run.importFile(f)}
        onClear={() => run.replaceResults([])}
        minWidth={MIN_TABLE_W}
        colWidths={RESULT_COLS}
        heads={<>
          <HeadCell label="#" numeric />
          <HeadCell label="Freq" unit="MHz" numeric />
          <HeadCell label="Set" unit="dBm" numeric />
          <HeadCell label="PA" />
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
