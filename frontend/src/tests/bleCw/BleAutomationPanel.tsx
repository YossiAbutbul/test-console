import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  measureSpectrumOf, powerInstrument, powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { useMemo, useRef, useState } from 'react'
import { Box, Stack, TableCell, TableRow, TextField, Typography } from '@mui/material'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { instrumentsApi } from '../../api/instruments'
import { usePathLoss } from '../../context/PathLossContext'
import { useConnection } from '../../context/ConnectionContext'
import { formatDuration, sleep } from '../../lib/async'
import { downloadCsv as saveCsv, exportName } from '../../lib/download'
import { fmt } from '../../lib/format'
import { verdictOf } from '../../lib/verdict'
import { DEFAULT_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import {
  CONTROL_H, GRID_GAP, Section, SegmentedChoice, TEXT, FAIL_ROW_SX, HeadCell, NUM_CELL_SX,
  VerdictMark,
} from '../../ui'
import { CSV_HEADER, parseBleCwCsv, toCsvBody } from './csv'
import {
  AUTO_TONE_MAX_S, AUTO_TONE_TYPICAL_S, autoToneSeconds, buildPlan, convertChannelSpec,
  estimateRunMs, minToneSeconds, powerChanges, rowIssues, rowPoints, specChannels, stepBudgetMs,
  type PlanPoint,
} from './plan'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useAutomationRun, type AutomationControls, type PointContext } from '../engine/useAutomationRun'
import {
  ColHead, HeaderField, ResultsCard, SettleField, SweepCard, SweepRowShell,
} from '../engine/AutomationKit'
import { BODY_ROW_SX, CELL_SX, useAddRowFocus } from '../engine/automationLayout'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { DURATION_MAX_S, channelMhz, offAirReason } from '../ble/radio'
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

export type { AutomationControls } from '../engine/useAutomationRun'

type ResultRow = BleAutomationResultRow
type SweepRow = BleAutomationRow

/** Beside the one that reads power, which the panel's power source names. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['dc-analyzer']

/** Blank: auto. Every second of tone past the reading is a second the run
 *  waits per point with the DUT unreachable, so by default the run sizes it
 *  from the measurement itself (`autoToneSeconds`). A number fixes it. */
const DEFAULT_TONE_S = ''

const DEFAULT_ROW: SweepRow = { channel: '0,19,39', power: '31', minDbm: '', maxDbm: '' }

/** One grid template for the header and every row. */
const COLS = '20px minmax(140px, 1fr) minmax(120px, 1fr) 88px 88px 76px 32px'
const MIN_TABLE_W = 600

/** Results table columns, `#` first; the table is at least 624 px wide. */
const RESULT_MIN_W = 624
const RESULT_COLS = [40, '10%', '11%', '10%', '16%', '14%', '10%', '12%', '11%']

/** The wall clock, out of line so it is read when called, not in render. */
const epochNow = (): number => Date.now()
/** The same for the monotonic clock a read is timed on. */
const monoNow = (): number => performance.now()

