import { Box, Stack, Typography } from '@mui/material'
import { LabeledField } from '../../components/LabeledField'
import { TEXT } from '../../ui'

interface RangeRowProps {
  label: string
  lo: number
  hi: number
  setLo: (n: number) => void
  setHi: (n: number) => void
  /** Inclusive bounds enforced by the backend. */
  min: number
  max: number
  unit?: string
  historyKey?: string
}

const clamp = (v: string, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number(v) || min))

/** From/To pair for one sweep axis, with a live step count. */
export function RangeRow({
  label, lo, hi, setLo, setHi, min, max, unit, historyKey,
}: RangeRowProps) {
  const count = Math.max(0, Math.abs(hi - lo) + 1)
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
          {label}
        </Typography>
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
          {min}–{max}{unit ? ` ${unit}` : ''} · {count} step{count === 1 ? '' : 's'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="flex-end">
        <LabeledField
          label="From"
          type="number"
          value={lo}
          historyKey={historyKey ? `${historyKey}.from` : undefined}
          inputProps={{ min, max }}
          onChange={(e) => setLo(clamp(e.target.value, min, max))}
          width={120}
        />
        <Box sx={{ color: 'text.disabled', fontSize: 16, height: 40, display: 'flex', alignItems: 'center' }}>
          →
        </Box>
        <LabeledField
          label="To"
          type="number"
          value={hi}
          historyKey={historyKey ? `${historyKey}.to` : undefined}
          inputProps={{ min, max }}
          onChange={(e) => setHi(clamp(e.target.value, min, max))}
          width={120}
        />
      </Stack>
    </Box>
  )
}
