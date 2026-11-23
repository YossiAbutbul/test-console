import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { ActivityIndicator, REDUCED_MOTION } from '../../../ui'

/**
 * The working area's loading sheet: a small frosted panel over the figure,
 * an activity indicator and what is happening, in the manner of a macOS
 * progress sheet rather than a spinner stuck on the chart.
 *
 * It sits over the figure's title, which during the wait describes the
 * result being replaced. Centred on the chart it landed on whatever was
 * there -- the optimum's label poked out beside it and read as drawn over
 * it -- and hid the data the operator was waiting to see.
 *
 * Always mounted, so it can arrive and leave: in, it fades down a few
 * pixels, settles from 96 % and comes into focus; out, it simply fades,
 * quicker than it came -- blurring on the way out smeared it over the chart.
 * Above the figure in its own layer. HTML over the SVG, not drawn in it, so
 * Copy chart never pastes it.
 */
export function AreaBusy({ show }: { show: boolean }) {
  const pal = useAppPalette()
  return (
    <Box
      aria-live="polite"
      sx={{
        position: 'absolute', left: '50%', top: 4, zIndex: 2, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.125, borderRadius: '12px',
        color: 'text.secondary',
        bgcolor: alpha(pal.paper, 0.72),
        backdropFilter: 'blur(14px) saturate(170%)',
        border: `1px solid ${alpha(pal.sidebar.text, 0.08)}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
        opacity: show ? 1 : 0,
        transform: show ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, -6px) scale(0.96)',
        transition: show
          ? 'opacity 200ms ease-out, transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          : 'opacity 120ms ease-in',
        [REDUCED_MOTION]: { transform: 'translate(-50%, 0)', transition: 'opacity 160ms ease' },
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none' },
      }}
    >
      {show && <ActivityIndicator size={16} label="Working out the area" />}
      <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap' }}>
        Working out the area…
      </Typography>
    </Box>
  )
}
