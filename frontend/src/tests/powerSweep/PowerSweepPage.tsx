import { useState } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
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
  ACTION_W, CONTROL_H, PageBody, PathLossChip, RunControls, Section, TEXT,
} from '../../ui'
import type { StartRequest } from '../../types/models'
import type { TestPageProps } from '../types'
import { useBackendRun } from '../engine/useBackendRun'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { useRunReporter } from '../engine/useRunReporter'
import { RangeRow } from './RangeRow'

const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

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
          >
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => exportXlsx.mutate()}
              disabled={!hasSweep || exportXlsx.isPending}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Export
            </Button>
          </RunControls>
        }
      />

      <PageBody width="full">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            columnGap: 4,
            rowGap: 2,
            alignItems: 'start',
          }}
        >
          <Section title="Sweep ranges">
            <Stack spacing={2}>
              <RangeRow label="Power" lo={powerLo} hi={powerHi} setLo={setPowerLo} setHi={setPowerHi}
                min={RANGES.power.min} max={RANGES.power.max} unit="dBm"
                historyKey={`${protocol}.modeSweep.power`} />
              <RangeRow label="PA Duty Cycle" lo={dutyLo} hi={dutyHi} setLo={setDutyLo} setHi={setDutyHi}
                min={RANGES.duty.min} max={RANGES.duty.max}
                historyKey={`${protocol}.modeSweep.duty`} />
              <RangeRow label="HP Max" lo={hpLo} hi={hpHi} setLo={setHpLo} setHi={setHpHi}
                min={RANGES.hp.min} max={RANGES.hp.max}
                historyKey={`${protocol}.modeSweep.hp`} />
            </Stack>
          </Section>

          <Section title="RF setup">
            <Stack spacing={2}>
              <LabeledField
                label="Frequency"
                hint="MHz"
                type="number"
                value={freqMhz}
                historyKey={`${protocol}.modeSweep.freqMhz`}
                onChange={(e) => setFreqMhz(e.target.value)}
                inputProps={{ step: 0.1 }}
                width={180}
              />
              <LabeledField
                label="Settle"
                hint="ms"
                type="number"
                value={settle}
                historyKey={`${protocol}.modeSweep.settle`}
                onChange={(e) => setSettle(Number(e.target.value))}
                width={140}
              />
              <LabeledField
                label="PA Mode"
                select
                value={paMode}
                onChange={(e) => setPaMode(Number(e.target.value))}
                sx={{ maxWidth: 180 }}
              >
                {PA_MODES.map((m) => (
                  <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                ))}
              </LabeledField>
              <PathLossChip pathLossDb={pathLossDb} />
            </Stack>
          </Section>
        </Box>

        <MeasurementCard
          staticData={{
            power_dbm: lastRow?.tx_power_dbm ?? null,
            current_a: lastRow?.current_a ?? null,
            voltage_v: lastRow?.voltage_v ?? null,
            label: 'Last measured row',
            subLabel: lastRow
              ? `#${lastRow.idx + 1} · hp=${lastRow.hp_max} duty=${lastRow.pa_duty_cycle} pow=${lastRow.power_dbm_setting}dBm · incl. path loss ${pathLossDb} dB`
              : `waiting for first step… · path loss ${pathLossDb} dB`,
          }}
        />
      </PageBody>

      <Box sx={{ flexGrow: 1 }} />

      <Box
        sx={{
          mt: 4, mx: -4, px: 4, py: 1.25,
          display: 'flex', justifyContent: 'flex-end',
          bgcolor: 'background.default',
          borderTop: 1, borderColor: 'divider',
        }}
      >
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
          Total steps:{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {totalSteps}
          </Box>
        </Typography>
      </Box>
      {preflight.dialog}
    </Box>
  )
}
