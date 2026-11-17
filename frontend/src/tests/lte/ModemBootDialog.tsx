import { Box, CircularProgress, Dialog, DialogContent, Stack, Typography } from '@mui/material'
import { TOP_BAR_H } from '../../ui'

/**
 * "Turning on modem" while the LTE modem boots (~10 s), during which nothing
 * else on the page can usefully happen.
 *
 * One component for every LTE page that boots it -- the CW and Modulated
 * Send (useLteModem) and the LTE Load Pull run's modem cycle -- so the wait
 * reads the same wherever it is.
 *
 * `keepToolbar`: stop below the top bar, scrim included, so Stop and E-STOP
 * stay in reach -- for a boot that is the first step of a run.
 */
export function ModemBootDialog({ open, keepToolbar }: { open: boolean; keepToolbar?: boolean }) {
  return (
    <Dialog
      open={open}
      maxWidth="xs"
      sx={keepToolbar ? { top: TOP_BAR_H } : undefined}
      disableEnforceFocus={keepToolbar}
      slotProps={keepToolbar ? { backdrop: { sx: { top: TOP_BAR_H } } } : undefined}
    >
      <DialogContent>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={22} />
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              Turning on modem
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              A radio boot takes a few seconds.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
