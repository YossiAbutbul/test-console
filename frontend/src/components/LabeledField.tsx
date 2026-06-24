import { Autocomplete, Box, Stack, TextField, Typography, type TextFieldProps } from '@mui/material'
import { useState, type ChangeEvent, type FocusEvent } from 'react'
import { useFieldHistory } from '../hooks/useFieldHistory'

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
  /** Persist last 5 values under this key; show as autocomplete dropdown on focus. */
  historyKey?: string
  /** Only valid raw values are kept in (and shown from) history. */
  validate?: (raw: string) => boolean
}

export function LabeledField({ label, hint, width, sx, historyKey, validate, onFocus, ...rest }: Props) {
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
      {historyKey ? (
        <HistoryInput sx={sx} historyKey={historyKey} validate={validate} onFocus={focusHandler} {...rest} />
      ) : (
        <TextField size="small" variant="outlined" sx={sx} onFocus={focusHandler} {...rest} />
      )}
    </Stack>
  )
}

interface HistoryInputProps extends Omit<TextFieldProps, 'label' | 'variant'> {
  historyKey: string
  validate?: (raw: string) => boolean
}

function HistoryInput({ historyKey, value, onChange, onBlur, sx, type, inputProps, InputProps, validate, ...rest }: HistoryInputProps) {
  const { history, push } = useFieldHistory(historyKey)
  const [open, setOpen] = useState(false)
  // Hide any previously-stored invalid values from the dropdown.
  const options = validate ? history.filter(validate) : history

  const fireOnChange = (val: string) => {
    if (!onChange) return
    const evt = { target: { value: val } } as unknown as ChangeEvent<HTMLInputElement>
    onChange(evt)
  }

  const strValue = value == null ? '' : String(value)
  return (
    <Autocomplete
      freeSolo
      openOnFocus
      disableClearable
      // Only pop the dropdown when there's actually history to show.
      open={open && options.length > 0}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      getOptionLabel={(opt) => (typeof opt === 'string' ? opt : String(opt))}
      value={strValue}
      inputValue={strValue}
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
            // Don't remember invalid values.
            if (!validate || validate(e.target.value)) push(e.target.value)
            onBlur?.(e)
          }}
          inputProps={{ ...params.inputProps, ...inputProps }}
          // Merge caller adornments with the Autocomplete's own (keeps its ref).
          InputProps={{
            ...params.InputProps,
            ...InputProps,
            endAdornment: (
              <>
                {InputProps?.endAdornment}
                {params.InputProps?.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  )
}
