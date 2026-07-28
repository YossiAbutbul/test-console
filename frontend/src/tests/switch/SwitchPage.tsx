import { useEffect, useState } from 'react'
import { Autocomplete, Box, Button, Slider, Stack, TextField, Typography } from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { servo, type ServoTarget } from '../../api/servo'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, Card, ConnectButton, MonoText, PageBody, Readout, Section,
  StatusChip, TEXT,
} from '../../ui'
import { useActionReporter } from '../engine/useRunReporter'
import type { TestPageProps } from '../types'

/** Slower than the trombone: the servo only reports its last commanded angle,
 *  so there is nothing to track mid-move. */
const POLL_MS = 1000

export function SwitchPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const reporter = useActionReporter('Switch move', 'Servo')
  const [port, setPort] = useState<string>('')
  const [ports, setPorts] = useState<string[]>([])
  const [angle, setAngle] = useState<number>(90)

  const statusQ = useQuery({
    queryKey: ['servo', 'status'],
    queryFn: servo.status,
    refetchInterval: (q) => (q.state.data?.connected ? POLL_MS : false),
    refetchOnWindowFocus: false,
  })

  const s = statusQ.data
  const connected = !!s?.connected
  const lastAngle = s?.last_angle ?? null

  useEffect(() => {
    if (lastAngle != null) setAngle(lastAngle)
  }, [lastAngle])

  const refresh = () => qc.invalidateQueries({ queryKey: ['servo', 'status'] })
  const onOk = (label: string) => () => { log('Servo', `${label} ok`); refresh() }
  const onErr = (label: string) => (e: Error) => log('Servo', `${label} failed: ${e.message}`, 'error')

  // Repositioning is the one operation the user waits on, so it reports through
  // the reporter; discovery, connect and save stay as plain log lines.
  const onMoveErr = (e: Error) => reporter.failed(e.message)

  const discoverM = useMutation({
    mutationFn: servo.discover,
    onSuccess: (r) => {
      setPorts(r.candidates)
      if (!port && r.candidates.length > 0) setPort(r.candidates[0])
    },
    onError: onErr('discover'),
  })

  useEffect(() => { discoverM.mutate() }, [])

  const connectM = useMutation({
    mutationFn: () => servo.connect(port),
    onSuccess: onOk('connect'), onError: onErr('connect'),
  })
  const disconnectM = useMutation({
    mutationFn: servo.disconnect,
    onSuccess: onOk('disconnect'), onError: onErr('disconnect'),
  })
  const moveM = useMutation({
    mutationFn: () => servo.move(angle),
    onMutate: () => reporter.started(`to ${angle}°`),
    onSuccess: () => { reporter.succeeded(`to ${angle}°`); refresh() },
    onError: onMoveErr,
  })
  const gotoM = useMutation({
    mutationFn: (t: ServoTarget) => servo.goto(t),
    onMutate: (t) => reporter.started(`to ${t} preset`),
    onSuccess: (_d, t) => { reporter.succeeded(`to ${t} preset`); refresh() },
    onError: onMoveErr,
  })
  const saveM = useMutation({
    mutationFn: (t: ServoTarget) => servo.save(t),
    onSuccess: (_d, t) => { log('Servo', `save ${t} ok`); refresh() },
    onError: onErr('save'),
  })

  const busy =
    connectM.isPending || disconnectM.isPending || moveM.isPending ||
    gotoM.isPending || saveM.isPending

  const statusDetail = [s?.port, s?.idn].filter(Boolean).join(' · ')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Switch"
        actions={
          <ConnectButton
            connected={connected}
            pending={connectM.isPending || disconnectM.isPending}
            disabled={busy || (!connected && !port)}
            onConnect={() => connectM.mutate()}
            onDisconnect={() => disconnectM.mutate()}
          />
        }
      />

      <PageBody width="panel">
        <Section title="Servo status" action={<MonoText>Arduino · 9600 8N1</MonoText>}>
          <Card>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1 }}>
                <Readout
                  label="Last angle"
                  value={lastAngle == null ? DASH : `${lastAngle}°`}
                  note={s?.last_command ? `last cmd: ${s.last_command}` : undefined}
                />
              </Box>
              {!connected && (
                <Autocomplete
                  size="small"
                  freeSolo
                  options={ports}
                  value={port}
                  onChange={(_e, v) => setPort(typeof v === 'string' ? v : (v ?? ''))}
                  onInputChange={(_e, v) => setPort(v ?? '')}
                  onOpen={() => discoverM.mutate()}
                  loading={discoverM.isPending}
                  sx={{ width: 180 }}
                  renderInput={(p) => <TextField {...p} label="Port" placeholder="COM3" />}
                />
              )}
              <StatusChip
                label={connected ? 'Connected' : 'Disconnected'}
                tone={connected ? 'ok' : 'off'}
                detail={connected ? statusDetail || undefined : undefined}
              />
            </Stack>
          </Card>
        </Section>

        <Section title="Angle">
          <Stack direction="row" spacing={2} alignItems="center">
            <Slider
              value={angle}
              onChange={(_e, v) => setAngle(Array.isArray(v) ? v[0] : v)}
              min={0}
              max={180}
              step={1}
              valueLabelDisplay="auto"
              marks={[
                { value: 0, label: '0°' },
                { value: 90, label: '90°' },
                { value: 180, label: '180°' },
              ]}
              disabled={!connected || busy}
              sx={{ flexGrow: 1 }}
            />
            <TextField
              size="small"
              type="number"
              value={angle}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setAngle(Math.max(0, Math.min(180, Math.round(n))))
              }}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              inputProps={{ min: 0, max: 180, step: 1 }}
              sx={{ width: 90 }}
              disabled={!connected || busy}
            />
            <Button
              variant="contained"
              onClick={() => moveM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.lg }}
            >
              Move
            </Button>
          </Stack>
        </Section>

        <Section title="Presets">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              onClick={() => gotoM.mutate('VNA')}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Go VNA
            </Button>
            <Button
              variant="outlined"
              onClick={() => gotoM.mutate('PCB')}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Go PCB
            </Button>
            <Box sx={{ width: 16 }} />
            <Button
              variant="text"
              startIcon={<SaveIcon sx={{ fontSize: 16 }} />}
              onClick={() => saveM.mutate('VNA')}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.wide, height: CONTROL_H.md }}
            >
              Save as VNA
            </Button>
            <Button
              variant="text"
              startIcon={<SaveIcon sx={{ fontSize: 16 }} />}
              onClick={() => saveM.mutate('PCB')}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.wide, height: CONTROL_H.md }}
            >
              Save as PCB
            </Button>
          </Stack>
        </Section>

        {s?.last_response && (
          <MonoText>last response: {s.last_response}</MonoText>
        )}
        {s?.error && (
          <Typography sx={{ ...TEXT.hint, color: 'error.main' }}>{s.error}</Typography>
        )}
      </PageBody>
    </Box>
  )
}
