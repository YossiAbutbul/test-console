import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { MONO, TEXT } from '../../ui'

/** One row of the ranges list, fixed so the page can size the card from it
 *  (three rows): the card is then the same height in simple and advanced
 *  mode and the results under it do not move. */
export const RANGE_ROW_HEIGHT = 48

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
  /** Locked while a sweep runs — the plan is fixed once it starts. */
  disabled?: boolean
}

/**
 * One sweep axis as a settings row: its name, From and To as pop-up menus of
 * every allowed value, and the points it adds.
 *
 * History, so it is not repeated: a From field, a "→" and a To field; a range
 * slider with a number box at each end; a pair of steppers; a strip of every
 * value with a draggable span. The operator chose pop-up menus: nothing to
 * type or drag, every allowed value listed, and the same control as every
 * other choice in the app.
 */
export function RangeRow({
  label, lo, hi, setLo, setHi, min, max, unit, disabled,
}: RangeRowProps) {
  const count = Math.max(0, Math.abs(hi - lo) + 1)
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const pick = (value: number, set: (n: number) => void, which: string) => (
    <TextField
      select
      size="small"
      value={value}
      disabled={disabled}
      onChange={(e) => set(Number(e.target.value))}
      inputProps={{ 'aria-label': `${label} ${which}` }}
      // A long list (22 powers) scrolls inside a sheet of about eight rows
      // rather than running off the window.
      SelectProps={{ MenuProps: { slotProps: { paper: { sx: { maxHeight: 8 * 30 + 8 } } } } }}
      sx={{ width: 76, flexShrink: 0, '& .MuiSelect-select': { fontFamily: MONO, fontSize: 13 } }}
    >
      {values.map((v) => (
        <MenuItem key={v} value={v} sx={{ fontFamily: MONO }}>{v}</MenuItem>
      ))}
    </TextField>
  )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: RANGE_ROW_HEIGHT, px: 1.5 }}>
      {/* The unit sits with the name it qualifies. */}
      <Typography noWrap sx={{ ...TEXT.label, fontWeight: 600, color: 'text.primary', flexGrow: 1, minWidth: 0 }}>
        {label}
        {unit && (
          <Box component="span" sx={{ ml: 0.5, fontWeight: 400, color: 'text.secondary' }}>
            [{unit}]
          </Box>
        )}
      </Typography>
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>From</Typography>
      {pick(lo, setLo, 'from')}
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary', ml: 0.5 }}>To</Typography>
      {pick(hi, setHi, 'to')}
      {/* A fixed column, so "4 steps" and "22 steps" end on one line. */}
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary', width: 56, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {count} step{count === 1 ? '' : 's'}
      </Typography>
    </Box>
  )
}
