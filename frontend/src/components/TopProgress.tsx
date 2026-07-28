import { Box } from '@mui/material'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { TOP_BAR_H } from '../ui/tokens'

interface Props {
  /** 0..100. Ignored when indeterminate. */
  pct?: number
  /** When true, show indeterminate sliding animation. */
  indeterminate?: boolean
  /** When true, render hidden (preserves layout space). */
  hidden?: boolean
  /** Override the accent. Defaults to the theme's action colour. */
  color?: string
}

/** Two-pixel run-progress bar pinned under the top bar. */
export function TopProgress({ pct = 0, indeterminate = false, hidden = false, color }: Props) {
  const { mode } = useThemeMode()
  // Previously hardcoded to the light-mode blue, which sat off-palette in the
  // mid and dark themes.
  const bg = color ?? getAppPalette(mode).actions.scan.bg

  return (
    <Box
      sx={{
        position: 'fixed',
        top: TOP_BAR_H,
        left: 0,
        right: 0,
        height: 2,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: hidden ? 0 : 1,
        transition: 'opacity 0.2s',
        zIndex: (t) => t.zIndex.drawer + 3,
      }}
    >
      {indeterminate ? (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '30%',
            bgcolor: bg,
            animation: 'tcTopProgSlide 1.2s linear infinite',
            '@keyframes tcTopProgSlide': {
              '0%': { left: '-30%' },
              '100%': { left: '100%' },
            },
          }}
        />
      ) : (
        <Box
          sx={{
            height: '100%',
            width: `${Math.max(0, Math.min(100, pct))}%`,
            bgcolor: bg,
            transition: 'width 0.25s ease',
          }}
        />
      )}
    </Box>
  )
}
