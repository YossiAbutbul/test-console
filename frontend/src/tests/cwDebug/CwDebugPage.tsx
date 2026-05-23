import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
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
  const [active, setActive] = useState(false)

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
      if (r.ok) setActive(true)
      log(`CW sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log(`CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    mutationFn: () => {
      if (!hasBackend) return Promise.resolve(null)
      return device.stop()
    },
    onSuccess: (r) => {
      if (!r) { setActive(false); return }
      setLast(r)
      setActive(false)
      log(`Stop sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log(`Stop failed: ${e.message}`, 'error'),
  })

  const busy = send.isPending || stop.isPending
  const toggle = () => {
    if (active) stop.mutate()
    else send.mutate()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Debug"
        actions={
          <Button
            variant="contained"
            disabled={busy}
            onClick={toggle}
            sx={{ minWidth: 96, height: 36 }}
          >
            {busy ? (active ? 'Stopping…' : 'Sending…') : active ? 'Stop test' : 'Send'}
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
