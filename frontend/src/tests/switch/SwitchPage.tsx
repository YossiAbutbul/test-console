import { useEffect, useState } from 'react'
import {
  Autocomplete, Box, Button, Chip, Slider, Stack, TextField, Typography,
} from '@mui/material'
import PowerIcon from '@mui/icons-material/Power'
import SaveIcon from '@mui/icons-material/Save'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { servo, type ServoTarget } from '../../api/servo'
import { useLog } from '../../context/LogContext'
import type { TestPageProps } from '../types'

const POLL_MS = 1000

export function SwitchPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
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
    onSuccess: onOk(`move ${angle}`), onError: onErr('move'),
  })
  const gotoM = useMutation({
    mutationFn: (t: ServoTarget) => servo.goto(t),
    onSuccess: (_d, t) => { log('Servo', `goto ${t} ok`); refresh() },
    onError: onErr('goto'),
  })
  const saveM = useMutation({
    mutationFn: (t: ServoTarget) => servo.save(t),
    onSuccess: (_d, t) => { log('Servo', `save ${t} ok`); refresh() },
    onError: onErr('save'),
  })

  const busy =
    connectM.isPending || disconnectM.isPending || moveM.isPending ||
    gotoM.isPending || saveM.isPending

  const statusColor = connected ? 'success.main' : 'text.disabled'
  const statusText = connected
    ? `Connected · ${s?.port ?? ''}${s?.idn ? ` · ${s.idn}` : ''}`
    : 'Disconnected'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Switch"
        actions={
          <Button
            variant={connected ? 'outlined' : 'contained'}
            startIcon={<PowerIcon sx={{ fontSize: 16 }} />}
            onClick={() => (connected ? disconnectM.mutate() : connectM.mutate())}
            disabled={busy || (!connected && !port)}
            sx={{ height: 36, minWidth: 120 }}
          >
            {connectM.isPending || disconnectM.isPending ? '…' : connected ? 'Disconnect' : 'Connect'}
          </Button>
        }
      />

      <Stack spacing={2} sx={{ mt: 1, maxWidth: 720 }}>
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Servo status
            <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
              Arduino · 9600 8N1
            </Typography>
          </Typography>

          <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
                  Last angle
                </Typography>
                <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 22, fontWeight: 600 }}>
                  {lastAngle == null ? '—' : `${lastAngle}°`}
                  {s?.last_command && (
                    <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
                      last cmd: {s.last_command}
                    </Typography>
                  )}
                </Typography>
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
              <Chip
                size="small"
                icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor, ml: 0.75 }} />}
                label={statusText}
                sx={{ fontSize: 11.5, fontWeight: 600, color: statusColor, maxWidth: 260 }}
              />
            </Stack>
          </Box>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Angle
          </Typography>
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
              sx={{ minWidth: 110, height: 40 }}
            >
              Move
            </Button>
          </Stack>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Presets
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              onClick={() => gotoM.mutate('VNA')}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Go VNA
            </Button>
            <Button
              variant="outlined"
              onClick={() => gotoM.mutate('PCB')}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Go PCB
            </Button>
            <Box sx={{ width: 16 }} />
            <Button
              variant="text"
              startIcon={<SaveIcon sx={{ fontSize: 16 }} />}
              onClick={() => saveM.mutate('VNA')}
              disabled={!connected || busy}
              sx={{ minWidth: 140, height: 36 }}
            >
              Save as VNA
            </Button>
            <Button
              variant="text"
              startIcon={<SaveIcon sx={{ fontSize: 16 }} />}
              onClick={() => saveM.mutate('PCB')}
              disabled={!connected || busy}
              sx={{ minWidth: 140, height: 36 }}
            >
              Save as PCB
            </Button>
          </Stack>
        </Box>

        {s?.last_response && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
            last response: {s.last_response}
          </Typography>
        )}
        {s?.error && (
          <Typography sx={{ fontSize: 12, color: 'error.main' }}>{s.error}</Typography>
        )}
      </Stack>
    </Box>
  )
}
