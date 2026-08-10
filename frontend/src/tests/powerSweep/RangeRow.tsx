import { Box, Slider, Stack, TextField, Typography } from '@mui/material'
import { MONO, TEXT } from '../../ui'

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

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number.isFinite(v) ? v : min))

/**
 * One sweep axis: a span within fixed bounds.
 *
 * Was a From field, a "→" glyph and a To field — three controls to say one
 * thing, and the arrow carried no information the labels did not. A track
 * shows the span *within the range the backend allows*, which is the part that
 * actually needs judging: 1–22 of 1–22 is a very different run from 14–15. The
 * numbers stay editable for the cases where you know the value you want.
 */
export function RangeRow({
  label, lo, hi, setLo, setHi, min, max, unit, disabled,
}: RangeRowProps) {
  const count = Math.max(0, Math.abs(hi - lo) + 1)

  const numberSx = {
    width: 62,
    '& .MuiInputBase-root': { height: 30 },
    '& input': {
      fontFamily: MONO,
      fontSize: 12.5,
      textAlign: 'center' as const,
      // The spinners eat half the box at this width and are unusable anyway.
      '&::-webkit-outer-spin-button, &::-webkit-inner-spin-button': {
        WebkitAppearance: 'none',
        margin: 0,
      },
      MozAppearance: 'textfield' as const,
    },
  }

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.25 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary', flexGrow: 1 }}>
          {label}
        </Typography>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>
          {min}–{max}{unit ? ` ${unit}` : ''}
        </Typography>
        <Typography sx={{ ...TEXT.micro, fontWeight: 600, color: 'text.secondary' }}>
          {count} step{count === 1 ? '' : 's'}
        </Typography>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1.25}>
        <TextField
          disabled={disabled}
          size="small"
          type="number"
          value={lo}
          inputProps={{ min, max, 'aria-label': `${label} from` }}
          onChange={(e) => setLo(clamp(Number(e.target.value), min, max))}
          sx={numberSx}
        />
        <Slider
          disabled={disabled}
          size="small"
          value={[lo, hi]}
          min={min}
          max={max}
          step={1}
          // Without this a drag past the far handle silently inverts the range.
          disableSwap
          onChange={(_, v) => {
            const [a, b] = v as number[]
            setLo(a)
            setHi(b)
          }}
          aria-label={label}
          sx={{
            flexGrow: 1,
            mx: 0.75,
            py: 1,
            color: 'text.primary',
            // Default MUI proportions — a 4px bar under 20px filled discs —
            // read as a consumer volume control. A hairline track with hollow,
            // ring-shaped handles matches the instrument panels around it.
            '& .MuiSlider-rail': {
              height: 2,
              opacity: 1,
              backgroundColor: 'divider',
            },
            '& .MuiSlider-track': {
              height: 2,
              border: 'none',
            },
            '& .MuiSlider-thumb': {
              width: 11,
              height: 11,
              backgroundColor: 'background.paper',
              border: '2px solid currentColor',
              // The default lifts a shadow under the handle; flat keeps it
              // sitting on the track rather than floating over it.
              '&::before': { boxShadow: 'none' },
              '&:hover, &.Mui-focusVisible': {
                boxShadow: '0 0 0 5px rgba(128,128,128,0.16)',
              },
              '&.Mui-active': {
                boxShadow: '0 0 0 7px rgba(128,128,128,0.2)',
              },
            },
          }}
        />
        <TextField
          disabled={disabled}
          size="small"
          type="number"
          value={hi}
          inputProps={{ min, max, 'aria-label': `${label} to` }}
          onChange={(e) => setHi(clamp(Number(e.target.value), min, max))}
          sx={numberSx}
        />
      </Stack>
    </Box>
  )
}
