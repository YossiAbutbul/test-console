import { useState } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { useMutation } from '@tanstack/react-query'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import type { CommandResponse } from '../../types/models'
import type { TestPageProps } from '../types'

export function CwDebugPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const hasBackend = protocol === 'LoRa'
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [power, setPower] = useState(14)
  // Kept as strings so clearing the field shows empty (not auto-0).
  const [duty, setDuty] = useState('1')
  const [hp, setHp] = useState('7')
  const [paMode, setPaMode] = useState(0)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)

  // PA Duty Cycle and HP Max are valid only in 1..7 (0 doesn't work on the DUT).
  const inRange = (v: number) => Number.isInteger(v) && v >= 1 && v <= 7
  const inRangeStr = (s: string) => s.trim() !== '' && inRange(Number(s))
  const dutyValid = inRangeStr(duty)
  const hpValid = inRangeStr(hp)
  // Track which field is focused so an empty field doesn't nag while editing.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const focusBind = (key: string) => ({
    onFocus: () => setFocusKey(key),
    onBlur: () => setFocusKey((k) => (k === key ? null : k)),
  })

  const send = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log('DUT', `${protocol} Debug: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      return device.loraCw({ freq_hz: Math.round(freqMhz * 1_000_000), power_dbm: power, pa_duty_cycle: Number(duty), hp_max: Number(hp), pa_mode: paMode })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `CW sent: ok=${r.ok} status=${r.status}`)
      if (r.ok) setMeasureTrigger((n) => n + 1)
    },
    onError: (e: Error) => log('DUT', `CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    mutationFn: () => {
      if (!hasBackend) return Promise.resolve(null)
      return device.stop()
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `Stop sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log('DUT', `Stop failed: ${e.message}`, 'error'),
  })

  const busy = send.isPending || stop.isPending

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Debug"
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => stop.mutate()}
              sx={{ minWidth: 96, height: 36 }}
            >
              {stop.isPending ? 'Stopping…' : 'Stop'}
            </Button>
            <Button
              variant="contained"
              disabled={busy || !dutyValid || !hpValid}
              onClick={() => send.mutate()}
              sx={{ minWidth: 96, height: 36 }}
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </Button>
          </Stack>
        }
      />

      <Stack spacing={2} sx={{ mt: 1 }}>
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            RF setup
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, maxWidth: 760 }}>
            <LabeledField label="Frequency" hint="MHz" type="number" value={freqMhz}
              historyKey={`${protocol}.debug.freqMhz`}
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }} />
            <LabeledField label="Power" hint="dBm" type="number" value={power}
              historyKey={`${protocol}.debug.power_dbm`}
              onChange={(e) => setPower(Number(e.target.value))} />
            <LabeledField label="PA Duty Cycle" type="number" value={duty}
              historyKey={`${protocol}.debug.duty`}
              inputProps={{ min: 1, max: 7 }}
              error={!dutyValid}
              validate={inRangeStr}
              {...focusBind('duty')}
              InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(duty, dutyValid, focusKey === 'duty')} message={duty.trim() === '' ? 'Enter a value' : 'Allowed range: 1–7'} /> }}
              onChange={(e) => setDuty(e.target.value)} />
            <LabeledField label="HP Max" type="number" value={hp}
              historyKey={`${protocol}.debug.hp`}
              inputProps={{ min: 1, max: 7 }}
              error={!hpValid}
              validate={inRangeStr}
              {...focusBind('hp')}
              InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(hp, hpValid, focusKey === 'hp')} message={hp.trim() === '' ? 'Enter a value' : 'Allowed range: 1–7'} /> }}
              onChange={(e) => setHp(e.target.value)} />
            <LabeledField
              label="PA Mode"
              select
              value={paMode}
              onChange={(e) => setPaMode(Number(e.target.value))}
            >
              <MenuItem value={2}>Auto</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={0}>Off</MenuItem>
            </LabeledField>
          </Box>
        </Box>

        <MeasurementCard
          freqHz={Math.round(freqMhz * 1_000_000)}
          triggerId={measureTrigger}
        />

        {last && (
          <Box sx={{ fontFamily: 'monospace', fontSize: 12, p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
            <div>tx: {last.tx_hex}</div>
            <div>rx: {last.rx_hex}</div>
            <div>opcode: {last.reply_opcode_hex} payload: {last.reply_payload_hex}</div>
            <div>ok: {String(last.ok)} status: {last.status}</div>
          </Box>
        )}
      </Stack>
    </Box>
  )
}
