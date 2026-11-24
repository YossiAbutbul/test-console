import { PowerSourceFields } from '../../components/PowerSourceFields'
import type { PowerSourceState } from '../../lib/powerSource'
import { useState } from 'react'
import { Box, IconButton, MenuItem, Stack, TableCell, TableRow, TextField, Tooltip } from '@mui/material'
import TuneIcon from '@mui/icons-material/FilterListRounded'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { parseRangeSpec } from '../../lib/numericList'
import { channelIssues, shortChannelIssue } from '../../lib/earfcn'
import {
  GRID_GAP, Section, SegmentedChoice, FAIL_ROW_SX, HeadCell, NUM_CELL_SX, VerdictMark, deltaText,
} from '../../ui'
import {
  BW_OPTIONS, MCS_MAX, MCS_MIN,
  bandwidthLabel, rbForBandwidth,
} from './signal'
import { CSV_HEADER, parseLteModulatedCsv, toCsvBody } from './csv'
import { ResultsGraphModal, type GraphableRow } from '../power/LazyResultsGraphModal'
import { lteChannelPoint } from '../power/graphSeries'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls } from '../engine/useAutomationRun'
import {
  ColHead, ResultsCard, SettleEstimate, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import { BODY_ROW_SX, CELL_SX, EDITOR_GAP, useAddRowFocus } from '../engine/automationLayout'
import type { LteModem } from '../lte/useLteModem'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  lteModulatedPageSnapshot,
  persistLteModulatedPage,
  type LteModulatedResultRow,
  type LteModulatedRow,
} from '../../store/lteModulatedPageStore'
import type { ChannelUnit } from '../lte/channel'
import { selectOnFocus } from '../../lib/selectOnFocus'
import { NumberField } from '../../ui/NumberField'

import type { SweepSettingsStore } from '../engine/sweepTest'
import {
  lteModulatedTest, DEFAULT_POWER, DEFAULT_ROW, MAX_POWER_DBM, MODEM_RESTART_MS, blankRow, convertSpec,
  marginValid, mcsValid, rbValid, rowPoints, toChannels,
  type LteModulatedRaw, type LteModulatedSettings, type PlanPoint,
} from './sweepTest'

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = LteModulatedResultRow
type SweepRow = LteModulatedRow

/**
 * Sweep table columns.
 *
 * The range-spec columns flex and the pickers stay fixed, so the table fills
 * the panel without every input becoming the same width — a picker stretched
 * to match a text field reads as a form inflated to fill space.
 */
// Sized to fit ~760 px, what the card has at 1440 with the inspector open: at
// 860 the delete key and the readout ran off the card. Tolerance a fixed 80
// and the readout stacked in 76, as on LTE CW. MIN_TABLE_W is the sum of the
// floors and the eight 8 px gaps.
// Tolerance is 104 px: its heading, "Tolerance ± dB", has to fit whole --
// at 80 it was cut to "Tolerance ±…".
const COLS = '20px minmax(112px, 1.2fr) minmax(104px, 1fr) 100px 72px 72px'
  + ' 104px 76px 32px'
const MIN_TABLE_W = 756

/**
 * Results table columns: shares of a table at least 760 px wide. Each
 * column's floor is its heading or its widest value, so a heading such as
 * "Measured [dBm]" is never cut; narrower than that, the table scrolls
 * sideways instead.
 */
const RESULT_MIN_W = 760
const RESULT_COLS = [
  40, '8.95%', '11.05%', '10.0%', '15.79%', '14.74%', '7.89%', '8.95%', '10.53%', '7.89%',
]

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
    {/* The three signal fields as one column: they describe a single
        waveform, and three narrow columns would crowd out the readings. */}
    <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {bandwidthLabel(r.bandwidth)}
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {' · MCS '}{r.mcs}{' · '}{r.rb_count}{' RB'}
      </Box>
    </TableCell>
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

/** Graph row: named by band and EARFCN, with the waveform as the series.
 *  Without it two waveforms at the same channel and power overwrite each
 *  other on the graph. */
