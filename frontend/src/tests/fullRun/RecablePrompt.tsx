/**
 * The pause before a step whose bench setup differs from the last one's.
 *
 * A modal task, so it dims the page: nothing else should be done on the bench
 * until the cable has moved. It stops below the toolbar (`keepToolbar`), so
 * the header's Stop and E-STOP stay in reach while it is up.
 */
import { Box, Button, Stack, Typography } from '@mui/material'
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded'
import CableIcon from '@mui/icons-material/CableRounded'
import { ModalShell, TEXT } from '../../ui'
import type { SetupText } from '../../store/fullRunStore'

interface Props {
  open: boolean
  /** "Step 4 · BLE CW". */
  stepLabel: string
  from: SetupText | null
  to: SetupText
  onContinue: () => void
  onStop: () => void
}

export function RecablePrompt({ open, stepLabel, from, to, onContinue, onStop }: Props) {
  return (
    <ModalShell
      open={open}
      title="Re-cable the bench"
      subtitle={`Before ${stepLabel}`}
      maxWidth="xs"
      keepToolbar
      footer={{
        secondary: <Button onClick={onStop}>Stop run</Button>,
        primary: <Button variant="contained" onClick={onContinue} autoFocus>Cabled — continue</Button>,
      }}
    >
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <CableIcon sx={{ color: 'warning.main' }} />
          <Typography sx={{ ...TEXT.section, color: from ? 'text.secondary' : 'text.disabled' }}>
            {from?.name ?? 'Unknown'}
          </Typography>
          <ArrowIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          <Typography sx={TEXT.section}>{to.name}</Typography>
        </Stack>
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'action.hover' }}>
          <Typography sx={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {to.instructions}
          </Typography>
        </Box>
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
          The run waits here. Nothing transmits until you continue.
        </Typography>
      </Stack>
    </ModalShell>
  )
}
