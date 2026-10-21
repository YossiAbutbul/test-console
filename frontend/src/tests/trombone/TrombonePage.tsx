import { useState } from 'react'
import { Box, Button, Stack, TextField, Tooltip, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardRounded'
import FirstPageIcon from '@mui/icons-material/FirstPageRounded'
import LastPageIcon from '@mui/icons-material/LastPageRounded'
import StopIcon from '@mui/icons-material/StopRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import { JOG_SPEEDS, fmtMm, mmToPulses, pulsesToMm } from '../../lib/trombone'
import { useHoldJog } from './useHoldJog'
import { loadPullPageSnapshot } from '../../store/loadPullPageStore'
import {
  ACTION_W, CONTROL_H, InstrumentBar, KeySpinner, MONO, PageBody, Section,
  StatRow, StatTile, TEXT, TwoCol, JogPad, SegmentedChoice,
  hazardRingSx,
  InstrumentError,
  HazardGlyph,
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

/**
 * One jog step. 8 mm is the 3,200 pulses the page always stepped by -- the
 * unit changed, the distance did not.
 */
const JOG_STEP_MM = 8
const JOG_STEP_PULSES = mmToPulses(JOG_STEP_MM)

/** Every key in the Step card is one width, so the 2×2 grid has fixed
 *  columns and the keys never re-wrap 3+1 / 2+2 with the window. */
const STEP_KEY_SX = { width: ACTION_W.default, minWidth: ACTION_W.default, height: CONTROL_H.md } as const

export function TrombonePage({ group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const reporter = useActionReporter('Trombone move', 'Motor')
  // Typed in mm; the motor is commanded in the whole pulse nearest to it.
  const [targetStr, setTargetStr] = useState<string>('0')
  const [targetFocused, setTargetFocused] = useState(false)
  const targetNum = Number(targetStr)
  const targetValid = targetStr.trim() !== '' && Number.isFinite(targetNum)
  const targetPulses = targetValid ? mmToPulses(targetNum) : 0
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
  const pulses = (n: number) => `to ${fmtMm(n)} (${n.toLocaleString()} pulses)`
  const onMoveErr = (e: Error) => reporter.failed(e.message)
  const onMoveOk = (n: number) => () => { reporter.succeeded(pulses(n)); refresh() }

  const connectM = useMutation({ mutationFn: () => motor.connect(deviceIndex), onSuccess: onOk('connect'), onError: onErr('connect') })
  const disconnectM = useMutation({ mutationFn: motor.disconnect, onSuccess: onOk('disconnect'), onError: onErr('disconnect') })
  const moveM = useMutation({
    mutationFn: () => motor.move(targetPulses, true),
    onMutate: () => reporter.started(pulses(targetPulses)),
    onSuccess: onMoveOk(targetPulses),
    onError: onMoveErr,
  })

  const targetInRange = targetValid && targetPulses >= softMin && targetPulses <= softMax
  const targetOutOfRange = targetValid && !targetInRange
  const jogPosM = useMutation({ mutationFn: () => motor.move(clampInc(JOG_STEP_PULSES), false), onSuccess: onOk('move +'), onError: onErr('move +') })
  const jogNegM = useMutation({ mutationFn: () => motor.move(clampInc(-JOG_STEP_PULSES), false), onSuccess: onOk('move -'), onError: onErr('move -') })
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

  // Press-and-hold jog, as on Load Pull: hold an arrow (or focus the pad and
  // hold ← / →) to run the motor, release to stop. Blocked while a step or
  // move is in flight, so a jog never races another command on the bus.
  const [jogSpeed, setJogSpeed] = useState<number>(800)
  const jog = useHoldJog({ enabled: connected && !busy, speed: jogSpeed, onStopped: refresh })

  const statusText = !connected ? 'Disconnected' : moving ? 'Moving' : 'Idle'
  const mmNum = (n: number | null) => (n == null ? DASH : pulsesToMm(n).toFixed(2))
  const pulseNum = (n: number) => `${n.toLocaleString()} pulses`
  // Captured on the Load Pull page; shown here so a manual move can be judged
  // against the cycle the sweep will use. Read at render, which the status
  // poll repeats often enough to pick up a fresh capture.
  const lpZero = loadPullPageSnapshot.zeroPulses ?? null
  const lpEnd = loadPullPageSnapshot.endPulses ?? null

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
            {/* Plain outlined, like Stop on every other page: the safe way out
                is not red -- red marks the keys that act on the bench. */}
            <Button
              variant="outlined"
              // Spinner in the icon slot rather than a "Stopping…" label: the
              // key keeps its word and its width while the stop is in flight.
              startIcon={stopM.isPending ? <KeySpinner /> : <StopIcon />}
              onClick={() => stopM.mutate()}
              disabled={!connected || stopM.isPending}
              sx={{ width: ACTION_W.default, minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Stop
            </Button>
          </Stack>
        }
      />

      <PageBody width="fluid">
        {/* Where the carriage is, and how much travel is left either way —
            the numbers a jog is decided from. */}
        <InstrumentBar
          name="RF trombone"
          model="MT986A · Arcus DMX-J-SA"
          status={connectM.isPending ? 'connecting' : connected ? 'connected' : 'disconnected'}
          liveLabel={statusText}
          liveTone={moving ? 'busy' : 'ok'}
          detail={`device #${deviceIndex}`}
          summary={`device #${deviceIndex}`}
          pending={disconnectM.isPending}
          disabled={busy && !connectM.isPending}
          onConnect={() => connectM.mutate()}
          onDisconnect={() => disconnectM.mutate()}
          config={
            <Box>
              {/* Set like LabeledField's label, so this dialog reads like the
                  forms on the pages. */}
              <Typography sx={{ ...TEXT.label, color: 'text.primary', mb: 0.5 }}>Device index</Typography>
              <TextField
                size="small"
                type="number"
                value={deviceIndex}
                disabled={connected}
                onChange={(e) => setDeviceIndex(Math.max(0, Math.min(15, Number(e.target.value) || 0)))}
                inputProps={{ min: 0, max: 15 }}
                sx={{ width: 96, '& input': { fontFamily: MONO } }}
              />
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 0.75 }}>
                0 with one controller on USB. Connecting energises the motor.
              </Typography>
            </Box>
          }
        />

        <Box>
          <StatRow>
            <StatTile
              label="Position"
              value={mmNum(pos)}
              unit={pos == null ? undefined : 'mm'}
              sub={pos == null
                ? (connected ? 'waiting for position' : undefined)
                : pctOfTravel == null || !hasLimits
                  ? pulseNum(pos)
                  : `${pulseNum(pos)} · ${pctOfTravel.toFixed(0)}% of travel`}
              off={!connected}
            />
            <StatTile
              label="Room below"
              value={hasLimits ? mmNum(roomBelow) : DASH}
              unit={hasLimits && roomBelow != null ? 'mm' : undefined}
              sub={hasLimits ? `min ${fmtMm(softMin)} · ${pulseNum(softMin)}` : 'no soft limit'}
              off={!connected || !hasLimits}
            />
            <StatTile
              label="Room above"
              value={hasLimits ? mmNum(roomAbove) : DASH}
              unit={hasLimits && roomAbove != null ? 'mm' : undefined}
              sub={hasLimits ? `max ${fmtMm(softMax)} · ${pulseNum(softMax)}` : 'no soft limit'}
              off={!connected || !hasLimits}
            />
          </StatRow>

          {s?.error && (
            <InstrumentError message={s.error} raw />
          )}
        </Box>

        <TwoCol stretch>
          <Section title="Move to" panel>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <LabeledField
                label="Target"
                hint={hasLimits
                  ? `${pulsesToMm(softMin).toFixed(2)} … ${pulsesToMm(softMax).toFixed(2)} mm`
                  : 'mm'}
                type="number"
                value={targetStr}
                inputProps={{ min: pulsesToMm(softMin), max: pulsesToMm(softMax), step: 0.25 }}
                onChange={(e) => setTargetStr(e.target.value)}
                onFocus={() => setTargetFocused(true)}
                onBlur={() => setTargetFocused(false)}
                // Capped: a millimetre target needs no more, and a field
                // stretched to the card's width pushed Move to the far edge.
                sx={{ maxWidth: 240 }}
                error={targetOutOfRange || (!targetValid && targetStr.trim() !== '')}
                // On the input's own row, through the kit's slot for it: a
                // margin nudge to line it up was being reset by the Stack.
                action={
                  <Button
                    variant="contained"
                    onClick={() => moveM.mutate()}
                    disabled={!connected || busy || !targetInRange}
                    startIcon={moveM.isPending ? <KeySpinner /> : <HazardGlyph kind="move" />}
                    sx={[{ width: ACTION_W.default, height: CONTROL_H.md, flexShrink: 0 }, hazardRingSx('move')]}
                  >
                    Move
                  </Button>
                }
                InputProps={{
                  endAdornment: (
                    <ValidationAdornment
                      show={shouldShowValidation(targetStr, targetValid && targetInRange, targetFocused)}
                      message={
                        targetStr.trim() === ''
                          ? 'Enter a value'
                          : targetOutOfRange
                            ? `Out of range — must be ${fmtMm(softMin)} … ${fmtMm(softMax)}`
                            : 'Invalid number'
                      }
                    />
                  ),
                }}
              />
            </Stack>
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: 0.75 }}>
              {targetValid ? `Sends ${pulseNum(targetPulses)}.` : DASH}
              {(lpZero != null || lpEnd != null) && (
                <>
                  {' '}Load Pull zero {lpZero == null ? 'not set' : fmtMm(lpZero)}
                  {' · '}end {lpEnd == null ? 'not set' : fmtMm(lpEnd)}.
                </>
              )}
            </Typography>
          </Section>

          <Section
            title="Step"
            panel
            hint={hasLimits
              ? `Steps of ${JOG_STEP_MM} mm (${pulseNum(JOG_STEP_PULSES)}), clamped to the soft limits.`
              : `Steps of ${JOG_STEP_MM} mm. No soft limits set — travel is not bounded.`}
          >
            {/* A fixed 2-column grid: the hold-to-jog pad and its speed across
                the top, then the steps, then the ends. A wrapping row broke
                3+1 at 1440 px and 2+2 at 1280. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(2, ${ACTION_W.default}px)`, gap: 1 }}>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <JogPad
                  dir={jog.dir}
                  focused={jog.focused}
                  disabled={!connected || busy}
                  onStart={jog.start}
                  onStop={jog.stop}
                  onKeyDown={jog.onKeyDown}
                  onKeyUp={jog.onKeyUp}
                  onFocusChange={jog.setFocused}
                />
              </Box>
              {/* The speed applies to the hold-to-jog only, not to the steps
                  or the moves. */}
              <Box sx={{ gridColumn: '1 / -1' }}>
                <SegmentedChoice
                  text
                  fullWidth
                  size="md"
                  aria-label="Jog speed"
                  value={String(jogSpeed)}
                  options={JOG_SPEEDS}
                  onChange={(v) => setJogSpeed(Number(v))}
                  disabled={!connected || busy}
                />
              </Box>
              <Button
                variant="outlined"
                startIcon={jogNegM.isPending ? <KeySpinner /> : <ArrowBackIcon />}
                onClick={() => jogNegM.mutate()}
                disabled={!connected || busy}
                aria-label={`Step down ${JOG_STEP_MM} mm`}
                sx={[STEP_KEY_SX, hazardRingSx('move')]}
              >
                −{JOG_STEP_MM} mm
              </Button>
              <Button
                variant="outlined"
                endIcon={jogPosM.isPending ? <KeySpinner /> : <ArrowForwardIcon />}
                onClick={() => jogPosM.mutate()}
                disabled={!connected || busy}
                aria-label={`Step up ${JOG_STEP_MM} mm`}
                sx={[STEP_KEY_SX, hazardRingSx('move')]}
              >
                +{JOG_STEP_MM} mm
              </Button>
              {/* The reason sits on a span: a disabled button fires no hover,
                  so a tooltip on the button itself would never show. */}
              <Tooltip title={hasLimits ? '' : 'No soft limits set'}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={goMinM.isPending ? <KeySpinner /> : <FirstPageIcon />}
                    onClick={() => goMinM.mutate()}
                    disabled={!connected || busy || !hasLimits}
                    sx={[STEP_KEY_SX, hazardRingSx('move')]}
                  >
                    Go min
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={hasLimits ? '' : 'No soft limits set'}>
                <span>
                  <Button
                    variant="outlined"
                    endIcon={goMaxM.isPending ? <KeySpinner /> : <LastPageIcon />}
                    onClick={() => goMaxM.mutate()}
                    disabled={!connected || busy || !hasLimits}
                    sx={[STEP_KEY_SX, hazardRingSx('move')]}
                  >
                    Go max
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Section>
        </TwoCol>
      </PageBody>
    </Box>
  )
}
