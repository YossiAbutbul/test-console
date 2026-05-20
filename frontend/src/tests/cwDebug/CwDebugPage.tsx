import { useState } from 'react'
import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
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
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>LoRa CW Debug</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={2} flexWrap="wrap">
        <TextField label="Frequency (MHz)" type="number" size="small" value={freqMhz}
          onChange={(e) => setFreqMhz(Number(e.target.value))}
          inputProps={{ step: 0.1 }} sx={{ minWidth: 180 }} />
        <TextField label="Power (dBm)" type="number" size="small" value={power}
          onChange={(e) => setPower(Number(e.target.value))} sx={{ width: 140 }} />
        <TextField label="PA Duty Cycle" type="number" size="small" value={duty}
          onChange={(e) => setDuty(Number(e.target.value))} sx={{ width: 140 }} />
        <TextField label="HP Max" type="number" size="small" value={hp}
          onChange={(e) => setHp(Number(e.target.value))} sx={{ width: 120 }} />
        <TextField label="PA Mode" size="small" value="AUTO (0x02)" disabled sx={{ width: 160 }} />
      </Stack>
      <Stack direction="row" spacing={2} mb={2}>
        <Button
          variant="contained"
          color={active ? 'error' : 'success'}
          disabled={busy}
          onClick={toggle}
          sx={{ minWidth: 140 }}
        >
          {busy
            ? active ? 'Stopping…' : 'Sending…'
            : active ? 'Stop test' : 'Send CW'}
        </Button>
      </Stack>
      {last && (
        <Box sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          <div>tx: {last.tx_hex}</div>
          <div>rx: {last.rx_hex}</div>
          <div>opcode: {last.reply_opcode_hex} payload: {last.reply_payload_hex}</div>
          <div>ok: {String(last.ok)} status: {last.status}</div>
        </Box>
      )}
    </Paper>
  )
}
