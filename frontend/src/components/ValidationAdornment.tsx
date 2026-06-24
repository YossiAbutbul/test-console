import { Box, InputAdornment } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/**
 * End-adornment for a text/number field that shows an instant validation
 * message when `show` is true. The message bubble is rendered locally (NOT a
 * portaled MUI Tooltip) so it stays inside the field's DOM subtree — that way
 * it disappears when the field's page is hidden (all test pages stay mounted
 * via display:none) instead of orphaning to the top-left of the screen.
 *
 * Drop into a field via `InputProps={{ endAdornment: <ValidationAdornment … /> }}`.
 */
/**
 * When to surface the validation message:
 *  - valid              → never
 *  - invalid, non-empty → always (even while focused)
 *  - invalid, empty     → only when NOT focused (don't nag mid-typing/deleting)
 */
export const shouldShowValidation = (raw: string, valid: boolean, focused: boolean): boolean =>
  !valid && (raw.trim() !== '' || !focused)

export function ValidationAdornment({ show, message }: { show: boolean; message: string }) {
  if (!show) return null
  return (
    <InputAdornment position="end" sx={{ position: 'relative', overflow: 'visible' }}>
      <InfoOutlinedIcon sx={{ fontSize: 17, color: 'error.main' }} />
      <Box
        role="alert"
        sx={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          right: -4,
          px: 1, py: 0.5,
          borderRadius: 1,
          bgcolor: 'grey.900',
          color: '#fff',
          fontSize: 11.5,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: 3,
          zIndex: 5,
          pointerEvents: 'none',
          // little downward arrow
          '&::after': {
            content: '""',
            position: 'absolute',
            top: '100%',
            right: 8,
            border: '5px solid transparent',
            borderTopColor: 'grey.900',
          },
        }}
      >
        {message}
      </Box>
    </InputAdornment>
  )
}
