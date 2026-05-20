import { Box, Stack, TextField, Typography, type TextFieldProps } from '@mui/material'

interface Props extends Omit<TextFieldProps, 'label' | 'variant'> {
  label: string
  hint?: string
  width?: number | string
}

export function LabeledField({ label, hint, width, sx, ...rest }: Props) {
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
      <TextField size="small" variant="outlined" sx={sx} {...rest} />
    </Stack>
  )
}