function normaliseRow(r: Partial<SweepRow>): SweepRow {
  return {
    channel: r.channel ?? '',
    power: r.power ?? DEFAULT_ROW.power,
    minDbm: r.minDbm ?? '',
    maxDbm: r.maxDbm ?? '',
  }
}

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
  const { lossAt } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const [powerSrc, setPowerSrc] = useSnapshotState<PowerSourceState>(
    () => powerSourceOf(snap().powerSource),
    (v) => { snap().powerSource = v; persistBleCwPage() },
  )
  const sourceOk = powerSourceValid(powerSrc)
  const preflight = useInstrumentPreflight([powerInstrument(powerSrc), ...REQUIRED_INSTRUMENTS])

  const [rows, setRows] = useSnapshotState<SweepRow[]>(() => {
    const stored = snap().rows
    if (stored?.length) return stored.map(normaliseRow)
    return [unit === 'mhz' ? { ...DEFAULT_ROW, channel: '2402,2440,2480' } : DEFAULT_ROW]
  }, (v) => { snap().rows = v; persistBleCwPage() })
  const [settleMs, setSettleMs] = useSnapshotState<number>(
    () => clampSettleMs(snap().settleMs ?? DEFAULT_SETTLE_MS),
    (v) => { snap().settleMs = v; persistBleCwPage() },
  )
  const [toneSeconds, setToneSeconds] = useSnapshotState<string>(
    () => snap().toneFixedSeconds ?? DEFAULT_TONE_S,
    (v) => { snap().toneFixedSeconds = v; persistBleCwPage() },
  )
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
  const resets = powerChanges(plan)
  const plannedRunMs = toneValid ? estimateRunMs(plan, planToneS) : 0
  // A row with a bad field contributes no points; it blocks the run rather
  // than vanishing from the plan.
  const anyInvalid = rows.some((r) => {
    if (r.channel.trim() === '') return false
    const i = rowIssues(r, unit)
    return !!(i.channel || i.power || i.limits)
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
  const measurePoint = async (
    item: PlanPoint,
    { signal, reporter, noteUncalibrated, preview }: PointContext<ResultRow>,
  ): Promise<ResultRow> => {
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
      const readStart = monoNow()
      const m = await instrumentsApi.measure(fHz, { signal, spectrum: measureSpectrumOf(powerSrc) })
      const readMs = monoNow() - readStart
      row.measured_dbm_raw = m.power_dbm
      row.measured_dbm = m.power_dbm == null ? null : m.power_dbm + pl.db
      if (!pl.calibrated) noteUncalibrated(item.freqMhz)
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
      // updated with why.
      preview(row)
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

  const run = useAutomationRun<PlanPoint, ResultRow>({
    reporterName: 'BLE CW automation',
    live: { id: 'run:ble-cw', detail: 'BLE CW', pageId: 'ble-cw' },
    loadResults: () => snap().results ?? [],
    saveResults: (v) => { snap().results = v; persistBleCwPage() },
    plan,
    freqMhz: (p) => p.freqMhz,
    plannedMs: plannedRunMs,
    ready: !anyInvalid && sourceOk && toneValid && !blocked && !link.busy,
    preflight,
    blankRow,
    measure: measurePoint,
    stepTimeoutMs: stepBudgetMs(toneAuto ? AUTO_TONE_MAX_S : toneS),
    onStart: () => {
      lostRef.current = null
      slowestWindowRef.current = null
      lastAutoToneRef.current = null
    },
    // Outside the step timeout: a power change waits on a reboot, and
    // has its own bound in the relink. A DUT that did not come back from
    // the last point ends the run here, rather than failing every point
    // after it in milliseconds.
    beforeItem: async (item, i, { signal, reporter }) => {
      if (lostRef.current) throw new Error(lostRef.current)
      const prev = i > 0 ? plan[i - 1].power : null
      if (prev === item.power) return
      reporter.note(`tone power ${item.power} — resetting the DUT`)
      // The first power is set even if the page believes the DUT is on
      // it: a run starts from a power it set itself, the way the LTE
      // run power-cycles its modem.
      if (i === 0) await link.setPower(item.power, signal)
      else await link.ensurePower(item.power, signal)
    },
    // A tone left on air -- a point abandoned by its timeout -- is
    // waited out, so the run ends with the DUT back on the link.
    after: () => link.finishTone(),
    // The tone itself cannot be stopped; say so, rather than letting the run
    // look hung while it waits for the DUT to come back.
    onStop: (reporter) => {
      const until = link.onAirUntil()
      if (until != null) {
        const left = Math.max(0, Math.ceil((until - epochNow()) / 1000))
        reporter.note(`stopping — the tone on air cannot be cut short; reconnecting when it ends in ${left} s`, 'warn')
      }
    },
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
      </SweepCard>

      <Section title="Measure" panel>
        <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={running} />
      </Section>

      <ResultsCard
        results={results}
        running={running}
        totalPoints={run.totalPoints}
        onExport={() => downloadCsv(results, bleStatus?.address ?? null)}
        report={() => ({
          test: 'ble-cw-automation', title: 'BLE CW automation',
          settings: [['Settle', `${settleMs} ms`], ['Tone', toneAuto ? 'auto' : `${toneSeconds} s`]],
          columns: [...CSV_HEADER], rows: toCsvBody(results),
        })}
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
      />

      {preflight.dialog}
    </Stack>
  )
}
