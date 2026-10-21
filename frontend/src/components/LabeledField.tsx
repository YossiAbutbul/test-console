import { Box, Stack, TextField, Typography, type TextFieldProps } from '@mui/material'
import { type FocusEvent, type ReactNode } from 'react'
import { selectOnFocus } from '../lib/selectOnFocus'


interface Props extends Omit<TextFieldProps, 'label' | 'variant'> {
  label: string
  hint?: string
  width?: number | string
  /**
   * A control beside the input, centred on it — an Auto button, say. Sits on
   * the input's row rather than the label's, so the label stays over the field.
   */
  action?: ReactNode
}

export function LabeledField({ label, hint, width, action, sx, onFocus, ...rest }: Props) {
  const focusHandler = (e: FocusEvent<HTMLInputElement>) => {
    selectOnFocus(e)
    onFocus?.(e)
  }
  return (
    <Stack spacing={0.5} sx={{ width: width ?? '100%' }}>
      {/* One line, always: a long hint ("EARFCN 18900 · Band 2") wrapped
          under its label and pushed that field's input below its row's.
          The hint gives way with an ellipsis; the label never does. Its
          full text is the line's tooltip. */}
      <Box
        title={hint ? `${label} · ${hint}` : undefined}
        sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
      >
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
      {action ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField size="small" variant="outlined" sx={{ flexGrow: 1, minWidth: 0, ...sx }} onFocus={focusHandler} {...rest} />
          {action}
        </Stack>
      ) : (
        <TextField size="small" variant="outlined" sx={sx} onFocus={focusHandler} {...rest} />
      )}
    </Stack>
  )
}
