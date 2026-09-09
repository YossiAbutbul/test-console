import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTLE_MS, MIN_SETTLE_MS, clampSettleMs } from '../../lib/settle'
import {
  Box, Button, FormControlLabel, MenuItem, Stack, Switch, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DownloadIcon from '@mui/icons-material/Download'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tests } from '../../api/tests'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { TopProgress } from '../../components/TopProgress'
import { MeasurementCard } from '../../components/MeasurementCard'
import { useInstruments, type InstrumentId } from '../../context/InstrumentsContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useNotify } from '../../context/NotifyContext'
import { saveBlob } from '../../lib/download'
import { range } from '../../lib/numericList'
import {
  FieldGrid, GRID_GAP, MONO, PageBody, PathLossChip, RunControls, Section,
  TEXT, TwoCol,
} from '../../ui'
import type { ResultRow, StartRequest } from '../../types/models'
import type { TestPageProps } from '../types'
import { comboLabel } from './bestSettings'
import { SweepResultsModal } from './SweepResultsModal'
import { SweepResultsTable } from './SweepResultsTable'
import { useBackendRun } from '../engine/useBackendRun'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import { RangeRow } from './RangeRow'
import { RangeEditorModal } from './RangeEditorModal'
import {
  blockSteps, newBlock, spanLabel, toWire, totalSteps as blocksTotalSteps,
  type BlockDraft,
} from './blocks'

const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** Result actions are secondary to the run — quiet text buttons on the panel
 *  heading, matching the automation tab. */
const resultActionSx = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/**
 * Sweep bounds. Must match HP_MAX_RANGE / PA_DC_RANGE / POWER_RANGE in
 * backend/sweep/models.py, which rejects anything outside them before the run
 * starts. All three are 1-based: a 0 on any axis hangs the DUT rather than
 * being refused by it.
 */
const RANGES = {
  power: { min: 1, max: 22 },
  duty: { min: 1, max: 4 },
  hp: { min: 1, max: 7 },
}

/** The range list shows this many rows before it scrolls.
 *
 *  Row height is fixed rather than left to the content so the cap is exact:
 *  derived from padding it would clip the third row by a pixel or two, which
 *  looks like a bug rather than a limit. */
const RANGE_ROW_H = 52
const RANGE_ROW_GAP = 8
const RANGE_ROWS_VISIBLE = 3

const PA_MODES = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On' },
  { value: 2, label: 'Auto' },
]

