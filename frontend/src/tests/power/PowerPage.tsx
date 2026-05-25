import { useState } from 'react'
import { Box, Button, MenuItem, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import type { CommandResponse } from '../../types/models'
import type { TestPageProps } from '../types'

export function PowerPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const hasBackend = protocol === 'LoRa'
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [power, setPower] = useState(14)
  const [paMode, setPaMode] = useState(2)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)

  const send = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log('DUT', `${protocol} Power: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      return device.loraPower({
        freq_hz: Math.round(freqMhz * 1_000_000),
        power_dbm: power,
        pa_mode: paMode,
      })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `Power sent: ok=${r.ok} status=${r.status}`)
      if (r.ok) setMeasureTrigger((n) => n + 1)
    },
    onError: (e: Error) => log('DUT', `Power failed: ${e.message}`, 'error'),
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
        label="Power"
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
          <Stack spacing={2} sx={{ maxWidth: 360 }}>
            <LabeledField label="Frequency" hint="MHz" type="number" value={freqMhz}
              historyKey={`${protocol}.power.freqMhz`}
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }} />
            <LabeledField label="Power" hint="dBm" type="number" value={power}
              historyKey={`${protocol}.power.power_dbm`}
              onChange={(e) => setPower(Number(e.target.value))} />
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
          </Stack>
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
