import { Box } from '@mui/material'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { createPortal } from 'react-dom'
import { usePageActive, useToolbarSlot } from '../ui/toolbarSlot'

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

/** Two-pixel run-progress bar along the bottom edge of the window toolbar.
 *  Portalled there with the page's header, for the same reason (see
 *  PageHeader): only the page on screen draws one. */
export function TopProgress({ pct = 0, indeterminate = false, hidden = false, color }: Props) {
  const slot = useToolbarSlot().bar
  const active = usePageActive()
  const { mode } = useThemeMode()
  // Previously hardcoded to the light-mode blue, which sat off-palette in the
  // mid and dark themes.
  const bg = color ?? getAppPalette(mode).actions.primary.bg

  if (!slot || !active) return null
  return createPortal(
    <Box
      sx={{
        position: 'absolute',
        bottom: 0,
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
            left: 0,
            width: '30%',
            bgcolor: bg,
            // A transform, not `left`: animating a layout property forever kept
            // the compositor busy for the whole run. Still for reduced motion,
            // a quiet band instead of a sweep.
            animation: 'tcTopProgSlide 1.2s linear infinite',
            '@keyframes tcTopProgSlide': {
              '0%': { transform: 'translateX(-100%)' },
              '100%': { transform: 'translateX(333%)' },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none', width: '100%', opacity: 0.3 },
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
    </Box>,
    slot,
  )
}