export function PowerSweepPage({ protocol, group, active }: TestPageProps) {
  const qc = useQueryClient()
  const { instruments } = useInstruments()
  const { lossAt } = usePathLoss()
  const notify = useNotify()
  const reporter = useRunReporter('Mode Sweep', 'Sweep', 'steps')
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS)
  const hasBackend = protocol === 'LoRa'

  const [freqMhz, setFreqMhz] = useState('902.3')
  const [powerLo, setPowerLo] = useState(RANGES.power.min)
  const [powerHi, setPowerHi] = useState(RANGES.power.max)
  const [dutyLo, setDutyLo] = useState(RANGES.duty.min)
  const [dutyHi, setDutyHi] = useState(RANGES.duty.max)
  const [hpLo, setHpLo] = useState(RANGES.hp.min)
  const [hpHi, setHpHi] = useState(RANGES.hp.max)
  // Empty means the simple form above is in force. Non-empty supersedes it
  // entirely -- the two are alternatives, not layers, and showing both as
  // editable would leave it ambiguous which one the run used.
  const [advBlocks, setAdvBlocks] = useState<BlockDraft[]>([])
  // Which row the editor is on: a BlockDraft to edit it, null to add one,
  // undefined for closed. Three states rather than a boolean plus an index,
  // so "adding" cannot be confused with "editing row 0".
  const [editing, setEditing] = useState<BlockDraft | null | undefined>(undefined)
  const advanced = advBlocks.length > 0

  const editIndex = editing ? advBlocks.findIndex((b) => b.id === editing.id) : -1

  /** Seeded from the simple form so switching modes keeps the current plan. */
  const enableAdvanced = () => setAdvBlocks([{
    ...newBlock(RANGES), powerLo, powerHi, dutyLo, dutyHi, hpLo, hpHi,
  }])
  const [settle, setSettle] = useState(DEFAULT_SETTLE_MS)
  const [paMode, setPaMode] = useState(0)
  const [graphOpen, setGraphOpen] = useState(false)
  // Rows read from a workbook instead of from this backend's run. Kept in
  // page state rather than pushed into the runner: an imported file is
  // someone else's finished sweep, and loading it into the run would make
  // the status line, Export and Clear all describe something that did not
  // happen here.
  const [imported, setImported] = useState<{ rows: ResultRow[]; name: string } | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // The sweep loop lives in the backend; the page starts it, polls it and
  // reports its transitions. Polling stops as soon as the run leaves 'running'.
  const statusQ = useQuery({
    queryKey: ['test-status', protocol],
    queryFn: tests.status,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 500 : false),
    enabled: hasBackend,
  })

  // One frequency per sweep, so the correction is decided once here.
  const loss = lossAt(Number(freqMhz))
  const pathLossDb = loss.db

  const totalSteps = advanced
    ? blocksTotalSteps(advBlocks)
    : Math.max(0, Math.abs(powerHi - powerLo) + 1) *
      Math.max(0, Math.abs(dutyHi - dutyLo) + 1) *
      Math.max(0, Math.abs(hpHi - hpLo) + 1)

  useBackendRun({
    state: statusQ.data?.state,
    completed: statusQ.data?.completed ?? 0,
    total: statusQ.data?.total ?? 0,
    error: statusQ.data?.error,
    reporter,
  })

  const run = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        reporter.note(`${protocol} Mode Sweep: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      const ps = instruments['power-sensor']
      const dc = instruments['dc-analyzer']
      const req: StartRequest = {
        config: {
          freq_hz: Math.round(Number(freqMhz) * 1_000_000),
          // The flat lists still travel: a backend that predates blocks
          // reads them, and one that knows about blocks ignores them when
          // `blocks` is non-empty. See SweepConfig.effective_blocks.
          power_values: range(powerLo, powerHi),
          duty_values: range(dutyLo, dutyHi),
          hp_values: range(hpLo, hpHi),
          ...(advanced ? { blocks: advBlocks.map(toWire) } : {}),
          // Clamped again here: the field may still hold a typed-but-unblurred
          // value, and the backend rejects anything under the floor outright.
          settle_ms: clampSettleMs(settle),
          cmd_timeout_s: 5,
          pa_mode: paMode,
          path_loss_db: pathLossDb,
        },
        power_sensor_serial: ps.address.trim() || null,
        dc_analyzer_resource: dc.address.trim() || null,
        dc_analyzer_channel: dc.channel ?? 1,
      }
      if (!loss.calibrated) {
        reporter.note(
          `path loss not calibrated at ${freqMhz} MHz - using the default `
          + `${pathLossDb} dB. Measured power will be off by the difference.`,
          'warn',
        )
      }
      return tests.run(req)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-status'] }),
    onError: (e: Error) => reporter.failed(e.message),
  })

  const cancel = useMutation({
    mutationFn: () => (hasBackend ? tests.cancel() : Promise.resolve(null)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-status'] }),
    onError: (e: Error) => reporter.note(`Stop failed: ${e.message}`, 'error'),
  })

  const clearResults = useMutation({
    mutationFn: () => (hasBackend ? tests.clear() : Promise.resolve(null)),
    onSuccess: () => {
      // Both queries key off the run: status decides whether results are
      // fetched at all, so refresh it first or the table reappears.
      void qc.invalidateQueries({ queryKey: ['test-status'] })
      void qc.invalidateQueries({ queryKey: ['test-results'] })
    },
    onError: (e: Error) => reporter.note(`Clear failed: ${e.message}`, 'error'),
  })

  const importXlsx = useMutation({
    mutationFn: (file: File) => tests.importXlsx(file).then((r) => ({ rows: r, name: file.name })),
    onSuccess: ({ rows: r, name }) => {
      setImported({ rows: r, name })
      reporter.note(`Imported ${r.length} rows from ${name}`)
    },
    onError: (e: Error) => reporter.note(`Import failed: ${e.message}`, 'error'),
  })

  const exportXlsx = useMutation({
    mutationFn: tests.exportXlsx,
    onSuccess: async ({ blob, filename }) => {
      // Reported only once it is actually written: the operator can dismiss
      // the save dialog, and "Exported" for a file that was never saved sends
      // them looking for it.
      const outcome = await saveBlob(blob, filename)
      if (outcome === 'saved') reporter.note(`Exported ${filename}`)
    },
    onError: (e: Error) => reporter.note(`Export failed: ${e.message}`, 'error'),
  })

  // Says the table is a file rather than this backend's run. Gated on `active`
  // because every page stays mounted, so an ungated notice would follow the
  // operator onto pages that have nothing to do with it.
  useEffect(() => {
    notify.notice(
      'sweep-imported',
      'info',
      active && imported
        ? `${imported.name} — ${imported.rows.length} imported rows, not a run of this backend`
        : null,
      'Viewing a file',
    )
  }, [notify, active, imported])

  const status = statusQ.data
  const running = status?.state === 'running'
  const hasSweep = status?.state != null && status.state !== 'idle'
  const stopping = cancel.isPending || (running && cancel.isSuccess)
  const total = status?.total ?? 0
  const completed = status?.completed ?? 0

  const onRun = async () => {
    if (hasBackend && !(await preflight.run())) {
      reporter.note('cancelled — instruments not ready', 'warn')
      return
    }
    run.mutate()
  }

  const lastRow = status?.last_row

  // The backend already keeps every measured row, so ask it for them rather
  // than stitching the one-row-per-poll status into a local copy: no
  // reconciling duplicates or steps missed between polls, and the chart is
  // still right after a reload part-way through a run.
  //
  // The key carries the progress, so a new batch of rows is a new query. It
  // advances in tens while running — a sweep is hundreds of steps and refetching
  // the whole list for each one is a lot of traffic to redraw the same curve —
  // then lands on the exact count once the run stops, which fetches the tail.
  //
  // `started_at` is in the key so a new run cannot read the previous one's
  // cache: without it the next sweep starts at completed=0, hits the entry the
  // last sweep left under that same key, and briefly charts the old run.
  const rowsKey = running ? Math.floor(completed / 10) : completed
  const resultsQ = useQuery({
    queryKey: ['test-results', protocol, status?.started_at ?? 0, rowsKey],
    queryFn: tests.results,
    enabled: hasBackend && hasSweep,
    // Hold the last rows while the next batch loads, so the chart does not
    // blank out every ten steps — but only within one run. Carrying them
    // across runs would show the previous sweep under the new one's header.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === (status?.started_at ?? 0) ? prev : undefined,
  })
  const liveRows: ResultRow[] = resultsQ.data ?? []
  // While a file is open it is what the table and the graph show.
  const rows: ResultRow[] = imported?.rows ?? liveRows

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <TopProgress
        pct={total > 0 ? (completed / total) * 100 : 0}
        indeterminate={stopping}
        hidden={!running && !stopping}
      />
      <PageHeader
        protocol={protocol}
        group={group}
        label="Mode Sweep"
        actions={
          <RunControls
            running={running}
            starting={run.isPending}
            stopping={stopping}
            canRun={totalSteps > 0}
            runLabel="Run sweep"
            progress={total > 0 ? `${completed}/${total}` : undefined}
            onRun={() => void onRun()}
            onStop={() => cancel.mutate()}
          />
        }
      />

      <PageBody width="fluid" grow>
        <TwoCol stretch>
          <Section
            title="Sweep ranges"
            panel
            // The step count belongs to the ranges that produce it. It used to
            // sit in a bar pinned to the bottom of the page, far from the three
            // fields that decide it and easy to miss before starting a run of
            // several hundred steps.
            action={
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography
                  sx={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: totalSteps === 0 ? 'error.main' : 'text.disabled',
                  }}
                >
                  {totalSteps} step{totalSteps === 1 ? '' : 's'}
                </Typography>
                {/* A toggle rather than an icon: the two modes are exclusive
                    and the control has to show which one is on, which an icon
                    button does not. */}
                <Tooltip title={
                  advanced
                    ? 'Back to one range for the whole sweep'
                    : 'Sweep several ranges, one after another'
                }>
                  <FormControlLabel
                    sx={{ mr: 0, ml: 0.5 }}
                    disabled={running}
                    control={
                      <Switch
                        size="small"
                        checked={advanced}
                        onChange={(e) => (e.target.checked ? enableAdvanced() : setAdvBlocks([]))}
                        inputProps={{ 'aria-label': 'Advanced ranges' }}
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'text.secondary' }}>
                        Advanced
                      </Typography>
                    }
                  />
                </Tooltip>
              </Stack>
            }
          >
            {advanced ? (
              // The sliders are not shown at all rather than disabled: they
              // describe one range, and leaving them on screen under a
              // multi-range plan invites reading them as the plan.
              <Stack spacing={1}>
                {/* Capped and scrolled. The list shares a stretched row with
                    the settings panel and sits above the results, so an
                    unbounded one pushed the results table down to nothing --
                    the taller the plan, the less of the run you could see. */}
                <Box
                  sx={{
                    display: 'flex', flexDirection: 'column',
                    gap: `${RANGE_ROW_GAP}px`,
                    maxHeight:
                      RANGE_ROWS_VISIBLE * RANGE_ROW_H
                      + (RANGE_ROWS_VISIBLE - 1) * RANGE_ROW_GAP,
                    overflowY: 'auto',
                    // Room for the scrollbar so it does not sit on the cards.
                    pr: advBlocks.length > 3 ? 0.75 : 0,
                  }}
                >
                {advBlocks.map((b, i) => (
                  <Box
                    key={b.id}
                    onClick={() => !running && setEditing(b)}
                    role="button"
                    title={running ? undefined : `Edit range ${i + 1}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      height: RANGE_ROW_H,
                      flexShrink: 0,
                      // More room on the right than the left: the step count
                      // is right-aligned, so it ends flush against the border
                      // at equal padding while the badge on the left does not.
                      pl: 1.25, pr: 2.25,
                      border: 1, borderColor: 'divider', borderRadius: 1,
                      cursor: running ? 'default' : 'pointer',
                      transition: 'border-color 0.12s, background-color 0.12s',
                      '&:hover': running ? undefined : {
                        borderColor: 'text.disabled',
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <Box sx={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: 'action.selected',
                    }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
                        {i + 1}
                      </Typography>
                    </Box>

                    {/* Each axis labelled rather than run together in one
                        string: three spans separated by dots read as one
                        number until you have parsed the whole line. */}
                    <Box sx={{
                      display: 'grid', gap: 1.5, flexGrow: 1, minWidth: 0,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
                    }}>
                      {([
                        ['Power', spanLabel(b.powerLo, b.powerHi), 'dBm'],
                        ['PA DC', spanLabel(b.dutyLo, b.dutyHi), ''],
                        ['HP Max', spanLabel(b.hpLo, b.hpHi), ''],
                      ] as const).map(([label, value, unit]) => (
                        <Box key={label} sx={{ minWidth: 0 }}>
                          <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                            {label}
                          </Typography>
                          <Typography sx={{ fontSize: 13.5, fontFamily: MONO, fontWeight: 600 }}>
                            {value}
                            {unit && (
                              <Box component="span" sx={{ ...TEXT.micro, color: 'text.disabled', ml: 0.5 }}>
                                {unit}
                              </Box>
                            )}
                          </Typography>
                        </Box>
                      ))}
                    </Box>

                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography sx={{ fontSize: 13.5, fontFamily: MONO, fontWeight: 600 }}>
                        {blockSteps(b)}
                      </Typography>
                      <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>steps</Typography>
                    </Box>
                  </Box>
                ))}
                </Box>
                {/* Rows edit themselves; this is the only other action. Kept
                    outside the scroll area so it stays reachable. */}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                  onClick={() => setEditing(null)}
                  disabled={running}
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                >
                  Add range
                </Button>
              </Stack>
            ) : (
              <Stack spacing={`${GRID_GAP}px`}>
                <RangeRow label="Power" lo={powerLo} hi={powerHi} setLo={setPowerLo} setHi={setPowerHi}
                  min={RANGES.power.min} max={RANGES.power.max} unit="dBm" disabled={running} />
                <RangeRow label="PA Duty Cycle" lo={dutyLo} hi={dutyHi} setLo={setDutyLo} setHi={setDutyHi}
                  min={RANGES.duty.min} max={RANGES.duty.max} disabled={running} />
                <RangeRow label="HP Max" lo={hpLo} hi={hpHi} setLo={setHpLo} setHi={setHpHi}
                  min={RANGES.hp.min} max={RANGES.hp.max} disabled={running} />
              </Stack>
            )}
          </Section>

          <Section title="Common settings" panel>
            <FieldGrid columns={2} wide>
              <LabeledField
                label="Frequency"
                hint="MHz"
                type="number"
                value={freqMhz}
                onChange={(e) => setFreqMhz(e.target.value)}
                disabled={running}
                inputProps={{ step: 0.1 }}
              />
              <LabeledField
                label="Settle"
                hint={`ms · min ${MIN_SETTLE_MS}`}
                type="number"
                value={settle}
                // Clamped on blur, not per keystroke: raising "4" to "400"
                // mid-type would make the field impossible to fill in.
                onChange={(e) => setSettle(Number(e.target.value))}
                onBlur={() => setSettle((v) => clampSettleMs(v))}
                disabled={running}
                inputProps={{ min: MIN_SETTLE_MS, step: 50 }}
              />
              <LabeledField
                label="PA Mode"
                select
                value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
                disabled={running}
              >
                {PA_MODES.map((m) => (
                  <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                ))}
              </LabeledField>
            </FieldGrid>
            <Box sx={{ mt: 1.5 }}>
              <PathLossChip pathLossDb={pathLossDb} calibrated={loss.calibrated} freqMhz={Number(freqMhz)} />
            </Box>
          </Section>
        </TwoCol>

        {/* Deliberately no target here. The manual pages ask for a power and
            the gap to it is the result; a sweep is characterising the PA, so a
            point landing short of the power it was handed is the measurement,
            not a failure — scoring it against ±1 dB would paint most of a
            healthy run red. What matters per row is which settings ran and
            what they drew. */}
        <MeasurementCard
          staticData={{
            power_dbm: lastRow?.tx_power_dbm ?? null,
            current_a: lastRow?.current_a ?? null,
            voltage_v: lastRow?.voltage_v ?? null,
            label: 'Last measured row',
            subLabel: lastRow
              ? `#${lastRow.idx + 1} · ${comboLabel(lastRow)} · incl. path loss ${pathLossDb} dB`
              : `waiting for first step… · path loss ${pathLossDb} dB`,
          }}
        />

        {/* Actions sit on the panel they act on, as the automation tab does —
            Run/Stop stay in the header, these belong to the results. */}
        <Section
          title="Results"
          panel
          grow
          // The table is its own scroller, so it should meet the panel edge.
          flush
          action={
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mr: 0.5 }}>
                measured + path loss ({pathLossDb} dB)
              </Typography>
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={<DeleteSweepIcon sx={{ fontSize: 15 }} />}
                onClick={() => clearResults.mutate()}
                // Refused mid-run by the backend; disabled here so the refusal
                // is not the way the operator finds that out.
                disabled={rows.length === 0 || running || clearResults.isPending || imported != null}
                sx={resultActionSx}
              >
                Clear
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<ShowChartIcon sx={{ fontSize: 15 }} />}
                onClick={() => setGraphOpen(true)}
                disabled={rows.length === 0}
                sx={resultActionSx}
              >
                Graph
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<UploadFileIcon sx={{ fontSize: 15 }} />}
                onClick={() => fileInput.current?.click()}
                disabled={running || importXlsx.isPending}
                sx={resultActionSx}
              >
                {importXlsx.isPending ? 'Reading…' : 'Import'}
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
                onClick={() => exportXlsx.mutate()}
                // Export always writes the backend's own rows, so offering it
                // while a file is on screen would hand back something other
                // than what is being looked at.
                disabled={!hasSweep || exportXlsx.isPending || imported != null}
                sx={resultActionSx}
              >
                Export
              </Button>
            </Stack>
          }
        >

          {/* No minimum height here. A floor taller than the space the flex
              column actually has pushes the rows out past the panel instead of
              scrolling them -- the table has its own scroller, and what starved
              it was the range list above, which is now capped. */}
          <SweepResultsTable rows={rows} />
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Reset first: picking the same file twice fires no change event
              // otherwise, so a re-import after an edit would look ignored.
              e.target.value = ''
              if (f) importXlsx.mutate(f)
            }}
          />
        </Section>
      </PageBody>

      <SweepResultsModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        rows={rows}
      />

      <RangeEditorModal
        editing={editing}
        bounds={RANGES}
        position={editIndex >= 0 ? editIndex + 1 : undefined}
        onClose={() => setEditing(undefined)}
        onSave={(row) => setAdvBlocks((rows) => (
          editIndex >= 0
            ? rows.map((r, i) => (i === editIndex ? row : r))
            : [...rows, row]
        ))}
        // Withheld on the last row: turning advanced off is what "no ranges"
        // means, and the toggle already does that.
        onDelete={editIndex >= 0 && advBlocks.length > 1
          ? () => setAdvBlocks((rows) => rows.filter((_, i) => i !== editIndex))
          : undefined}
      />

      {preflight.dialog}
    </Box>
  )
}