const toGraphRow = (r: ResultRow): GraphableRow => ({
  ...r,
  point: lteChannelPoint(r.band, r.earfcn, r.freq_mhz),
  series: `${bandwidthLabel(r.bandwidth)} · MCS ${r.mcs} · ${r.rb_count} RB`,
})

/** Export the results table. The column list and the row mapping live in
 *  `./csv`, alongside the parser that reads them back. */
function downloadCsv(rows: ResultRow[], mac: string | null): void {
  void saveCsv(
    [...CSV_HEADER], toCsvBody(rows),
    exportName('lte-modulated-automation', mac, 'csv'),
    { test: 'LTE modulated automation', dut_mac: mac },
  )
}

/** Nested snapshot — auto-created on first write so the page-level store stays
 *  a single object that the page owns. */
function snap(): NonNullable<typeof lteModulatedPageSnapshot.automation> {
  if (!lteModulatedPageSnapshot.automation) lteModulatedPageSnapshot.automation = {}
  return lteModulatedPageSnapshot.automation
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
  /** Whether the channel column is read as EARFCNs or MHz. Rig-wide, so every
   *  LTE page agrees on what a number in a channel field means. */
  unit: ChannelUnit
  /** Bands a MHz value is allowed to resolve within. */
  bands: number[]
  onUnitChange: (u: ChannelUnit) => void
  onEditBands: () => void
  /** Called whenever the run state changes, so the header can re-render. */
  onControlsChange?: (c: AutomationControls) => void
  /** Settings to edit in place of the page's own (a Full Run step). */
  store?: SweepSettingsStore<LteModulatedRaw>
  /** Only the settings: no results, nothing to run from here. */
  editor?: boolean
  /** As an editor, which half to show: the sweep or what measures it. */
  editorView?: 'sweep' | 'measure'
}

const PAGE_STORE: SweepSettingsStore<LteModulatedRaw> = { snap, persist: persistLteModulatedPage }

