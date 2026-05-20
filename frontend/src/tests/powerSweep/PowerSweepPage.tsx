import { useState } from 'react'
import {
  Box, Button, CircularProgress, Stack, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tests } from '../../api/tests'
import { useLog } from '../../context/LogContext'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { TopProgress } from '../../components/TopProgress'
import { useInstruments, type InstrumentId } from '../../context/InstrumentsContext'
import type { StartRequest } from '../../types/models'

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
  label, lo, hi, setLo, setHi, min, max, unit,
}: {
  label: string
  lo: number
  hi: number
  setLo: (n: number) => void
  setHi: (n: number) => void
  min: number
  max: number
  unit?: string
}) {
  const count = Math.max(0, Math.abs(hi - lo) + 1)
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{label}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {min}–{max}{unit ? ` ${unit}` : ''} · {count} step{count === 1 ? '' : 's'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <LabeledField
          label="From"
          type="number"
          value={lo}
          inputProps={{ min, max }}
          onChange={(e) => setLo(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          width={120}
        />
        <Box sx={{ color: 'text.disabled', fontSize: 13, mt: 2 }}>→</Box>
        <LabeledField
          label="To"
          type="number"
          value={hi}
          inputProps={{ min, max }}
          onChange={(e) => setHi(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
          width={120}
        />
      </Stack>
    </Box>
  )
}

export function PowerSweepPage() {
  const { log } = useLog()
  const qc = useQueryClient()
  const { notifyMissing, instruments } = useInstruments()
  const missing = REQUIRED_INSTRUMENTS.filter((id) => instruments[id].status !== 'connected')

  const [freqMhz, setFreqMhz] = useState('902.3')
  const [powerLo, setPowerLo] = useState(RANGES.power.min)
  const [powerHi, setPowerHi] = useState(RANGES.power.max)
  const [dutyLo, setDutyLo] = useState(RANGES.duty.min)
  const [dutyHi, setDutyHi] = useState(RANGES.duty.max)
  const [hpLo, setHpLo] = useState(RANGES.hp.min)
  const [hpHi, setHpHi] = useState(RANGES.hp.max)
  const [settle, setSettle] = useState(30)

  const statusQ = useQuery({
    queryKey: ['test-status'],
    queryFn: tests.status,
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 500 : false),
  })

  const totalSteps =
    Math.max(0, Math.abs(powerHi - powerLo) + 1) *
    Math.max(0, Math.abs(dutyHi - dutyLo) + 1) *
    Math.max(0, Math.abs(hpHi - hpLo) + 1)

  const run = useMutation({
    mutationFn: () => {
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
        },
        power_sensor_serial: ps.address.trim() || null,
        dc_analyzer_resource: dc.address.trim() || null,
        dc_analyzer_channel: dc.channel ?? 1,
      }
      return tests.run(req)
    },
    onSuccess: () => {
      log(`Sweep started (${totalSteps} steps)`)
      qc.invalidateQueries({ queryKey: ['test-status'] })
    },
    onError: (e: Error) => log(`Run failed: ${e.message}`, 'error'),
  })

  const cancel = useMutation({
    mutationFn: () => tests.cancel(),
    onSuccess: () => {
      log('Sweep cancelled')
      qc.invalidateQueries({ queryKey: ['test-status'] })
    },
    onError: (e: Error) => log(`Cancel failed: ${e.message}`, 'error'),
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
      log(`Exported ${filename}`)
    } catch (e) {
      log(`Export failed: ${(e as Error).message}`, 'error')
    }
  }

  const running = statusQ.data?.state === 'running'
  const cancelling = cancel.isPending || (running && cancel.isSuccess)
  const total = statusQ.data?.total ?? 0
  const completed = statusQ.data?.completed ?? 0
  const pct = total > 0 ? (completed / total) * 100 : 0
  const showProgress = running || cancelling

  const onRun = () => {
    if (missing.length > 0) {
      log(`Cannot start: missing instruments — ${missing.join(', ')}`, 'warn')
      notifyMissing(REQUIRED_INSTRUMENTS)
      return
    }
    run.mutate()
  }

  return (
    <Box>
      <TopProgress
        pct={pct}
        indeterminate={cancelling}
        hidden={!showProgress}
      />
      <PageHeader
        protocol="LoRa"
        group="TX"
        label="Mode Sweep"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={onExport} sx={{ height: 36 }}>
              Export Excel
            </Button>
            <Button
              variant="outlined"
              disabled={!running || cancelling}
              onClick={() => cancel.mutate()}
              endIcon={cancelling ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ minWidth: 96, height: 36 }}
            >
              Cancel
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

      <Stack spacing={3} sx={{ mt: 1 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-end">
          <LabeledField
            label="Frequency"
            hint="MHz"
            type="number"
            value={freqMhz}
            onChange={(e) => setFreqMhz(e.target.value)}
            inputProps={{ step: 0.1 }}
            width={180}
          />
          <LabeledField
            label="Settle"
            hint="ms"
            type="number"
            value={settle}
            onChange={(e) => setSettle(Number(e.target.value))}
            width={140}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', pb: 1 }}>
            Total steps:{' '}
            <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {totalSteps}
            </Box>
          </Typography>
        </Stack>

        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary', mb: 1.5 }}>
            Sweep ranges
          </Typography>
          <Stack spacing={2}>
            <RangeRow label="Power" lo={powerLo} hi={powerHi} setLo={setPowerLo} setHi={setPowerHi}
              min={RANGES.power.min} max={RANGES.power.max} unit="dBm" />
            <RangeRow label="PA Duty Cycle" lo={dutyLo} hi={dutyHi} setLo={setDutyLo} setHi={setDutyHi}
              min={RANGES.duty.min} max={RANGES.duty.max} />
            <RangeRow label="HP Max" lo={hpLo} hi={hpHi} setLo={setHpLo} setHi={setHpHi}
              min={RANGES.hp.min} max={RANGES.hp.max} />
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}
