import { useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import PowerIcon from '@mui/icons-material/Power'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import type { TestPageProps } from '../types'

const POLL_MS = 500

export function TrombonePage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const [targetStr, setTargetStr] = useState<string>('0')
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

  const connectM = useMutation({ mutationFn: () => motor.connect(deviceIndex), onSuccess: onOk('connect'), onError: onErr('connect') })
  const disconnectM = useMutation({ mutationFn: motor.disconnect, onSuccess: onOk('disconnect'), onError: onErr('disconnect') })
  const moveM = useMutation({
    mutationFn: () => motor.move(targetNum, true),
    onSuccess: onOk('move'),
    onError: onErr('move'),
  })

  const targetInRange = targetValid && targetNum >= softMin && targetNum <= softMax
  const targetOutOfRange = targetValid && !targetInRange
  const jogPosM = useMutation({ mutationFn: () => motor.move(clampInc(3200), false), onSuccess: onOk('move +'), onError: onErr('move +') })
  const jogNegM = useMutation({ mutationFn: () => motor.move(clampInc(-3200), false), onSuccess: onOk('move -'), onError: onErr('move -') })
  const goMinM = useMutation({ mutationFn: () => motor.move(softMin, true), onSuccess: onOk('go min'), onError: onErr('go min') })
  const goMaxM = useMutation({ mutationFn: () => motor.move(softMax, true), onSuccess: onOk('go max'), onError: onErr('go max') })
  const stopM = useMutation({ mutationFn: motor.stop, onSuccess: onOk('stop'), onError: onErr('stop') })

  const busy =
    connectM.isPending || disconnectM.isPending || moveM.isPending ||
    jogPosM.isPending || jogNegM.isPending || goMinM.isPending ||
    goMaxM.isPending || stopM.isPending

  const statusColor = connected ? (moving ? 'warning.main' : 'success.main') : 'text.disabled'
  const statusText = !connected ? 'Disconnected' : moving ? 'Moving' : 'Idle'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Trombone"
        actions={
          <Button
            variant={connected ? 'outlined' : 'contained'}
            startIcon={<PowerIcon sx={{ fontSize: 16 }} />}
            onClick={() => (connected ? disconnectM.mutate() : connectM.mutate())}
            disabled={busy}
            sx={{ height: 36, minWidth: 120 }}
          >
            {connectM.isPending || disconnectM.isPending ? '…' : connected ? 'Disconnect' : 'Connect'}
          </Button>
        }
      />

      <Stack spacing={2} sx={{ mt: 1, maxWidth: 720 }}>
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Motor status
            <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
              MT986A · Arcus DMX-J-SA
            </Typography>
          </Typography>

          <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
                  Position
                </Typography>
                <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 22, fontWeight: 600 }}>
                  {pos == null ? '—' : pos.toLocaleString()}
                  <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.75 }}>pulses</Typography>
                </Typography>
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
              <Chip
                size="small"
                icon={
                  moving
                    ? <CircularProgress size={10} sx={{ color: 'warning.main !important', ml: 0.75 }} />
                    : <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor, ml: 0.75 }} />
                }
                label={statusText}
                sx={{ fontSize: 11.5, fontWeight: 600, color: statusColor }}
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
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
                  {softMin.toLocaleString()}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
                  range {(softMax - softMin).toLocaleString()} pulses
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
                  {softMax.toLocaleString()}
                </Typography>
              </Stack>
            </Box>
          </Box>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Absolute move
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <LabeledField
              label="Target"
              hint={`${softMin.toLocaleString()} … ${softMax.toLocaleString()}`}
              type="number"
              value={targetStr}
              inputProps={{ min: softMin, max: softMax, step: 100 }}
              onChange={(e) => setTargetStr(e.target.value)}
              error={targetOutOfRange || (!targetValid && targetStr.trim() !== '')}
              helperText={
                targetOutOfRange
                  ? `Out of range — must be ${softMin.toLocaleString()} … ${softMax.toLocaleString()}`
                  : (!targetValid && targetStr.trim() !== '') ? 'Invalid number' : ' '
              }
              sx={{ maxWidth: 280 }}
            />
            <Button
              variant="contained"
              onClick={() => moveM.mutate()}
              disabled={!connected || busy || !targetInRange}
              sx={{ minWidth: 110, height: 40, mt: '22px' }}
            >
              Move to
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="outlined"
              onClick={() => stopM.mutate()}
              disabled={!connected || stopM.isPending}
              sx={{ minWidth: 96, height: 40, mt: '22px' }}
            >
              {stopM.isPending ? 'Stopping…' : 'Stop'}
            </Button>
          </Stack>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Movement
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => jogNegM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Step Down
            </Button>
            <Button
              variant="outlined"
              endIcon={<ArrowForwardIcon />}
              onClick={() => jogPosM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Step Up
            </Button>
            <Box sx={{ width: 16 }} />
            <Button
              variant="outlined"
              startIcon={<FirstPageIcon />}
              onClick={() => goMinM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Go Min
            </Button>
            <Button
              variant="outlined"
              endIcon={<LastPageIcon />}
              onClick={() => goMaxM.mutate()}
              disabled={!connected || busy}
              sx={{ minWidth: 120, height: 36 }}
            >
              Go Max
            </Button>
          </Stack>
        </Box>

        {s?.error && (
          <Typography sx={{ fontSize: 12, color: 'error.main' }}>{s.error}</Typography>
        )}
      </Stack>
    </Box>
  )
}
