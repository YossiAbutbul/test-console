import { PowerSourceFields } from '../../components/PowerSourceFields'
import type { PowerSourceState } from '../../lib/powerSource'
import { useState } from 'react'
import { Box, MenuItem, Stack, TableCell, TableRow, TextField } from '@mui/material'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { useConnection } from '../../context/ConnectionContext'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import {
  GRID_GAP, Section, FAIL_ROW_SX, HeadCell, NUM_CELL_SX, VerdictMark, deltaText,
} from '../../ui'
import { CSV_HEADER, PA_MODE_LABEL, parsePowerCsv, toCsvBody } from './csv'
import { ResultsGraphModal, type GraphableRow } from './LazyResultsGraphModal'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls } from '../engine/useAutomationRun'
import {
  ColHead, ResultsCard, SettleEstimate, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import { BODY_ROW_SX, CELL_SX, EDITOR_GAP, useAddRowFocus } from '../engine/automationLayout'
import { wireStep, type SweepSettingsStore } from '../engine/sweepTest'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  powerPageSnapshot,
  persistPowerPage,
  type AutomationResultRow,
  type AutomationSweepRow,
} from '../../store/powerPageStore'
import { selectOnFocus } from '../../lib/selectOnFocus'
import {
  DEFAULT_POWER, DEFAULT_ROW, loraCwTest, marginValid, rowPoints,
  type LoraCwRaw, type LoraCwSettings, type PlanPoint,
} from './sweepTest'

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = AutomationResultRow
type SweepRow = AutomationSweepRow

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

const PAGE_STORE: SweepSettingsStore<LoraCwRaw> = { snap, persist: persistPowerPage }

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
  /** Settings to edit in place of the page's own (a Full Run step). */
  store?: SweepSettingsStore<LoraCwRaw>
  /** Only the settings: no results, nothing to run from here. */
  editor?: boolean
  /** As an editor, which half to show: the sweep or what measures it. */
  editorView?: 'sweep' | 'measure'
}

export function AutomationPanel({
  protocol, onControlsChange, store = PAGE_STORE, editor = false, editorView = 'sweep',
}: AutomationPanelProps) {
  const { status: bleStatus } = useConnection()
  // The stored settings, resolved once for the starting values below: rows
  // filled in, settle clamped, the power source -- the sensor, or the
  // spectrum analyzer at this panel's own settings (lib/powerSource.ts).
  const [initial] = useState(() => loraCwTest.resolve(store.snap()))
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => initial.powerSrc,
    (v) => { store.snap().powerSource = v; store.persist() },
  )
  const hasBackend = protocol === 'LoRa'

  const [rows, setRows] = useSnapshotState<SweepRow[]>(
    () => initial.rows,
    (v) => { store.snap().rows = v; store.persist() },
  )
  const [settleMs, setSettleMs] = useSnapshotState<number>(
    () => initial.settleMs,
    (v) => { store.snap().settleMs = v; store.persist() },
  )
  const settings: LoraCwSettings = { rows, settleMs, powerSrc }
  const preflight = useInstrumentPreflight(loraCwTest.instruments(settings))
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

  const plan: PlanPoint[] = loraCwTest.plan(settings)
  const estimatedRunMs = loraCwTest.estimateMs(settings, plan)

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'TX CW automation',
    // The id is this page's registry id.
    live: { id: 'run:power', detail: 'LoRa CW', pageId: 'power' },
    loadResults: () => (editor ? [] : snap().results ?? []),
    saveResults: (v) => { if (!editor) { snap().results = v; persistPowerPage() } },
    plan,
    freqMhz: loraCwTest.freqMhz,
    plannedMs: estimatedRunMs,
    ready: loraCwTest.problem(settings) == null,
    preflight,
    wire: () => wireStep(loraCwTest, settings),
    passive: editor,
    refuse: () => (editor ? 'these are a Full Run step settings' : hasBackend ? null : 'no backend for this protocol'),
    parseCsv: parsePowerCsv,
    onControlsChange,
  })
  const { results, running } = run

  return (
    <Stack spacing={editor ? `${EDITOR_GAP}px` : `${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      {(!editor || editorView === 'sweep') && <SweepCard
        compact={editor}
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
      </SweepCard>}

      {/* What reads power for the sweep, as the manual tab's Measure
          section has it. Between the plan and its results: it decides
          what every row's power came from. */}
      {editor ? (
        editorView === 'measure' && (
          <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} compact />
        )
      ) : (
        <Section title="Measure" panel>
          <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} />
        </Section>
      )}

      {!editor && <ResultsCard
        results={results}
        running={running}
        totalPoints={run.totalPoints}
        onGraph={() => setGraphOpen(true)}
        onExport={() => downloadCsv(results, bleStatus?.address ?? null)}
        report={() => loraCwTest.report(settings, results)}
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
      />}

      <ResultsGraphModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        results={results.map(toGraphRow)}
      />
      {preflight.dialog}
    </Stack>
  )
}
