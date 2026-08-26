import { Box, ButtonBase } from '@mui/material'
import { useAppPalette } from '../context/ThemeModeContext'
import { MONO } from './tokens'

export interface ChoiceOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T
  options: ChoiceOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
}

/**
 * Small segmented picker for a handful of mutually exclusive options.
 *
 * Deliberately achromatic: the selected segment takes the same soft wash the
 * sidebar uses for a selected item. This picks a *mode* — which unit a field is
 * in — and Anodized keeps colour for things that mean something about the
 * hardware. Compare `LatchingKey`, which is coloured because it reports the
 * state of a radio.
 */
export function SegmentedChoice<T extends string>({
  value, options, onChange, disabled,
}: Props<T>) {
  const p = useAppPalette()

  return (
    <Box
      sx={{
        display: 'inline-flex',
        border: 1,
        borderColor: p.appBarBorder,
        borderRadius: 1,
        overflow: 'hidden',
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
              fontFamily: MONO,
              fontSize: 10.5,
              letterSpacing: '0.06em',
              fontWeight: active ? 700 : 500,
              px: 1,
              py: 0.35,
              color: active ? p.sidebar.text : p.sidebar.textDim,
              bgcolor: active ? p.sidebar.accentSoftHover : 'transparent',
              cursor: active ? 'default' : 'pointer',
              transition: 'background-color .15s ease, color .15s ease',
              '&:hover': {
                bgcolor: active ? p.sidebar.accentSoftHover : p.sidebar.hover,
              },
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
