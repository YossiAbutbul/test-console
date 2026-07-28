import { useEffect, useState } from 'react'
import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import { FrameDump, PageBody, Section, SendStopControls, TEXT } from '../../ui'
import type { CommandResponse } from '../../types/models'
import type { TestPageProps } from '../types'

const MODEM = { FSK: 0, LoRa: 1 } as const
type ModemName = keyof typeof MODEM

const BW_OPTIONS = [
  { code: 0, label: '125 kHz' },
  { code: 1, label: '250 kHz' },
  { code: 2, label: '500 kHz' },
  { code: 3, label: 'Reserved' },
]

const DR_MIN = 6
const DR_MAX = 12

export function ModulatedPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const hasBackend = protocol === 'LoRa'
  const [modem, setModem] = useState<ModemName>('LoRa')
  const [freqMhz, setFreqMhz] = useState(902.3)
  const [bandwidth, setBandwidth] = useState(0)
  const [datarate, setDatarate] = useState(7)
  const [power, setPower] = useState(14)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)

  useEffect(() => {
    if (modem === 'FSK' && bandwidth !== 0) setBandwidth(0)
  }, [modem, bandwidth])

  const send = useMutation({
    mutationFn: () => {
      if (!hasBackend) {
        log('DUT', `${protocol} Modulated: no backend wired yet`, 'warn')
        return Promise.resolve(null)
      }
      return device.loraModulated({
        bandwidth,
        freq_hz: Math.round(freqMhz * 1_000_000),
        power_dbm: power,
        modem: MODEM[modem],
        datarate,
      })
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r)
      log('DUT', `Modulated sent: ok=${r.ok} status=${r.status}`)
      if (r.ok) setMeasureTrigger((n) => n + 1)
    },
    onError: (e: Error) => log('DUT', `Modulated failed: ${e.message}`, 'error'),
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
        label="Modulated"
        actions={
          <SendStopControls
            busy={busy}
            sending={send.isPending}
            stopping={stop.isPending}
            onSend={() => send.mutate()}
            onStop={() => stop.mutate()}
          />
        }
      />

      <PageBody width="form">
        <Section title="RF setup">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gridAutoFlow: { xs: 'row', md: 'column' },
              gridTemplateRows: { md: 'repeat(3, auto)' },
              columnGap: 2,
              rowGap: 2,
            }}
          >
            <LabeledField
              label="Frequency"
              hint="MHz"
              type="number"
              value={freqMhz}
              historyKey={`${protocol}.modulated.freqMhz`}
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }}
            />

            <LabeledField
              label="Modem"
              select
              value={modem}
              onChange={(e) => setModem(e.target.value as ModemName)}
            >
              <MenuItem value="LoRa">LoRa</MenuItem>
              <MenuItem value="FSK">FSK</MenuItem>
            </LabeledField>

            <LabeledField
              label="Power"
              hint="dBm"
              type="number"
              value={power}
              historyKey={`${protocol}.modulated.power_dbm`}
              onChange={(e) => setPower(Number(e.target.value))}
            />

            <Stack spacing={0.5}>
              <Typography component="span" sx={{ ...TEXT.label, color: 'text.primary' }}>
                Bandwidth
              </Typography>
              <TextField
                size="small"
                select
                value={bandwidth}
                disabled={modem === 'FSK'}
                onChange={(e) => setBandwidth(Number(e.target.value))}
              >
                {BW_OPTIONS.map((bw) => (
                  <MenuItem key={bw.code} value={bw.code} disabled={bw.code === 3}>
                    {bw.code} - {bw.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <LabeledField
              label="Datarate"
              hint={`${DR_MIN}-${DR_MAX}`}
              type="number"
              value={datarate}
              historyKey={`${protocol}.modulated.datarate`}
              inputProps={{ min: DR_MIN, max: DR_MAX, step: 1 }}
              onChange={(e) => setDatarate(Number(e.target.value))}
            />
          </Box>
        </Section>

        <MeasurementCard
          freqHz={Math.round(freqMhz * 1_000_000)}
          triggerId={measureTrigger}
        />

        {last && <FrameDump result={last} />}
      </PageBody>
    </Box>
  )
}
