import { Box, Stack, TextField, Typography, type TextFieldProps } from '@mui/material'
import { type FocusEvent } from 'react'

function selectOnFocus(e: FocusEvent<HTMLInputElement>) {
  // Only HTMLInputElement / HTMLTextAreaElement expose .select() — guard for
  // select-style fields (MUI renders a non-input element on focus).
  const t = e.target as HTMLElement & { select?: () => void }
  if (typeof t.select === 'function') t.select()
}

interface Props extends Omit<TextFieldProps, 'label' | 'variant'> {
  label: string
  hint?: string
  width?: number | string
}

export function LabeledField({ label, hint, width, sx, onFocus, ...rest }: Props) {
  const focusHandler = (e: FocusEvent<HTMLInputElement>) => {
    selectOnFocus(e)
    onFocus?.(e)
  }
  return (
    <Stack spacing={0.5} sx={{ width: width ?? '100%' }}>
      <Box>
        <Typography
          component="span"
          sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}
        >
          {label}
        </Typography>
        {hint && (
          <Typography
            component="span"
            sx={{ ml: 1, fontSize: 12, color: 'text.secondary' }}
          >
            {hint}
          </Typography>
        )}
      </Box>
      <TextField size="small" variant="outlined" sx={sx} onFocus={focusHandler} {...rest} />
    </Stack>
  )
}
