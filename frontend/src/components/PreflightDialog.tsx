import {
  Box, Button, Dialog, DialogActions, DialogContent, LinearProgress, Stack,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import type { InstrumentId } from '../context/InstrumentsContext'
import type { ConnectFailure } from '../lib/instrumentError'
import { TEXT } from '../ui'
import { FailureNote } from './FailureNote'

export type PreflightStepState = 'pending' | 'connecting' | 'ok' | 'failed'

export interface PreflightStep {
  id: InstrumentId
  label: string
  state: PreflightStepState
  /** Set when `state === 'failed'`. */
  failure?: ConnectFailure
}

interface PreflightDialogProps {
  open: boolean
  steps: PreflightStep[]
  /** True while connect attempts are still running. */
  busy: boolean
  /** 0..1 through the current instrument's timeout. */
  elapsed: number
  timeoutMs: number
  onRunAnyway: () => void
  onCancel: () => void
  onOpenInstruments: () => void
}

const ICON = { fontSize: 18, flexShrink: 0 } as const

function StepIcon({ state }: { state: PreflightStepState }) {
  if (state === 'ok') return <CheckCircleRoundedIcon sx={{ ...ICON, color: 'success.main' }} />
  if (state === 'failed') return <ErrorRoundedIcon sx={{ ...ICON, color: 'error.main' }} />
  return (
    <RadioButtonUncheckedIcon
      sx={{ ...ICON, color: state === 'connecting' ? 'text.primary' : 'text.disabled' }}
    />
  )
}

/**
 * Pre-run instrument check.
 *
 * While connecting it is a progress view; once every attempt has settled and
 * something is still missing it becomes a decision — run with blank readings
 * for those instruments, or stop and fix the rig.
 */
export function PreflightDialog({
  open, steps, busy, elapsed, timeoutMs,
  onRunAnyway, onCancel, onOpenInstruments,
}: PreflightDialogProps) {
  const missing = steps.filter((s) => s.state !== 'ok')
  const allOk = steps.length > 0 && missing.length === 0

  return (
    <Dialog
      open={open}
      // Not dismissable mid-connect: the run is waiting on this answer.
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogContent sx={{ pt: 3, pb: 2 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          {busy
            ? 'Connecting instruments'
            : allOk ? 'Instruments ready' : 'Instruments not connected'}
        </Typography>
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mb: 2 }}>
          {busy
            ? 'Preparing the instruments this test needs.'
            : allOk
              ? 'All required instruments responded.'
              : `${missing.length} instrument${missing.length === 1 ? '' : 's'} did not connect. `
                + 'Running now leaves their readings blank for every point.'}
        </Typography>

        <Stack spacing={1.25}>
          {steps.map((s) => (
            <Box key={s.id}>
              <Stack direction="row" spacing={1} alignItems="center">
                <StepIcon state={s.state} />
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: s.state === 'connecting' ? 600 : 500,
                    color: 'text.primary',
                    flexGrow: 1,
                  }}
                >
                  {s.label}
                </Typography>
                {s.state === 'connecting' && (
                  <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                    {Math.ceil((1 - elapsed) * (timeoutMs / 1000))}s
                  </Typography>
                )}
                {s.failure && (
                  <Typography sx={{ ...TEXT.micro, fontWeight: 600, color: 'error.main' }}>
                    {s.failure.title}
                  </Typography>
                )}
              </Stack>
              {s.state === 'connecting' && (
                <LinearProgress
                  variant="determinate"
                  value={elapsed * 100}
                  sx={{ mt: 0.75, ml: 3.25, height: 3, borderRadius: 2 }}
                />
              )}
              {s.failure && <FailureNote failure={s.failure} indent={3.25} />}
            </Box>
          ))}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
        {!busy && !allOk && (
          <>
            <Button onClick={onOpenInstruments} sx={{ mr: 'auto' }}>
              Open Instruments
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="contained" color="warning" onClick={onRunAnyway}>
              Run anyway
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
