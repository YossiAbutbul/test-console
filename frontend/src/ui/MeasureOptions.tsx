import { Checkbox, FormControlLabel, Stack, Tooltip, Typography } from '@mui/material'
import { measuresAnything, type MeasureSelection } from './measure'

/**
 * The pair of checkboxes that chooses what a Send reads back.
 *
 * Lives in the kit rather than on one page because the LoRa and LTE CW pages
 * both offer it and it must read identically on each. The types and the
 * preflight helper it drives are in `measure.ts`.
 */
export function MeasureOptions({ value, onChange, disabled }: {
  value: MeasureSelection
  onChange: (next: MeasureSelection) => void
  disabled?: boolean
}) {
  const box = (key: keyof MeasureSelection, label: string, hint: string) => (
    <Tooltip title={hint} placement="top">
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            sx={{ py: 0.25 }}
          />
        }
        label={<Typography sx={{ fontSize: 13 }}>{label}</Typography>}
        sx={{ mr: 0, ml: -0.75 }}
      />
    </Tooltip>
  )

  return (
    <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
      {box('power', 'Measure power', 'Read TX power from the power sensor after sending')}
      {box('current', 'Measure CC', 'Read current consumption from the DC analyzer after sending')}
      {/* Said out loud, because the absence of the measurement strip below is
          easy to read as something being broken rather than switched off. */}
      {!measuresAnything(value) && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          Send transmits only — no instruments are connected or read.
        </Typography>
      )}
    </Stack>
  )
}
