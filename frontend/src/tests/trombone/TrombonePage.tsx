import { useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { DASH } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, Card, ConnectButton, MONO, MonoText, PageBody, Readout,
  Section, StatusChip, TEXT,
} from '../../ui'
import { useActionReporter } from '../engine/useRunReporter'
import type { TestPageProps } from '../types'

/** Faster than the servo page: the position readout is the only feedback
 *  during a move, so it has to track the motor. */
const POLL_MS = 500

export function TrombonePage({ protocol, group }: TestPageProps) {
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
    refetchInterval: (q) => (q.state.data?.connected ? POLL_MS : false),
    refetchOnWindowFocus: false,
  })

  const s = statusQ.data
  const connected = !!s?.connected
  const moving = !!s?.moving
  const pos = s?.position ?? null
  // Soft limits are user-defined at runtime now; this manual debug page falls
  // back to a wide range when none are set so jogging still works.
  const softMin = s?.soft_min ?? -1_000_000
  const softMax = s?.soft_max ?? 1_000_000

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Trombone"
        actions={
          <ConnectButton
            connected={connected}
            pending={connectM.isPending || disconnectM.isPending}
            disabled={busy}
            onConnect={() => connectM.mutate()}
            onDisconnect={() => disconnectM.mutate()}
          />
        }
      />

      <PageBody width="panel">
        <Section title="Motor status" action={<MonoText>MT986A · Arcus DMX-J-SA</MonoText>}>
          <Card>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1 }}>
                <Readout
                  label="Position"
                  value={pos == null ? DASH : pos.toLocaleString()}
                  unit="pulses"
                />
              </Box>
              {!connected && (
                <TextField
                  size="small"
                  type="number"
                  label="Index"
                  value={deviceIndex}
                  onChange={(e) => setDeviceIndex(Math.max(0, Number(e.target.value) || 0))}
                  inputProps={{ min: 0, max: 15 }}
                  sx={{ width: 84 }}
                />
              )}
              <StatusChip
                label={statusText}
                tone={connected ? (moving ? 'busy' : 'ok') : 'off'}
                spinning={connected && moving}
              />
            </Stack>

            <Box sx={{ mt: 1.5 }}>
              <Box
                sx={{
                  position: 'relative',
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'action.hover',
                  overflow: 'hidden',
                }}
              >
                {pos != null && softMax > softMin && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 0,
                      width: `${Math.max(0, Math.min(100, ((pos - softMin) / (softMax - softMin)) * 100))}%`,
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
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                  range {(softMax - softMin).toLocaleString()} pulses
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: MONO }}>
                  {softMax.toLocaleString()}
                </Typography>
              </Stack>
            </Box>
          </Card>
        </Section>

        <Section title="Absolute move">
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <LabeledField
              label="Target"
              hint={`${softMin.toLocaleString()} … ${softMax.toLocaleString()}`}
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
              sx={{ maxWidth: 280 }}
            />
            <Button
              variant="contained"
              onClick={() => moveM.mutate()}
              disabled={!connected || busy || !targetInRange}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.lg, mt: '22px' }}
            >
              Move to
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="outlined"
              onClick={() => stopM.mutate()}
              disabled={!connected || stopM.isPending}
              sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.lg, mt: '22px' }}
            >
              {stopM.isPending ? 'Stopping…' : 'Stop'}
            </Button>
          </Stack>
        </Section>

        <Section title="Movement">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => jogNegM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Step Down
            </Button>
            <Button
              variant="outlined"
              endIcon={<ArrowForwardIcon />}
              onClick={() => jogPosM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Step Up
            </Button>
            <Box sx={{ width: 16 }} />
            <Button
              variant="outlined"
              startIcon={<FirstPageIcon />}
              onClick={() => goMinM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Go Min
            </Button>
            <Button
              variant="outlined"
              endIcon={<LastPageIcon />}
              onClick={() => goMaxM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Go Max
            </Button>
          </Stack>
        </Section>

        {s?.error && (
          <Typography sx={{ ...TEXT.hint, color: 'error.main' }}>{s.error}</Typography>
        )}
      </PageBody>
    </Box>
  )
}
