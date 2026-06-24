import { useState } from 'react'
import {
  Box, Button, CircularProgress, MenuItem, Stack, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tests } from '../../api/tests'
import { useLog } from '../../context/LogContext'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { TopProgress } from '../../components/TopProgress'
import { MeasurementCard } from '../../components/MeasurementCard'
import { useInstruments, type InstrumentId } from '../../context/InstrumentsContext'
import type { StartRequest } from '../../types/models'
import type { TestPageProps } from '../types'

const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

// Backend validation ranges (must match backend/test_runner.py)
const RANGES = {
  power: { min: 1, max: 22 },
  duty: { min: 1, max: 4 },
  hp: { min: 1, max: 7 },
}

function range(lo: number, hi: number): number[] {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

function RangeRow({
  label, lo, hi, setLo, setHi, min, max, unit, historyKey,
}: {
  label: string
  lo: number
  hi: number
  setLo: (n: number) => void
  setHi: (n: number) => void
  min: number
  max: number
  unit?: string
  historyKey?: string
}) {
  const count = Math.max(0, Math.abs(hi - lo) + 1)
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>{label}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {min}–{max}{unit ? ` ${unit}` : ''} · {count} step{count === 1 ? '' : 's'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="flex-end">
        <LabeledField
          label="From"
          type="number"
          value={lo}
          historyKey={historyKey ? `${historyKey}.from` : undefined}
          inputProps={{ min, max }}
          onChange={(e) => setLo(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          width={120}
        />
        <Box
          sx={{
            color: 'text.disabled',
            fontSize: 16,
            height: 40,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          →
        </Box>
        <LabeledField
          label="To"
          type="number"
          value={hi}
          historyKey={historyKey ? `${historyKey}.to` : undefined}
          inputProps={{ min, max }}
          onChange={(e) => setHi(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          width={120}
        />
      </Stack>
    </Box>
  )
}

export function PowerSweepPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const { instruments } = useInstruments()
  const missing = REQUIRED_INSTRUMENTS.filter((id) => instruments[id].status !== 'connected')
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

  const run = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log('Sweep', `${protocol} Mode Sweep: no backend wired yet`, 'warn')
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
        },
        power_sensor_serial: ps.address.trim() || null,
        dc_analyzer_resource: dc.address.trim() || null,
        dc_analyzer_channel: dc.channel ?? 1,
      }
      return tests.run(req)
    },
    onSuccess: () => {
      log('Sweep', `Started (${totalSteps} steps)`)
      qc.invalidateQueries({ queryKey: ['test-status'] })
    },
    onError: (e: Error) => log('Sweep', `Run failed: ${e.message}`, 'error'),
  })

  const cancel = useMutation({
    mutationFn: () => {
      if (!hasBackend) return Promise.resolve(null)
      return tests.cancel()
    },
    onSuccess: () => {
      log('Sweep', 'Stopped')
      qc.invalidateQueries({ queryKey: ['test-status'] })
    },
    onError: (e: Error) => log('Sweep', `Stop failed: ${e.message}`, 'error'),
  })

  async function onExport() {
    try {
      const { blob, filename } = await tests.exportXlsx()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      log('Sweep', `Exported ${filename}`)
    } catch (e) {
      log('Sweep', `Export failed: ${(e as Error).message}`, 'error')
    }
  }

  const running = statusQ.data?.state === 'running'
  const hasSweep = statusQ.data?.state != null && statusQ.data.state !== 'idle'
  const cancelling = cancel.isPending || (running && cancel.isSuccess)
  const total = statusQ.data?.total ?? 0
  const completed = statusQ.data?.completed ?? 0
  const pct = total > 0 ? (completed / total) * 100 : 0
  const showProgress = running || cancelling

  const onRun = () => {
    if (hasBackend && missing.length > 0) {
      log('Sweep', `Warning: instruments not connected in UI — ${missing.join(', ')}. Backend will try to init.`, 'warn')
    }
    run.mutate()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <TopProgress
        pct={pct}
        indeterminate={cancelling}
        hidden={!showProgress}
      />
      <PageHeader
        protocol={protocol}
        group={group}
        label="Mode Sweep"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={onExport} disabled={!hasSweep} sx={{ height: 36 }}>
              Export Excel
            </Button>
            <Button
              variant="outlined"
              disabled={!running || cancelling}
              onClick={() => cancel.mutate()}
              endIcon={cancelling ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ minWidth: 96, height: 36 }}
            >
              {cancelling ? 'Stopping…' : 'Stop'}
            </Button>
            <Button
              variant="contained"
              disabled={running || run.isPending}
              onClick={onRun}
              endIcon={run.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ minWidth: 110, height: 36 }}
            >
              Run sweep
            </Button>
          </Stack>
        }
      />

      <Box
        sx={{
          mt: 1,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          columnGap: 4,
          rowGap: 2,
          alignItems: 'start',
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Sweep ranges
          </Typography>
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
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            RF setup
          </Typography>
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
              <MenuItem value={0}>Off</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={2}>Auto</MenuItem>
            </LabeledField>
          </Stack>
        </Box>
      </Box>

      {(() => {
        const r = statusQ.data?.last_row
        return (
          <Box sx={{ mt: 2 }}>
            <MeasurementCard
              staticData={{
                power_dbm: r?.tx_power_dbm ?? null,
                current_a: r?.current_a ?? null,
                voltage_v: r?.voltage_v ?? null,
                label: 'Last measured row',
                subLabel: r
                  ? `#${r.idx + 1} · hp=${r.hp_max} duty=${r.pa_duty_cycle} pow=${r.power_dbm_setting}dBm`
                  : 'waiting for first step…',
              }}
            />
          </Box>
        )
      })()}

      <Box sx={{ flexGrow: 1 }} />

      <Box
        sx={{
          mt: 4,
          mx: -4,
          px: 4,
          py: 1.25,
          display: 'flex',
          justifyContent: 'flex-end',
          bgcolor: 'background.default',
        }}
      >
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          Total steps:{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {totalSteps}
          </Box>
        </Typography>
      </Box>
    </Box>
  )
}
