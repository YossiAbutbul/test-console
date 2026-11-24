import { PowerSourceFields } from '../../components/PowerSourceFields'
import type { PowerSourceState } from '../../lib/powerSource'
import { useMemo, useState } from 'react'
import { Box, Stack, TableCell, TableRow, TextField, Typography } from '@mui/material'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { formatDuration } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import {
  CONTROL_H, GRID_GAP, Section, SegmentedChoice, TEXT, FAIL_ROW_SX, HeadCell, NUM_CELL_SX,
  VerdictMark,
} from '../../ui'
import { CSV_HEADER, parseBleCwCsv, toCsvBody } from './csv'
import {
  buildPlan, convertChannelSpec, powerChanges, rowIssues, rowPoints, specChannels, type PlanPoint,
} from './plan'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls } from '../engine/useAutomationRun'
import {
  ColHead, HeaderField, ResultsCard, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import { BODY_ROW_SX, CELL_SX, EDITOR_GAP, useAddRowFocus } from '../engine/automationLayout'
import type { SweepSettingsStore } from '../engine/sweepTest'
import { DURATION_MAX_S, channelMhz } from '../ble/radio'
import type { BleLink } from '../ble/useBleLink'
import { useSnapshotState } from '../../store/useSnapshotState'
import {
  bleCwPageSnapshot,
  persistBleCwPage,
  type BleAutomationResultRow,
  type BleAutomationRow,
  type BleChannelUnit,
} from '../../store/bleCwPageStore'
import { selectOnFocus } from '../../lib/selectOnFocus'
import {
  DEFAULT_ROW, blankRow, bleCwTest, toneOf, type BleCwRaw, type BleCwSettings,
} from './sweepTest'

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = BleAutomationResultRow
type SweepRow = BleAutomationRow

/** One grid template for the header and every row. */
const COLS = '20px minmax(140px, 1fr) minmax(120px, 1fr) 88px 88px 76px 32px'
const MIN_TABLE_W = 600

/** Results table columns, `#` first; the table is at least 624 px wide. */
const RESULT_MIN_W = 624
const RESULT_COLS = [40, '10%', '11%', '10%', '16%', '14%', '10%', '12%', '11%']

const limitsText = (r: ResultRow): string => {
  if (r.min_dbm == null && r.max_dbm == null) return '—'
  return `${r.min_dbm ?? '…'} – ${r.max_dbm ?? '…'}`
}

const renderResultRow = (r: ResultRow, i: number) => (
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

function downloadCsv(rows: ResultRow[], mac: string | null): void {
  void saveCsv([...CSV_HEADER], toCsvBody(rows), exportName('ble-cw-automation', mac, 'csv'), {
    test: 'BLE CW automation', dut_mac: mac,
  })
}

function snap(): NonNullable<typeof bleCwPageSnapshot.automation> {
  if (!bleCwPageSnapshot.automation) bleCwPageSnapshot.automation = {}
  return bleCwPageSnapshot.automation
}

const PAGE_STORE: SweepSettingsStore<BleCwRaw> = { snap, persist: persistBleCwPage }

interface Props {
  /** The DUT's BLE radio, owned by the page -- both tabs drive one radio. */
  link: BleLink
  /** Channel numbers or MHz, page-wide so both tabs agree. */
  unit: BleChannelUnit
  onUnitChange: (u: BleChannelUnit) => void
  /** The manual tab has a tone in flight; a run must not start into it. */
  blocked?: boolean
  onControlsChange?: (c: AutomationControls) => void
  /** Settings to edit in place of the page's own (a Full Run step). */
  store?: SweepSettingsStore<BleCwRaw>
  /** Only the settings: no results, nothing to run from here. */
  editor?: boolean
  /** As an editor, which half to show: the sweep or what measures it. */
  editorView?: 'sweep' | 'measure'
}

export function BleAutomationPanel({
  link, unit, onUnitChange, blocked, onControlsChange, store = PAGE_STORE, editor = false, editorView = 'sweep',
}: Props) {
  const { lossAt } = usePathLoss()
  const { status: bleStatus } = useConnection()
  // The stored settings, resolved once for the starting values below.
  const [initial] = useState(() => bleCwTest.resolve({ ...store.snap(), unit }))
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
  const [toneSeconds, setToneSeconds] = useSnapshotState<string>(
    () => initial.toneSeconds,
    (v) => { store.snap().toneFixedSeconds = v; store.persist() },
  )
  const settings: BleCwSettings = { rows, settleMs, powerSrc, toneSeconds, unit }
  const preflight = useInstrumentPreflight(bleCwTest.instruments(settings))
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const addFocus = useAddRowFocus(rows.length)

  // Rows are rewritten into the new unit on its rising edge, during render
  // rather than in an effect -- an effect would paint the stale rows, all
  // flagged invalid, for a frame first. Same pattern as LteAutomationPanel.
  const [lastUnit, setLastUnit] = useState(unit)
  if (unit !== lastUnit) {
    setLastUnit(unit)
    setRows((arr) => arr.map((r) => ({ ...r, channel: convertChannelSpec(r.channel, lastUnit, unit) })))
  }

  const addRow = () => {
    addFocus.request(rows.length)
    const last = rows[rows.length - 1] ?? DEFAULT_ROW
    setRows((arr) => [...arr, { ...last, channel: '' }])
  }
  const removeRow = (i: number) => setRows((arr) => arr.filter((_, j) => j !== i))
  const updateRow = (i: number, patch: Partial<SweepRow>) =>
    setRows((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const tone = toneOf(settings)
  const toneAuto = tone.auto
  const toneS = tone.fixed
  const toneMin = tone.min
  const toneValid = tone.valid
  const planToneS = tone.planS

  const plan = useMemo(() => buildPlan(rows, unit), [rows, unit])
  const resets = powerChanges(plan)
  const plannedRunMs = bleCwTest.estimateMs(settings, plan)

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'BLE CW automation',
    live: { id: 'run:ble-cw', detail: 'BLE CW', pageId: 'ble-cw' },
    loadResults: () => (editor ? [] : snap().results ?? []),
    saveResults: (v) => { if (!editor) { snap().results = v; persistBleCwPage() } },
    plan,
    freqMhz: bleCwTest.freqMhz,
    plannedMs: plannedRunMs,
    ready: bleCwTest.problem(settings) == null && !blocked && !link.busy,
    preflight,
    blankRow,
    createRun: () => bleCwTest.createRun(settings, { lossAt, link }),
    stepTimeoutMs: bleCwTest.stepTimeoutMs(settings),
    refuse: () => (editor ? 'these are a Full Run step settings' : null),
    parseCsv: parseBleCwCsv,
    onControlsChange,
  })
  const { results, running } = run
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
              { value: 'channel', label: 'Channel' },
              { value: 'mhz', label: 'MHz' },
            ]}
            onChange={onUnitChange}
            disabled={running}
          />
          {/* Run-wide: both are about timing, not about the channel. */}
          <SettleField value={settleMs} onChange={setSettleMs} disabled={running} />
          <HeaderField label="Tone" unit="s">
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
          </HeaderField>
        </>}
        onAdd={addRow}
        cols={COLS}
        minTableW={MIN_TABLE_W}
        heads={<>
          <ColHead label={isChannelUnit ? 'Channel' : 'Frequency'} hint={isChannelUnit ? '0–39' : 'MHz'} />
          <ColHead label="Power" hint="param" />
          <ColHead label="Min" hint="dBm" />
          <ColHead label="Max" hint="dBm" />
        </>}
        bodyRef={addFocus.bodyRef}
        syntaxHint={syntaxHint}
        syntaxLine={syntaxLine}
        estimate={run.totalPoints > 0 && toneValid && (
          // Every point waits out its tone and a reconnect, and every
          // power a reset, so state the cost before it is paid.
          <Typography sx={{ ...TEXT.micro, whiteSpace: 'nowrap', flexShrink: 0, color: 'text.secondary' }}>
            ≈ {formatDuration(plannedRunMs)} · {resets} reset{resets === 1 ? '' : 's'} · {toneAuto ? `auto tone, ~${planToneS} s` : `${toneS} s tone`} per point
          </Typography>
        )}
      >
        {rows.map((r, i) => {
          const issues = rowIssues(r, unit)
          const steps = rowPoints(r, unit).length
          const first = specChannels(r.channel, unit)[0]
          // Shared by every cell of the row. The channel cell passes
          // its ref inline below, where the focus-on-Add finds it.
          const fieldProps = (key: keyof SweepRow, issue: string | null, placeholder: string) => ({
            size: 'small' as const,
            sx: { ...CELL_SX, minWidth: 0 },
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
            <SweepRowShell
              key={i} index={i} cols={COLS} points={steps}
              onRemove={() => removeRow(i)} disabled={running}
              readout={
                // The unit not being typed, so the row states what it
                // resolved to; the count under it.
                <Box sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  <Box sx={{ visibility: first != null ? 'visible' : 'hidden' }}>
                    {first == null ? '—' : isChannelUnit ? `${channelMhz(first)} MHz` : `ch ${first}`}
                  </Box>
                  <Box>{steps} point{steps === 1 ? '' : 's'}</Box>
                </Box>
              }
            >
              <TextField
                {...fieldProps('channel', issues.channel, isChannelUnit ? '0-39 or 0,19,39' : '2402-2480:2')}
                inputRef={addFocus.inputRef(i)}
              />
              <TextField {...fieldProps('power', issues.power, '31 or 6-31:5')} />
              {/* One message for the pair: a limit is only wrong
                  against the other one. */}
              <TextField type="number" {...fieldProps('minDbm', issues.limits, '—')} />
              <TextField type="number" {...fieldProps('maxDbm', issues.limits, '—')} />
            </SweepRowShell>
          )
        })}
      </SweepCard>}

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
        onExport={() => downloadCsv(results, bleStatus?.address ?? null)}
        report={() => bleCwTest.report(settings, results)}
        onImport={(f) => void run.importFile(f)}
        onClear={() => run.replaceResults([])}
        minWidth={RESULT_MIN_W}
        colWidths={RESULT_COLS}
        heads={<>
          <HeadCell label="#" numeric />
          <HeadCell label="Channel" numeric />
          <HeadCell label="Freq" unit="MHz" numeric />
          <HeadCell label="Power" unit="param" numeric />
          <HeadCell label="Measured" unit="dBm" numeric />
          <HeadCell label="Limits" unit="dBm" numeric />
          <HeadCell label="CC" unit="mA" numeric />
          <HeadCell label="Verdict" />
          <HeadCell label="Status" />
        </>}
        renderRow={renderResultRow}
      />}

      {preflight.dialog}
    </Stack>
  )
}
