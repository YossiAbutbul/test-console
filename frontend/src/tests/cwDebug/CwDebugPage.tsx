import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
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
  const [duty, setDuty] = useState(0)
  const [hp, setHp] = useState(7)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)

  const send = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log(`${protocol} Debug: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      return device.loraCw({ freq_hz: Math.round(freqMhz * 1_000_000), power_dbm: power, pa_duty_cycle: duty, hp_max: hp })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log(`CW sent: ok=${r.ok} status=${r.status}`)
      if (r.ok) setMeasureTrigger((n) => n + 1)
    },
    onError: (e: Error) => log(`CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    mutationFn: () => {
      if (!hasBackend) return Promise.resolve(null)
      return device.stop()
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log(`Stop sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log(`Stop failed: ${e.message}`, 'error'),
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
              disabled={busy}
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
              onChange={(e) => setDuty(Number(e.target.value))} />
            <LabeledField label="HP Max" type="number" value={hp}
              historyKey={`${protocol}.debug.hp`}
              onChange={(e) => setHp(Number(e.target.value))} />
            <LabeledField label="PA Mode" value="AUTO (0x02)" disabled />
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
