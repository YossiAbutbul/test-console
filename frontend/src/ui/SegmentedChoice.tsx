import { Box, ButtonBase } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette, useThemeMode } from '../context/ThemeModeContext'
import { PRESS_SX } from './feel'
import { CONTROL_H, MONO } from './tokens'

export interface ChoiceOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: ChoiceOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
  /** Set the labels in the UI face rather than mono. Mono is for unit
   *  pickers (EARFCN / MHz), where the label is itself a unit. */
  text?: boolean
  /** Stretch to the container, segments sharing it equally. */
  fullWidth?: boolean
  /** Accessible name for the group. */
  'aria-label'?: string
  /** `sm` (28) inside a Section heading, beside other heading controls; `md`
   *  (32) where it stands with keys, as the inspector's pane switch does. */
  size?: 'sm' | 'md'
}

/**
 * The macOS segmented control, for a handful of mutually exclusive options.
 *
 * A filled track with the chosen segment raised out of it on the card colour.
 * Deliberately achromatic: this picks a *mode* -- which unit a field is in,
 * which pane is showing -- and blue is kept for keys that act. Compare
 * `LatchingKey`, which is coloured because it reports the state of a radio.
 * Segments share the width equally, so changing the selection never moves a
 * label.
 */
export function SegmentedChoice<T extends string>({
  value, options, onChange, disabled, text, fullWidth, size = 'sm', ...rest
}: Props<T>) {
  const p = useAppPalette()
  const { mode } = useThemeMode()
  // White out of a grey track in Light; on the dark grounds a raised white
  // would glare, so the segment is lifted by a translucent step instead.
  const raised = mode === 'light' ? '#FFFFFF' : alpha(p.sidebar.text, 0.16)

  return (
    <Box
      role="group"
      aria-label={rest['aria-label']}
      sx={{
        display: fullWidth ? 'grid' : 'inline-grid',
        gridAutoFlow: 'column',
        gridAutoColumns: '1fr',
        gap: '2px',
        p: '2px',
        borderRadius: '8px',
        bgcolor: alpha(p.sidebar.textDim, 0.14),
        width: fullWidth ? '100%' : undefined,
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <ButtonBase
            key={o.value}
            disableRipple
            disabled={disabled}
            aria-pressed={active}
            // Selecting what is already selected is a no-op, not a re-emit:
            // callers treat onChange as "the mode changed".
            onClick={() => { if (!active) onChange(o.value) }}
            sx={{
              fontFamily: text ? 'inherit' : MONO,
              fontSize: text ? 13 : 12,
              letterSpacing: text ? 0 : '0.06em',
              // One weight chosen or not, as DenseTabs: the raised segment and
              // the ink say which is chosen.
              fontWeight: 500,
              px: 1.25,
              // The track is the control height: 28 (24 + 2 + 2) or 32. The
              // 20 px toggle it replaced was under the minimum target size.
              minHeight: CONTROL_H[size] - 4,
              borderRadius: '6px',
              whiteSpace: 'nowrap',
              color: active ? p.sidebar.text : p.sidebar.textDim,
              bgcolor: active ? raised : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)' : 'none',
              cursor: active ? 'default' : 'pointer',
              // The shadow fades with the fill: snapping it left a frame with a
              // raised edge and no segment under it.
              transition: 'background-color .15s ease, color .15s ease, box-shadow .15s ease, transform 120ms',
              ...PRESS_SX,
              '&:hover': { color: p.sidebar.text },
              '&.Mui-focusVisible': { outline: 'none', boxShadow: `0 0 0 1px ${alpha(p.sidebar.accent, 0.65)}` },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            {o.label}
          </ButtonBase>
        )
      })}
    </Box>
  )
}
