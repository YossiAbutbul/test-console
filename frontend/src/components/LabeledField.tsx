import { Autocomplete, Box, Stack, TextField, Typography, type TextFieldProps } from '@mui/material'
import type { ChangeEvent, FocusEvent } from 'react'
import { useFieldHistory } from '../hooks/useFieldHistory'

interface Props extends Omit<TextFieldProps, 'label' | 'variant'> {
  label: string
  hint?: string
  width?: number | string
  /** Persist last 5 values under this key; show as autocomplete dropdown on focus. */
  historyKey?: string
}

export function LabeledField({ label, hint, width, sx, historyKey, ...rest }: Props) {
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
      {historyKey ? (
        <HistoryInput sx={sx} historyKey={historyKey} {...rest} />
      ) : (
        <TextField size="small" variant="outlined" sx={sx} {...rest} />
      )}
    </Stack>
  )
}

interface HistoryInputProps extends Omit<TextFieldProps, 'label' | 'variant'> {
  historyKey: string
}

function HistoryInput({ historyKey, value, onChange, onBlur, sx, type, inputProps, ...rest }: HistoryInputProps) {
  const { history, push } = useFieldHistory(historyKey)

  const fireOnChange = (val: string) => {
    if (!onChange) return
    const evt = { target: { value: val } } as unknown as ChangeEvent<HTMLInputElement>
    onChange(evt)
  }

  return (
    <Autocomplete
      freeSolo
      openOnFocus
      disableClearable
      options={history}
      value={(value as string | number | undefined) ?? ''}
      inputValue={value == null ? '' : String(value)}
      onInputChange={(_, v) => fireOnChange(v)}
      onChange={(_, v) => fireOnChange(typeof v === 'string' ? v : '')}
      size="small"
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          {...rest}
          type={type}
          variant="outlined"
          size="small"
          onBlur={(e: FocusEvent<HTMLInputElement>) => {
            push(e.target.value)
            onBlur?.(e)
          }}
          inputProps={{ ...params.inputProps, ...inputProps }}
        />
      )}
    />
  )
}
