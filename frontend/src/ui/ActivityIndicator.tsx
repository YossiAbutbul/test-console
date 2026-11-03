import { Box } from '@mui/material'
import { REDUCED_MOTION } from './feel'

/**
 * The macOS / iOS activity indicator: twelve rounded spokes, the leading one
 * darkest, stepping round a twelfth at a time.
 *
 * For work the operator is waiting on inside a surface -- a chart being
 * worked out -- where a key's ring spinner (KeySpinner) would read as a
 * button's state. It takes the text colour it sits in. Under reduced motion
 * it steps at half speed rather than stopping: a still indicator reads as
 * frozen, which is the one thing a loading state must not say.
 */
export function ActivityIndicator({ size = 18, label }: { size?: number; label?: string }) {
  const spokes = 12
  return (
    <Box
      component="span"
      role="progressbar"
      aria-label={label ?? 'Loading'}
      sx={{
        display: 'inline-block', width: size, height: size, flexShrink: 0, color: 'inherit',
        animation: 'activityStep 1s steps(12) infinite',
        '@keyframes activityStep': { to: { transform: 'rotate(360deg)' } },
        [REDUCED_MOTION]: { animationDuration: '2s' },
      }}
    >
      <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden style={{ display: 'block' }}>
        {Array.from({ length: spokes }, (_, i) => (
          <rect
            key={i} x={-1.25} y={-11} width={2.5} height={6} rx={1.25}
            fill="currentColor"
            // It turns clockwise, so the highest spoke leads, brightest, and
            // the rest trail off behind it.
            opacity={0.18 + (0.82 * (i + 1)) / spokes}
            transform={`rotate(${(i * 360) / spokes})`}
          />
        ))}
      </svg>
    </Box>
  )
}
