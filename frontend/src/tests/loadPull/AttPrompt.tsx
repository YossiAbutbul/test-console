import { useCallback, useRef, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack,
  Typography,
} from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { MONO, TEXT } from '../../ui'

interface Pending {
  db: number
  cycle: number
  cycles: number
  resolve: (proceed: boolean) => void
}

/**
 * Ask the operator to set the attenuator, and wait.
 *
 * The attenuator on the trombone's second output is manual, so a sweep over it
 * cannot be driven — the run has to stop at each step, say what to dial in, and
 * continue only once someone confirms. The value is taken on trust: nothing on
 * the bench can read back what was actually set.
 */
export function useAttPrompt() {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const ask = useCallback(
    (db: number, cycle: number, cycles: number) => new Promise<boolean>((resolve) => {
      const p = { db, cycle, cycles, resolve }
      pendingRef.current = p
      setPending(p)
    }),
    [],
  )

  const settle = (proceed: boolean) => {
    pendingRef.current?.resolve(proceed)
    pendingRef.current = null
    setPending(null)
  }

  /** Resolve anything still waiting — a Stop must not leave the run parked. */
  const cancel = useCallback(() => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
    setPending(null)
  }, [])

  const dialog = (
    <Dialog
      open={pending != null}
      // No backdrop or Escape dismissal: closing this by accident would let the
      // sweep carry on measuring at the previous attenuation.
      disableEscapeKeyDown
      onClose={(_e, reason) => { if (reason === 'backdropClick') return }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        <TuneIcon sx={{ fontSize: 20, color: 'warning.main' }} />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Set the attenuator</Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} alignItems="center" sx={{ py: 1 }}>
          <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
            Change the configurable attenuator to
          </Typography>
          <Box sx={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
            {pending?.db ?? 0} dB
          </Box>
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', textAlign: 'center' }}>
            cycle {(pending?.cycle ?? 0) + 1} of {pending?.cycles ?? 0}
            {' · '}the switch is on the VNA so you can watch it take effect
            <br />
            the trombone returns to the start and the run continues when you
            confirm
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => settle(false)} color="inherit">Stop run</Button>
        <Button onClick={() => settle(true)} variant="contained">Attenuator is set</Button>
      </DialogActions>
    </Dialog>
  )

  return { dialog, ask, cancel }
}
