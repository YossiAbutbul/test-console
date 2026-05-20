import { useState } from 'react'
import { Box, Button, Stack } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { useMutation } from '@tanstack/react-query'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import type { CommandResponse } from '../../types/models'

export function CwDebugPage() {
  const { log } = useLog()
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [power, setPower] = useState(14)
  const [duty, setDuty] = useState(0)
  const [hp, setHp] = useState(7)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [active, setActive] = useState(false)

  const send = useMutation({
    mutationFn: () =>
      device.loraCw({ freq_hz: Math.round(freqMhz * 1_000_000), power_dbm: power, pa_duty_cycle: duty, hp_max: hp }),
    onSuccess: (r) => {
      setLast(r)
      if (r.ok) setActive(true)
      log(`CW sent: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log(`CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    mutationFn: () => device.stop(),
    onSuccess: (r) => {
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
    <Box>
      <PageHeader
        protocol="LoRa"
        group="TX"
        label="Debug"
        actions={
          <Button
            variant="contained"
            disabled={busy}
            onClick={toggle}
            sx={{ minWidth: 96, minHeight: 36.5 }}
          >
            {busy ? (active ? 'Stopping…' : 'Sending…') : active ? 'Stop test' : 'Send'}
          </Button>
        }
      />
      <Stack spacing={2.5} mb={4} sx={{ maxWidth: 360, mt: 1 }}>
        <LabeledField label="Frequency" hint="MHz" type="number" value={freqMhz}
          onChange={(e) => setFreqMhz(Number(e.target.value))}
          inputProps={{ step: 0.1 }} />
        <LabeledField label="Power" hint="dBm" type="number" value={power}
          onChange={(e) => setPower(Number(e.target.value))} />
        <LabeledField label="PA Duty Cycle" type="number" value={duty}
          onChange={(e) => setDuty(Number(e.target.value))} />
        <LabeledField label="HP Max" type="number" value={hp}
          onChange={(e) => setHp(Number(e.target.value))} />
        <LabeledField label="PA Mode" value="AUTO (0x02)" disabled />
      </Stack>
      {last && (
        <Box sx={{ fontFamily: 'monospace', fontSize: 12, mt: 2, p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
          <div>tx: {last.tx_hex}</div>
          <div>rx: {last.rx_hex}</div>
          <div>opcode: {last.reply_opcode_hex} payload: {last.reply_payload_hex}</div>
          <div>ok: {String(last.ok)} status: {last.status}</div>
        </Box>
      )}
    </Box>
  )
}
