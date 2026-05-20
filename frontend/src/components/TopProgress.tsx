import { Box } from '@mui/material'

interface Props {
  /** 0..100. Ignored when indeterminate. */
  pct?: number
  /** When true, show indeterminate sliding animation. */
  indeterminate?: boolean
  /** When true, render hidden (preserves layout space). */
  hidden?: boolean
  color?: string
}

export function TopProgress({ pct = 0, indeterminate = false, hidden = false, color }: Props) {
  const bg = color ?? '#3D6BC4'
  return (
    <Box
      sx={{
        position: 'fixed',
        top: 56, // TOP_BAR_H
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
