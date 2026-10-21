import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material'
import type { InstrumentId } from '../context/InstrumentsContext'
import type { ConnectFailure } from '../lib/instrumentError'
import {
  CheckMark, HazardGlyph, ModalShell, TEXT, hazardRingSx, type CheckState,
} from '../ui'
import { FailureNote } from './FailureNote'

export type PreflightStepState = 'pending' | 'connecting' | 'ok' | 'failed'

export interface PreflightStep {
  id: InstrumentId
  label: string
  state: PreflightStepState
  /** Set when `state === 'failed'`. */
  failure?: ConnectFailure
}

/**
 * What the operator is about to do, so the dialog can say what proceeding
 * without an instrument actually costs. A sweep loses a column across every
 * point; a single command loses one reading.
 */
export type PreflightVerb = 'run' | 'send'

interface PreflightDialogProps {
  open: boolean
  steps: PreflightStep[]
  /** True while connect attempts are still running. */
  busy: boolean
  /** 0..1 through the current instrument's timeout. */
  elapsed: number
  timeoutMs: number
  verb?: PreflightVerb
  onRunAnyway: () => void
  onCancel: () => void
  onOpenInstruments: () => void
}

const COPY: Record<PreflightVerb, { busy: string; cost: string; proceed: string }> = {
  run: {
    busy: 'Preparing the instruments this test needs.',
    cost: 'Running now leaves their readings blank for every point.',
    proceed: 'Run anyway',
  },
  send: {
    busy: 'Preparing the instruments needed to measure this command.',
    cost: 'Sending now leaves their readings blank for this measurement.',
    proceed: 'Send anyway',
  },
}

/** The kit mark, so a step here reads the same as the row it becomes in
 *  Instruments and on the bench course. */
const MARK: Record<PreflightStepState, CheckState> = {
  pending: 'todo',
  connecting: 'busy',
  ok: 'ok',
  failed: 'error',
}

/**
 * Pre-run instrument check.
 *
 * While connecting it is a progress view; once every attempt has settled and
 * something is still missing it becomes a decision — run with blank readings
 * for those instruments, or stop and fix the rig.
 */
export function PreflightDialog({
  open, steps, busy, elapsed, timeoutMs, verb = 'run',
  onRunAnyway, onCancel, onOpenInstruments,
}: PreflightDialogProps) {
  const missing = steps.filter((s) => s.state !== 'ok')
  const allOk = steps.length > 0 && missing.length === 0
  const copy = COPY[verb]
  // The keys only mean something once every attempt has settled with
  // something missing -- the moments the footer used to be empty.
  const keysOff = busy || allOk

  return (
    <ModalShell
      open={open}
      // Not dismissable mid-connect: the run is waiting on this answer.
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      title={busy
        ? 'Connecting instruments'
        : allOk ? 'Instruments ready' : 'Instruments not connected'}
      // Always drawn, disabled until there is a decision to make. An empty
      // footer that sprouted three keys when the last attempt settled grew
      // the dialog under the pointer just as it asked for an answer.
      footer={{
        leading: (
          <Button onClick={onOpenInstruments} disabled={keysOff}>
            Open instruments
          </Button>
        ),
        secondary: (
          <Button variant="outlined" color="inherit" onClick={onCancel} disabled={keysOff}>
            Cancel
          </Button>
        ),
        primary: (
          // Proceeding starts a run that transmits, so it carries the same
          // hazard mark as the page's own Send/Run key.
          <Button
            variant="contained"
            color="warning"
            onClick={onRunAnyway}
            disabled={keysOff}
            startIcon={<HazardGlyph kind="tx" />}
            sx={hazardRingSx('tx')}
          >
            {copy.proceed}
          </Button>
        ),
      }}
    >
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mb: 2 }}>
        {busy
          ? copy.busy
          : allOk
            ? 'All required instruments responded.'
            : `${missing.length} instrument${missing.length === 1 ? '' : 's'} did not connect. `
              + copy.cost}
      </Typography>

      <Stack spacing={1.25}>
        {steps.map((s) => (
          <Box key={s.id}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckMark size={20} state={MARK[s.state]} />
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
                sx={{ mt: 0.75, ml: 3.5, height: 3, borderRadius: 2 }}
              />
            )}
            {s.failure && <FailureNote failure={s.failure} indent={3.5} />}
          </Box>
        ))}
      </Stack>
    </ModalShell>
  )
}
