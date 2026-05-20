import { useState } from 'react'
import {
  Box, Button, CircularProgress, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tests } from '../../api/tests'
import { useLog } from '../../context/LogContext'
import { ProgressRow } from '../../components/ProgressRow'
import type { StartRequest } from '../../types/models'

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
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
      <Box sx={{ minWidth: 130 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          {min}–{max}{unit ? ` ${unit}` : ''} · {count} step{count === 1 ? '' : 's'}
        </Typography>
      </Box>
      <TextField
        label="From"
        type="number"
        size="small"
        value={lo}
        inputProps={{ min, max }}
        onChange={(e) => setLo(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        sx={{ width: 110 }}
      />
      <Box sx={{ color: 'text.disabled', fontSize: 13 }}>→</Box>
      <TextField
        label="To"
        type="number"
        size="small"
        value={hi}
        inputProps={{ min, max }}
        onChange={(e) => setHi(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        sx={{ width: 110 }}
      />
    </Stack>
  )
}

export function PowerSweepPage() {
  const { log } = useLog()
  const qc = useQueryClient()

  const [freqMhz, setFreqMhz] = useState('902.3')
  const [powerLo, setPowerLo] = useState(RANGES.power.min)
  const [powerHi, setPowerHi] = useState(RANGES.power.max)
  const [dutyLo, setDutyLo] = useState(RANGES.duty.min)
  const [dutyHi, setDutyHi] = useState(RANGES.duty.max)
  const [hpLo, setHpLo] = useState(RANGES.hp.min)
  const [hpHi, setHpHi] = useState(RANGES.hp.max)
  const [settle, setSettle] = useState(30)
  const [sensorSerial, setSensorSerial] = useState('')
  const [dcResource, setDcResource] = useState('USB0::0x0957::0x0F07::MY50000200::INSTR')
  const [dcChannel, setDcChannel] = useState(3)

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
      const req: StartRequest = {
        config: {
          freq_hz: Math.round(Number(freqMhz) * 1_000_000),
          power_values: range(powerLo, powerHi),
          duty_values: range(dutyLo, dutyHi),
          hp_values: range(hpLo, hpHi),
          settle_ms: settle,
          cmd_timeout_s: 5,
        },
        power_sensor_serial: sensorSerial.trim() || null,
        dc_analyzer_resource: dcResource.trim() || null,
        dc_analyzer_channel: dcChannel,
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

  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>Sweep Test — PaDutyCycle × HpMax × Power</Typography>

      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            label="Frequency (MHz)"
            type="number"
            size="small"
            value={freqMhz}
            onChange={(e) => setFreqMhz(e.target.value)}
            inputProps={{ step: 0.1 }}
            sx={{ minWidth: 180 }}
          />
          <TextField
            label="Settle (ms)"
            type="number"
            size="small"
            value={settle}
            onChange={(e) => setSettle(Number(e.target.value))}
            sx={{ width: 140 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Total steps:{' '}
            <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {totalSteps}
            </Box>
          </Typography>
        </Stack>

        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mt: 0.5 }}>Sweep ranges</Typography>

        <Stack spacing={1.25}>
          <RangeRow label="Power (dBm)" lo={powerLo} hi={powerHi} setLo={setPowerLo} setHi={setPowerHi}
            min={RANGES.power.min} max={RANGES.power.max} unit="dBm" />
          <RangeRow label="PA Duty Cycle" lo={dutyLo} hi={dutyHi} setLo={setDutyLo} setHi={setDutyHi}
            min={RANGES.duty.min} max={RANGES.duty.max} />
          <RangeRow label="HP Max" lo={hpLo} hi={hpHi} setLo={setHpLo} setHi={setHpHi}
            min={RANGES.hp.min} max={RANGES.hp.max} />
        </Stack>

        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mt: 0.5 }}>Instruments</Typography>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap">
          <TextField label="Power sensor serial (optional)" size="small" value={sensorSerial}
            onChange={(e) => setSensorSerial(e.target.value)} sx={{ minWidth: 220 }} />
          <TextField label="DC analyzer VISA resource" size="small" value={dcResource}
            onChange={(e) => setDcResource(e.target.value)} sx={{ minWidth: 320 }} />
          <TextField label="DC channel" type="number" size="small" value={dcChannel}
            onChange={(e) => setDcChannel(Number(e.target.value))} sx={{ width: 120 }} />
        </Stack>

        <Stack direction="row" spacing={2}>
          <Button variant="contained" disabled={running || run.isPending} onClick={() => run.mutate()}>
            Run sweep
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={!running || cancelling}
            onClick={() => cancel.mutate()}
            startIcon={cancelling ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
          <Button variant="outlined" onClick={onExport}>Export Excel</Button>
        </Stack>

        <ProgressRow status={statusQ.data} cancelling={cancelling} />
      </Stack>
    </Paper>
  )
}
