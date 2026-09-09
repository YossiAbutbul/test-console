import { useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import StopIcon from '@mui/icons-material/Stop'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, ConnectButton, MONO, MonoText, PageBody, Section,
  StatRow, StatTile, StatusChip, TEXT, TwoCol,
} from '../../ui'
import { useActionReporter } from '../engine/useRunReporter'
import type { TestPageProps } from '../types'

/** Faster than the servo page: the position readout is the only feedback
 *  during a move, so it has to track the motor. */
const POLL_MS = 500

/**
 * Polled slowly while disconnected rather than not at all.
 *
 * The interval used to return `false` when the status said disconnected, which
 * switched the poll off — so connecting from the Instruments modal never
 * reached this page and the operator had to press Connect here as well, on an
 * instrument that was already up.
 */
const IDLE_POLL_MS = 2000

/** Used only to bound a jog when the motor has no soft limits configured. */
const OPEN_TRAVEL = 1_000_000

export function TrombonePage({ group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const reporter = useActionReporter('Trombone move', 'Motor')
  const [targetStr, setTargetStr] = useState<string>('0')
  const [targetFocused, setTargetFocused] = useState(false)
  const targetNum = Number(targetStr)
  const targetValid = targetStr.trim() !== '' && Number.isFinite(targetNum)
  const [deviceIndex, setDeviceIndex] = useState<number>(0)

  const statusQ = useQuery({
    queryKey: ['motor', 'status'],
    queryFn: motor.status,
    refetchInterval: (q) => (q.state.data?.connected ? POLL_MS : IDLE_POLL_MS),
    refetchOnWindowFocus: false,
  })

  const s = statusQ.data
  const connected = !!s?.connected
  const moving = !!s?.moving
  const pos = s?.position ?? null

  // Soft limits are set at runtime and are genuinely absent until they are.
  // The page used to substitute ±1,000,000 for "unset" and then report it as
  // fact — "range 2,000,000 pulses" — so an unconfigured motor looked
  // configured. Track whether they exist and say so instead.
  const hasLimits = s?.soft_min != null && s?.soft_max != null
  const softMin = s?.soft_min ?? -OPEN_TRAVEL
  const softMax = s?.soft_max ?? OPEN_TRAVEL
  const travel = softMax - softMin
  const roomBelow = pos == null ? null : pos - softMin
  const roomAbove = pos == null ? null : softMax - pos
  const pctOfTravel = pos == null || travel <= 0
    ? null
    : Math.max(0, Math.min(100, ((pos - softMin) / travel) * 100))

  const clampInc = (step: number): number => {
    if (pos == null) return step
    const want = pos + step
    const clamped = Math.max(softMin, Math.min(softMax, want))
    return clamped - pos
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['motor', 'status'] })
  const onOk = (label: string) => () => { log('Motor', `${label} ok`); refresh() }
  const onErr = (label: string) => (e: Error) => log('Motor', `${label} failed: ${e.message}`, 'error')

  // Absolute moves can take seconds of travel, so they announce themselves
  // through the reporter; jogs and connect stay as plain log lines.
  const pulses = (n: number) => `to ${n.toLocaleString()} pulses`
  const onMoveErr = (e: Error) => reporter.failed(e.message)
  const onMoveOk = (n: number) => () => { reporter.succeeded(pulses(n)); refresh() }

  const connectM = useMutation({ mutationFn: () => motor.connect(deviceIndex), onSuccess: onOk('connect'), onError: onErr('connect') })
  const disconnectM = useMutation({ mutationFn: motor.disconnect, onSuccess: onOk('disconnect'), onError: onErr('disconnect') })
  const moveM = useMutation({
    mutationFn: () => motor.move(targetNum, true),
    onMutate: () => reporter.started(pulses(targetNum)),
    onSuccess: onMoveOk(targetNum),
    onError: onMoveErr,
  })

  const targetInRange = targetValid && targetNum >= softMin && targetNum <= softMax
  const targetOutOfRange = targetValid && !targetInRange
  const jogPosM = useMutation({ mutationFn: () => motor.move(clampInc(3200), false), onSuccess: onOk('move +'), onError: onErr('move +') })
  const jogNegM = useMutation({ mutationFn: () => motor.move(clampInc(-3200), false), onSuccess: onOk('move -'), onError: onErr('move -') })
  const goMinM = useMutation({
    mutationFn: () => motor.move(softMin, true),
    onMutate: () => reporter.started(pulses(softMin)),
    onSuccess: onMoveOk(softMin),
    onError: onMoveErr,
  })
  const goMaxM = useMutation({
    mutationFn: () => motor.move(softMax, true),
    onMutate: () => reporter.started(pulses(softMax)),
    onSuccess: onMoveOk(softMax),
    onError: onMoveErr,
  })
  const stopM = useMutation({ mutationFn: motor.stop, onSuccess: onOk('stop'), onError: onErr('stop') })

  const busy =
    connectM.isPending || disconnectM.isPending || moveM.isPending ||
    jogPosM.isPending || jogNegM.isPending || goMinM.isPending ||
    goMaxM.isPending || stopM.isPending

  const statusText = !connected ? 'Disconnected' : moving ? 'Moving' : 'Idle'
  const num = (n: number | null) => (n == null ? DASH : n.toLocaleString())

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="Trombone"
        actions={
          // Stop lives in the header, not on the panel that happens to start a
          // move: this drives a physical axis, and the control that halts it
          // should be in one fixed place and reachable without first finding
          // which panel began the motion.
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<StopIcon />}
              onClick={() => stopM.mutate()}
              disabled={!connected || stopM.isPending}
              sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
            >
              {stopM.isPending ? 'Stopping…' : 'Stop'}
            </Button>
            <ConnectButton
              connected={connected}
              pending={connectM.isPending || disconnectM.isPending}
              disabled={busy}
              onConnect={() => connectM.mutate()}
              onDisconnect={() => disconnectM.mutate()}
            />
          </Stack>
        }
      />

      <PageBody width="fluid">
        {/* Where the carriage is, and how much travel is left either way —
            the numbers a jog is decided from. */}
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
              Position
            </Typography>
            <MonoText sx={{ fontSize: 11 }}>MT986A · Arcus DMX-J-SA</MonoText>
            <Box sx={{ flexGrow: 1 }} />
            {!connected && (
              // Inline in the status row, so the name sits beside the box
              // rather than above it -- a stacked label here would push the
              // row taller than the chip it lines up with.
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Index</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={deviceIndex}
                  onChange={(e) => setDeviceIndex(Math.max(0, Number(e.target.value) || 0))}
                  inputProps={{ min: 0, max: 15 }}
                  sx={{ width: 64, '& .MuiInputBase-root': { height: 26 } }}
                />
              </Stack>
            )}
            <StatusChip
              label={statusText}
              tone={connected ? (moving ? 'busy' : 'ok') : 'off'}
              spinning={connected && moving}
            />
          </Stack>

          <StatRow>
            <StatTile
              label="Position"
              value={num(pos)}
              unit={pos == null ? undefined : 'pulses'}
              sub={pctOfTravel == null ? undefined : `${pctOfTravel.toFixed(0)}% of travel`}
              off={!connected}
            />
            <StatTile
              label="Room below"
              value={hasLimits ? num(roomBelow) : DASH}
              unit={hasLimits && roomBelow != null ? 'pulses' : undefined}
              sub={hasLimits ? `min ${softMin.toLocaleString()}` : 'no soft limit'}
              off={!connected || !hasLimits}
            />
            <StatTile
              label="Room above"
              value={hasLimits ? num(roomAbove) : DASH}
              unit={hasLimits && roomAbove != null ? 'pulses' : undefined}
              sub={hasLimits ? `max ${softMax.toLocaleString()}` : 'no soft limit'}
              off={!connected || !hasLimits}
            />
          </StatRow>

          {/* The bar only means something against known ends. */}
          {hasLimits && (
            <Box sx={{ mt: 1.25 }}>
              <Box
                sx={{
                  position: 'relative', height: 6, borderRadius: 3,
                  bgcolor: 'action.hover', overflow: 'hidden',
                }}
              >
                {pctOfTravel != null && (
                  <Box
                    sx={{
                      position: 'absolute', top: 0, bottom: 0, left: 0,
                      width: `${pctOfTravel}%`,
                      bgcolor: moving ? 'warning.main' : 'primary.main',
                      transition: 'width 0.3s',
                    }}
                  />
                )}
              </Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  {softMin.toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                  {travel.toLocaleString()} pulses of travel
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  {softMax.toLocaleString()}
                </Typography>
              </Stack>
            </Box>
          )}

          {s?.error && (
            <Typography sx={{ ...TEXT.hint, color: 'error.main', mt: 1 }}>{s.error}</Typography>
          )}
        </Box>

        <TwoCol stretch>
          <Section title="Move to" panel>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <LabeledField
                label="Target"
                hint={hasLimits
                  ? `${softMin.toLocaleString()} … ${softMax.toLocaleString()}`
                  : 'pulses'}
                type="number"
                value={targetStr}
                inputProps={{ min: softMin, max: softMax, step: 100 }}
                onChange={(e) => setTargetStr(e.target.value)}
                onFocus={() => setTargetFocused(true)}
                onBlur={() => setTargetFocused(false)}
                error={targetOutOfRange || (!targetValid && targetStr.trim() !== '')}
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={shouldShowValidation(targetStr, targetValid && targetInRange, targetFocused)}
                      message={
                        targetStr.trim() === ''
                          ? 'Enter a value'
                          : targetOutOfRange
                            ? `Out of range — must be ${softMin.toLocaleString()} … ${softMax.toLocaleString()}`
                            : 'Invalid number'
                      }
                    />
                  ),
                }}
              />
              <Button
                variant="contained"
                onClick={() => moveM.mutate()}
                disabled={!connected || busy || !targetInRange}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md, mt: '22px', flexShrink: 0 }}
              >
                Move
              </Button>
            </Stack>
          </Section>

          <Section title="Jog" panel hint="Steps of 3,200 pulses, clamped to the soft limits.">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={() => jogNegM.mutate()}
                disabled={!connected || busy}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Step down
              </Button>
              <Button
                variant="outlined"
                endIcon={<ArrowForwardIcon />}
                onClick={() => jogPosM.mutate()}
                disabled={!connected || busy}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Step up
              </Button>
              <Button
                variant="outlined"
                startIcon={<FirstPageIcon />}
                onClick={() => goMinM.mutate()}
                disabled={!connected || busy || !hasLimits}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Go min
              </Button>
              <Button
                variant="outlined"
                endIcon={<LastPageIcon />}
                onClick={() => goMaxM.mutate()}
                disabled={!connected || busy || !hasLimits}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
              >
                Go max
              </Button>
            </Stack>
          </Section>
        </TwoCol>
      </PageBody>
    </Box>
  )
}
