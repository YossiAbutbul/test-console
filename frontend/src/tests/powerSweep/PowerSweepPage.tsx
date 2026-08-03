import { useState } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tests } from '../../api/tests'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { TopProgress } from '../../components/TopProgress'
import { MeasurementCard } from '../../components/MeasurementCard'
import { useInstruments, type InstrumentId } from '../../context/InstrumentsContext'
import { usePathLoss } from '../../context/PathLossContext'
import { downloadBlob } from '../../lib/download'
import { range } from '../../lib/numericList'
import {
  FieldGrid, GRID_GAP, PageBody, PathLossChip, RunControls, Section, TwoCol,
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

const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** Result actions are secondary to the run — quiet text buttons on the panel
 *  heading, matching the automation tab. */
const resultActionSx = { minWidth: 0, height: 24, fontSize: 12, px: 1 } as const

/** Sweep bounds. Must match `SweepConfig` in backend/sweep/runner.py. */
const RANGES = {
  power: { min: 1, max: 22 },
  duty: { min: 1, max: 4 },
  hp: { min: 1, max: 7 },
}

const PA_MODES = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On' },
  { value: 2, label: 'Auto' },
]

export function PowerSweepPage({ protocol, group }: TestPageProps) {
  const qc = useQueryClient()
  const { instruments } = useInstruments()
  const { pathLossDb } = usePathLoss()
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
  const [settle, setSettle] = useState(30)
  const [paMode, setPaMode] = useState(0)
  const [graphOpen, setGraphOpen] = useState(false)

  // The sweep loop lives in the backend; the page starts it, polls it and
  // reports its transitions. Polling stops as soon as the run leaves 'running'.
  const statusQ = useQuery({
    queryKey: ['test-status', protocol],
    queryFn: tests.status,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 500 : false),
    enabled: hasBackend,
  })

  const totalSteps =
    Math.max(0, Math.abs(powerHi - powerLo) + 1) *
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
          power_values: range(powerLo, powerHi),
          duty_values: range(dutyLo, dutyHi),
          hp_values: range(hpLo, hpHi),
          settle_ms: settle,
          cmd_timeout_s: 5,
          pa_mode: paMode,
          path_loss_db: pathLossDb,
        },
        power_sensor_serial: ps.address.trim() || null,
        dc_analyzer_resource: dc.address.trim() || null,
        dc_analyzer_channel: dc.channel ?? 1,
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

  const exportXlsx = useMutation({
    mutationFn: tests.exportXlsx,
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      reporter.note(`Exported ${filename}`)
    },
    onError: (e: Error) => reporter.note(`Export failed: ${e.message}`, 'error'),
  })

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
  const rows: ResultRow[] = resultsQ.data ?? []

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
              <Typography
                sx={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: totalSteps === 0 ? 'error.main' : 'text.disabled',
                }}
              >
                {totalSteps} step{totalSteps === 1 ? '' : 's'}
              </Typography>
            }
          >
            <Stack spacing={`${GRID_GAP}px`}>
              <RangeRow label="Power" lo={powerLo} hi={powerHi} setLo={setPowerLo} setHi={setPowerHi}
                min={RANGES.power.min} max={RANGES.power.max} unit="dBm" />
              <RangeRow label="PA Duty Cycle" lo={dutyLo} hi={dutyHi} setLo={setDutyLo} setHi={setDutyHi}
                min={RANGES.duty.min} max={RANGES.duty.max} />
              <RangeRow label="HP Max" lo={hpLo} hi={hpHi} setLo={setHpLo} setHi={setHpHi}
                min={RANGES.hp.min} max={RANGES.hp.max} />
            </Stack>
          </Section>

          <Section title="Common settings" panel>
            <FieldGrid columns={2} wide>
              <LabeledField
                label="Frequency"
                hint="MHz"
                type="number"
                value={freqMhz}
                historyKey={`${protocol}.modeSweep.freqMhz`}
                onChange={(e) => setFreqMhz(e.target.value)}
                inputProps={{ step: 0.1 }}
              />
              <LabeledField
                label="Settle"
                hint="ms"
                type="number"
                value={settle}
                historyKey={`${protocol}.modeSweep.settle`}
                onChange={(e) => setSettle(Number(e.target.value))}
              />
              <LabeledField
                label="PA Mode"
                select
                value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
              >
                {PA_MODES.map((m) => (
                  <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                ))}
              </LabeledField>
            </FieldGrid>
            <Box sx={{ mt: 1.5 }}>
              <PathLossChip pathLossDb={pathLossDb} />
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
                disabled={rows.length === 0 || running || clearResults.isPending}
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
                startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
                onClick={() => exportXlsx.mutate()}
                disabled={!hasSweep || exportXlsx.isPending}
                sx={resultActionSx}
              >
                Export
              </Button>
            </Stack>
          }
        >
          <SweepResultsTable rows={rows} />
        </Section>
      </PageBody>

      <SweepResultsModal
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        rows={rows}
      />

      {preflight.dialog}
    </Box>
  )
}
