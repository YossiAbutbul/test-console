import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import type { CommandResponse } from '../../types/models'
import type { TestPageProps } from '../types'

export function PowerPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const hasBackend = protocol === 'LoRa'
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [power, setPower] = useState(14)
  const [last, setLast] = useState<CommandResponse | null>(null)

  const send = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log(`${protocol} Power: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      return device.loraPower({
        freq_hz: Math.round(freqMhz * 1_000_000),
        power_dbm: power,
        pa_duty_cycle: 0,
        hp_max: 0,
      })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log(`Power sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log(`Power failed: ${e.message}`, 'error'),
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Power"
        actions={
          <Button
            variant="contained"
            disabled={send.isPending}
            onClick={() => send.mutate()}
            sx={{ minWidth: 96, height: 36 }}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
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
            <LabeledField label="PA Mode" value="AUTO (0x02)" disabled />
          </Stack>
        </Box>

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