export function AutomationPanel({
  modem, unit, bands, onUnitChange, onEditBands, onControlsChange, store = PAGE_STORE, editor = false, editorView = 'sweep',
}: Props) {
  const { lossAt } = usePathLoss()
  const { status: bleStatus } = useConnection()
  // The stored settings, resolved once for the starting values below: rows
  // filled in, settle clamped, the power source -- the sensor, or the
  // spectrum analyzer at this panel's own settings (lib/powerSource.ts).
  const [initial] = useState(() => lteModulatedTest.resolve({ ...store.snap(), unit, bands }))
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => initial.powerSrc,
    (v) => { store.snap().powerSource = v; store.persist() },
  )
  const [rows, setRows] = useSnapshotState<SweepRow[]>(
    () => initial.rows,
    (v) => { store.snap().rows = v; store.persist() },
  )
  const [settleMs, setSettleMs] = useSnapshotState<number>(
    () => initial.settleMs,
    (v) => { store.snap().settleMs = v; store.persist() },
  )
  const settings: LteModulatedSettings = { rows, settleMs, powerSrc, unit, bands }
  const preflight = useInstrumentPreflight(lteModulatedTest.instruments(settings))
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const addFocus = useAddRowFocus(rows.length)

  // Convert during render on the unit's rising edge rather than in an effect.
  // React's documented way to adjust state when a prop changes; an effect would
  // paint the stale rows — all flagged invalid — for a frame first.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, earfcn: convertSpec(r.earfcn, lastUnit, unit, bands) })))
  }

  const addRow = () => {
    // Index the new row will land at. Recorded before the update rather than
    // inside it, so the updater stays free of side effects. The new row copies
    // the last one's power and signal: adding a channel to an existing sweep is
    // far more common than starting a different kind of measurement.
    addFocus.request(rows.length)
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, earfcn: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const plan: PlanPoint[] = lteModulatedTest.plan(settings)
  const plannedRunMs = lteModulatedTest.estimateMs(settings, plan)

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'LTE Modulated automation',
    // The id is this page's registry id.
    live: { id: 'run:lte-modulated', detail: 'LTE Modulated', pageId: 'lte-modulated' },
    loadResults: () => (editor ? [] : snap().results ?? []),
    saveResults: (v) => { if (!editor) { snap().results = v; persistLteModulatedPage() } },
    plan,
    freqMhz: lteModulatedTest.freqMhz,
    formatFreq: lteModulatedTest.formatFreq,
    plannedMs: plannedRunMs,
    ready: lteModulatedTest.problem(settings) == null,
    preflight,
    blankRow,
    createRun: () => lteModulatedTest.createRun(settings, { lossAt, modem }),
    stepTimeoutMs: lteModulatedTest.stepTimeoutMs(settings),
    refuse: () => (editor ? 'these are a Full Run step settings' : null),
    parseCsv: parseLteModulatedCsv,
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
    <Stack spacing={editor ? `${EDITOR_GAP}px` : `${GRID_GAP}px`} sx={{ flexGrow: 1, minHeight: 0 }}>
      {(!editor || editorView === 'sweep') && <SweepCard
        compact={editor}
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
          <ColHead label="Bandwidth" />
          <ColHead label="MCS" hint={`0–${MCS_MAX}`} />
          {/* No range in the heading: the ceiling is the bandwidth's own
              resource-block count, so it differs row by row. */}
          <ColHead label="RB" />
          <ColHead label="Tolerance" hint="± dB" />
        </>}
        bodyRef={addFocus.bodyRef}
        syntaxHint={syntaxHint}
        syntaxLine={syntaxLine}
        estimate={run.totalPoints > 0 && (
          <SettleEstimate
            ms={plannedRunMs - MODEM_RESTART_MS} settleMs={settleMs}
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
          const badMcs = !mcsValid(r)
          const badRb = !rbValid(r)
          const maxRb = rbForBandwidth(r.bandwidth)
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

              <TextField
                size="small" select sx={CELL_SX}
                value={r.bandwidth}
                disabled={running}
                onChange={(e) => {
                  // Carry the allocation to something the new channel
                  // can hold: 25 RB is a full 5 MHz channel and more
                  // than a 1.4 MHz one has to give.
                  const next = Number(e.target.value)
                  const room = rbForBandwidth(next)
                  updateRow(i, {
                    bandwidth: next,
                    rbCount: Math.min(r.rbCount, room),
                  })
                }}
              >
                {BW_OPTIONS.map((bw) => (
                  <MenuItem key={bw.code} value={bw.code}>{bw.label}</MenuItem>
                ))}
              </TextField>

              <NumberField
                size="small" sx={CELL_SX}
                value={r.mcs}
                disabled={running}
                error={badMcs}
                onChange={(e) => updateRow(i, { mcs: Number(e.target.value) })}
                onFocus={selectOnFocus}
                inputProps={{ min: MCS_MIN, max: MCS_MAX, step: 1 }}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={badMcs}
                      message={`A whole number, ${MCS_MIN}–${MCS_MAX}`}
                    />
                  ),
                }}
              />

              <NumberField
                size="small" sx={CELL_SX}
                value={r.rbCount}
                disabled={running}
                error={badRb}
                onChange={(e) => updateRow(i, { rbCount: Number(e.target.value) })}
                onFocus={selectOnFocus}
                inputProps={{ min: 1, max: maxRb, step: 1 }}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={badRb}
                      message={`1–${maxRb} resource blocks in a ${bandwidthLabel(r.bandwidth)} channel`}
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
        report={() => lteModulatedTest.report(settings, results)}
        onImport={(f) => void run.importFile(f)}
        onClear={() => run.replaceResults([])}
        minWidth={RESULT_MIN_W}
        colWidths={RESULT_COLS}
        heads={<>
          <HeadCell label="#" numeric />
          <HeadCell label="EARFCN" numeric />
          <HeadCell label="Freq" unit="MHz" numeric />
          <HeadCell label="Set" unit="dBm" numeric />
          <HeadCell label="Signal" />
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
