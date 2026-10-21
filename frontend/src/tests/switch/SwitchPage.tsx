import { useEffect, useState } from 'react'
import {
  Autocomplete, Box, Button, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/SaveRounded'
import AddIcon from '@mui/icons-material/AddRounded'
import RemoveIcon from '@mui/icons-material/RemoveRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { servo, type ServoTarget } from '../../api/servo'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, InstrumentBar, KeySpinner, MONO, PageBody, Section,
  actionSx,
  StatRow, StatTile, TEXT, TwoCol,
  HazardGlyph, hazardRingSx,
  InstrumentError,
} from '../../ui'
import { useActionReporter } from '../engine/useRunReporter'
import type { TestPageProps } from '../types'
import { selectOnFocus } from '../../lib/selectOnFocus'

/** Slower than the trombone: the servo only reports its last commanded angle,
 *  so there is nothing to track mid-move. */
const POLL_MS = 1000

/**
 * Polled slowly while disconnected rather than not at all.
 *
 * The interval used to return `false` when the status said disconnected, which
 * switched the poll off — so connecting from the Instruments modal never
 * reached this page and the operator had to press Connect here as well, on an
 * instrument that was already up.
 */
const IDLE_POLL_MS = 2000

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
  // Quiet: a servo move is instant and the operator is looking straight at the
  // result, so a modal per nudge is in the way rather than informative.
  const reporter = useActionReporter('Switch move', 'Servo', { quietSuccess: true })
  const [port, setPort] = useState<string>('')
  const [ports, setPorts] = useState<string[]>([])
  const [angle, setAngle] = useState<number>(90)

  const statusQ = useQuery({
    queryKey: ['servo', 'status'],
    queryFn: servo.status,
    refetchInterval: (q) => (q.state.data?.connected ? POLL_MS : IDLE_POLL_MS),
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

  // A square outlined key at the angle field's height, so the row reads as one
  // line of controls -- the same Button as every other key, not a hand-drawn
  // bordered IconButton.
  const nudgeSx = {
    width: CONTROL_H.md, minWidth: CONTROL_H.md, height: CONTROL_H.md, px: 0,
    fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
  } as const
  const nudgeKey = (by: number, label: string, tip: string, aria: string, Icon?: typeof AddIcon) => (
    <Tooltip title={tip}>
      <span>
        <Button
          variant="outlined"
          sx={nudgeSx}
          disabled={!connected || busy || (by < 0 ? angle <= ANGLE_MIN : angle >= ANGLE_MAX)}
          onClick={() => nudge(by)}
          aria-label={aria}
        >
          {Icon ? <Icon sx={{ fontSize: 16 }} /> : label}
        </Button>
      </span>
    </Tooltip>
  )
  // Which key started the pending mutation, so only that one spins.
  const gotoPending = (t: ServoTarget) => gotoM.isPending && gotoM.variables === t
  const savePending = (t: ServoTarget) => saveM.isPending && saveM.variables === t

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader group={group} label="Switch" />

      <PageBody width="fluid">
        <InstrumentBar
          name="RF switch"
          model="Servo (Arduino) · 9600 8N1"
          status={connectM.isPending ? 'connecting' : connected ? 'connected' : 'disconnected'}
          detail={statusDetail || null}
          summary={port || null}
          configReady={!!port}
          pending={disconnectM.isPending}
          disabled={busy && !connectM.isPending}
          onConnect={() => connectM.mutate()}
          onDisconnect={() => disconnectM.mutate()}
          config={
            <Box>
              {/* Set like LabeledField's label, so this dialog reads like the
                  forms on the pages. */}
              <Typography sx={{ ...TEXT.label, color: 'text.primary', mb: 0.5 }}>Port</Typography>
              <Autocomplete
                size="small"
                freeSolo
                disabled={connected}
                options={ports}
                value={port}
                onChange={(_e, v) => setPort(typeof v === 'string' ? v : (v ?? ''))}
                onInputChange={(_e, v) => setPort(v ?? '')}
                onOpen={() => discoverM.mutate()}
                loading={discoverM.isPending}
                renderInput={(p) => <TextField {...p} placeholder="COM3" />}
              />
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 0.75 }}>
                The USB-serial port. Listing ports never opens them, so the Arduino is not reset.
              </Typography>
            </Box>
          }
        />

        <Box>
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
              // The degree sign belongs to the number: as a unit it sat a
              // space away ("124 °").
              value={lastAngle == null ? DASH : `${lastAngle}°`}
              // Not a gap in the readout: the preset position lives on the
              // Arduino, so the host genuinely does not know the angle.
              sub={lastAngle == null && path != null && path !== 'Manual'
                ? 'held by the servo'
                : undefined}
              off={!connected || lastAngle == null}
            />
          </StatRow>

          {s?.error && (
            <InstrumentError message={s.error} raw />
          )}
        </Box>

        <TwoCol stretch>
          {/* The everyday operation: two paths, one button each. */}
          {/* All three servo keys (Go VNA, Go PCB, Move) are the same grey
              hazard key. A filled Go key used to mean "current path" while a
              filled Move meant "primary" -- one colour, two meanings. The
              Selected tile is what says which path is on. */}
          <Section title="Presets" panel hint="Positions stored on the servo itself.">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                onClick={() => gotoM.mutate('VNA')}
                disabled={!connected || busy}
                startIcon={gotoPending('VNA') ? <KeySpinner /> : <HazardGlyph kind="path" />}
                sx={[{ width: ACTION_W.default, height: CONTROL_H.md }, hazardRingSx('path')]}
              >
                Go VNA
              </Button>
              <Button
                variant="outlined"
                onClick={() => gotoM.mutate('PCB')}
                disabled={!connected || busy}
                startIcon={gotoPending('PCB') ? <KeySpinner /> : <HazardGlyph kind="path" />}
                sx={[{ width: ACTION_W.default, height: CONTROL_H.md }, hazardRingSx('path')]}
              >
                Go PCB
              </Button>
            </Stack>
          </Section>

          {/* Calibration: drive to an angle, then store it as a preset. Save
              records wherever the servo is standing, so it belongs here rather
              than beside the Go buttons it looks like it matches. */}
          <Section
            title="Manual angle"
            panel
            hint={`Move to an angle from ${ANGLE_MIN} to ${ANGLE_MAX}°, then store the current position as a preset.`}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
              {nudgeKey(-10, '−10', '−10°', 'minus ten degrees')}
              {nudgeKey(-1, '−1', '−1°', 'minus one degree', RemoveIcon)}
              <TextField
                size="small"
                type="number"
                value={angle}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) setAngle(clampAngle(n))
                }}
                onFocus={selectOnFocus}
                inputProps={{ min: ANGLE_MIN, max: ANGLE_MAX, step: 1 }}
                disabled={!connected || busy}
                sx={{
                  width: 82,
                  '& input': { fontFamily: MONO, textAlign: 'center', fontWeight: 600 },
                }}
              />
              {nudgeKey(1, '+1', '+1°', 'plus one degree', AddIcon)}
              {nudgeKey(10, '+10', '+10°', 'plus ten degrees')}
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="outlined"
                onClick={() => moveM.mutate()}
                disabled={!connected || busy}
                // Drives the servo, so it is a hazard key like Go VNA / Go PCB.
                startIcon={moveM.isPending ? <KeySpinner /> : <HazardGlyph kind="path" />}
                sx={[{ width: ACTION_W.default, height: CONTROL_H.md }, hazardRingSx('path')]}
              >
                Move
              </Button>
            </Stack>

            {/* Real keys, not 24 px text links: storing overwrites a preset
                on the Arduino, which is worth a key the size of the others. */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="outlined"
                startIcon={savePending('VNA') ? <KeySpinner /> : <SaveIcon />}
                onClick={() => saveM.mutate('VNA')}
                disabled={!connected || busy}
                sx={actionSx(ACTION_W.wide)}
              >
                Store as VNA
              </Button>
              <Button
                variant="outlined"
                startIcon={savePending('PCB') ? <KeySpinner /> : <SaveIcon />}
                onClick={() => saveM.mutate('PCB')}
                disabled={!connected || busy}
                sx={actionSx(ACTION_W.wide)}
              >
                Store as PCB
              </Button>
            </Stack>
          </Section>
        </TwoCol>
      </PageBody>
    </Box>
  )
}
