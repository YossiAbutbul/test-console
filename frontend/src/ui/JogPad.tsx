import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardRounded'
import { CONTROL_H } from './tokens'
import { focusRingOf } from './feel'

interface JogPadProps {
  /** -1 jogging toward zero, 1 toward the end, 0 still. */
  dir: number
  focused: boolean
  disabled: boolean
  onStart: (positive: boolean) => void
  onStop: () => void
  onKeyDown: (e: ReactKeyboardEvent) => void
  onKeyUp: (e: ReactKeyboardEvent) => void
  onFocusChange: (focused: boolean) => void
  /** Defaults to the column it sits in. */
  width?: number | string
}

/**
 * Press-and-hold jog for the trombone: the two arrows run the motor while the
 * mouse is held on them, and the pad itself takes focus so the ← / → keys do
 * the same. Shared by the Load Pull and Trombone pages so both jog alike.
 * Blur stops the motor, as releasing does.
 */
export function JogPad({
  dir, focused, disabled, onStart, onStop, onKeyDown, onKeyUp, onFocusChange, width = '100%',
}: JogPadProps) {
  return (
    <Box
      role="group"
      aria-label="Jog trombone — hold the arrow keys"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={() => onFocusChange(true)}
      onBlur={() => { onFocusChange(false); onStop() }}
      sx={{
        width, height: CONTROL_H.md, px: 0.5,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderRadius: 1,
        outline: 'none',
        // Filled like the keys beside it.
        bgcolor: (t) => alpha(t.palette.text.secondary, focused ? 0.2 : 0.14),
        opacity: disabled ? 0.5 : 1,
        // Focus is the theme's line, a shadow, so it never resizes the pad.
        boxShadow: (t) => (focused ? focusRingOf(t) : 'none'),
        userSelect: 'none',
        transition: 'box-shadow 0.15s, background-color 0.15s',
      }}
    >
      {/* Out of the tab order: the pad itself takes focus and the arrow keys,
          so tabbing onto each arrow would only be two more stops that do
          nothing on Enter. */}
      <IconButton
        size="small"
        tabIndex={-1}
        aria-label="Jog toward zero"
        disabled={disabled}
        onMouseDown={() => onStart(false)}
        onMouseUp={onStop}
        onMouseLeave={onStop}
        sx={{ color: dir < 0 ? 'primary.main' : 'text.secondary' }}
      >
        <ArrowBackIcon sx={{ fontSize: 17 }} />
      </IconButton>
      <Typography
        sx={{
          fontSize: 12.5, fontWeight: 500,
          color: dir !== 0 ? 'warning.main' : (focused ? 'primary.main' : 'text.secondary'),
          whiteSpace: 'nowrap',
        }}
      >
        {dir !== 0 ? 'Jogging' : focused ? 'Hold arrows' : 'Hold to jog'}
      </Typography>
      <IconButton
        size="small"
        tabIndex={-1}
        aria-label="Jog toward end"
        disabled={disabled}
        onMouseDown={() => onStart(true)}
        onMouseUp={onStop}
        onMouseLeave={onStop}
        sx={{ color: dir > 0 ? 'primary.main' : 'text.secondary' }}
      >
        <ArrowForwardIcon sx={{ fontSize: 17 }} />
      </IconButton>
    </Box>
  )
}
