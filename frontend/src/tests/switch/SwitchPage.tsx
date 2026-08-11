import { useEffect, useState } from 'react'
import {
  Autocomplete, Box, Button, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { servo, type ServoTarget } from '../../api/servo'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, ConnectButton, MONO, MonoText, PageBody, Section,
  StatRow, StatTile, StatusChip, TEXT, TwoCol,
} from '../../ui'
import { useActionReporter } from '../engine/useRunReporter'
import type { TestPageProps } from '../types'

/** Slower than the trombone: the servo only reports its last commanded angle,
 *  so there is nothing to track mid-move. */
const POLL_MS = 1000

const ANGLE_MIN = 0
const ANGLE_MAX = 180

const clampAngle = (n: number) =>
  Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(n)))

/**
 * Which path the switch is on, read from the last command the servo was sent.
 *
 * `last_angle` cannot answer this: going to a preset moves the servo to a
 * position stored on the Arduino, so the backend clears the angle it no longer
 * knows — which is exactly when you most want to know where the switch is.
 */
function pathOf(lastCommand: string | null): string | null {
  if (!lastCommand) return null
  const c = lastCommand.trim().toUpperCase()
  if (c.startsWith('VNA')) return 'VNA'
  if (c.startsWith('PCB')) return 'PCB'
  if (/^\d+$/.test(c)) return 'Manual'
  return null
}

export function SwitchPage({ group }: TestPageProps) {
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
  const path = pathOf(s?.last_command ?? null)

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
  const nudge = (by: number) => setAngle((a) => clampAngle(a + by))

  const nudgeSx = {
    width: 30, height: 30, borderRadius: 1,
    border: 1, borderColor: 'divider',
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
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

      <PageBody width="fluid">
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
              RF path
            </Typography>
            <MonoText sx={{ fontSize: 11 }}>Arduino · 9600 8N1</MonoText>
            <Box sx={{ flexGrow: 1 }} />
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
                sx={{ width: 170 }}
                renderInput={(p) => <TextField {...p} label="Port" placeholder="COM3" />}
              />
            )}
            <StatusChip
              label={connected ? 'Connected' : 'Disconnected'}
              tone={connected ? 'ok' : 'off'}
              detail={connected ? statusDetail || undefined : undefined}
            />
          </Stack>

          <StatRow>
            <StatTile
              label="Selected"
              value={path ?? DASH}
              sub={path == null
                ? (connected ? 'no move sent yet' : 'not connected')
                : path === 'Manual' ? 'set by angle' : 'preset'}
              off={!connected || path == null}
            />
            <StatTile
              label="Angle"
              value={lastAngle == null ? DASH : String(lastAngle)}
              unit={lastAngle == null ? undefined : '°'}
              // Not a gap in the readout: the preset position lives on the
              // Arduino, so the host genuinely does not know the angle.
              sub={lastAngle == null && path != null && path !== 'Manual'
                ? 'held by the servo'
                : undefined}
              off={!connected || lastAngle == null}
            />
          </StatRow>

          {s?.error && (
            <Typography sx={{ ...TEXT.hint, color: 'error.main', mt: 1 }}>{s.error}</Typography>
          )}
        </Box>

        <TwoCol stretch>
          {/* The everyday operation: two paths, one button each. */}
          <Section title="Presets" panel hint="Positions stored on the servo itself.">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant={path === 'VNA' ? 'contained' : 'outlined'}
                onClick={() => gotoM.mutate('VNA')}
                disabled={!connected || busy}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Go VNA
              </Button>
              <Button
                variant={path === 'PCB' ? 'contained' : 'outlined'}
                onClick={() => gotoM.mutate('PCB')}
                disabled={!connected || busy}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Go PCB
              </Button>
            </Stack>
          </Section>

          {/* Calibration: drive to an angle, then store it as a preset. Save
              records wherever the servo is standing, so it belongs here rather
              than beside the Go buttons it looks like it matches. */}
          <Section title="Manual angle" panel hint={`${ANGLE_MIN}–${ANGLE_MAX}°, then store it as a preset.`}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1.25 }}>
              <IconButton
                size="small" sx={nudgeSx} disabled={!connected || busy || angle <= ANGLE_MIN}
                onClick={() => nudge(-10)} aria-label="minus ten degrees"
              >
                <Typography sx={{ fontSize: 11, fontWeight: 700 }}>10</Typography>
              </IconButton>
              <IconButton
                size="small" sx={nudgeSx} disabled={!connected || busy || angle <= ANGLE_MIN}
                onClick={() => nudge(-1)} aria-label="minus one degree"
              >
                <RemoveIcon sx={{ fontSize: 15 }} />
              </IconButton>
              <TextField
                size="small"
                type="number"
                value={angle}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) setAngle(clampAngle(n))
                }}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                inputProps={{ min: ANGLE_MIN, max: ANGLE_MAX, step: 1 }}
                disabled={!connected || busy}
                sx={{
                  width: 82,
                  '& input': { fontFamily: MONO, textAlign: 'center', fontWeight: 600 },
                }}
              />
              <IconButton
                size="small" sx={nudgeSx} disabled={!connected || busy || angle >= ANGLE_MAX}
                onClick={() => nudge(1)} aria-label="plus one degree"
              >
                <AddIcon sx={{ fontSize: 15 }} />
              </IconButton>
              <IconButton
                size="small" sx={nudgeSx} disabled={!connected || busy || angle >= ANGLE_MAX}
                onClick={() => nudge(10)} aria-label="plus ten degrees"
              >
                <Typography sx={{ fontSize: 11, fontWeight: 700 }}>10</Typography>
              </IconButton>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                onClick={() => moveM.mutate()}
                disabled={!connected || busy}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Move
              </Button>
            </Stack>

            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mr: 0.5 }}>
                Store current position as
              </Typography>
              <Button
                size="small" variant="text"
                startIcon={<SaveIcon sx={{ fontSize: 15 }} />}
                onClick={() => saveM.mutate('VNA')}
                disabled={!connected || busy}
                sx={{ minWidth: 0, height: 24, fontSize: 12, px: 1 }}
              >
                VNA
              </Button>
              <Button
                size="small" variant="text"
                startIcon={<SaveIcon sx={{ fontSize: 15 }} />}
                onClick={() => saveM.mutate('PCB')}
                disabled={!connected || busy}
                sx={{ minWidth: 0, height: 24, fontSize: 12, px: 1 }}
              >
                PCB
              </Button>
            </Stack>
          </Section>
        </TwoCol>
      </PageBody>
    </Box>
  )
}
