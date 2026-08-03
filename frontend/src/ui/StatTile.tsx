import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { useAppPalette } from '../context/ThemeModeContext'
import { GRID_GAP, MONO, TILE_PAD } from './tokens'

/** How a reading compares to what was expected. Drives the only colour on the
 *  strip, so a value that needs attention is the one thing that stands out. */
export type StatTone = 'ok' | 'warn' | 'bad'

interface StatTileProps {
  /** Micro-label above the value, e.g. "TX power". */
  label: string
  /** The measurement itself, already formatted. Use "—" for no reading. */
  value: ReactNode
  /** Unit, rendered small and muted after the value. */
  unit?: string
  /** One short line of context under the value, e.g. "25.2 mW". */
  sub?: string
  /** No live source for this channel — greys the value and marks it inactive. */
  off?: boolean
  /** Colour the value by how it measured up. Omit for a plain reading. */
  tone?: StatTone
}

/**
 * One readout in the measurement strip.
 *
 * Deliberately plain: a hairline cell, 12px padding, no shadow, no accent bar,
 * no icon. In a data-dense instrument view the *numbers* carry the meaning, so
 * chrome around them is noise — colour is reserved for encoding state (a dead
 * channel greys out), never for decoration.
 */
export function StatTile({ label, value, unit, sub, off, tone }: StatTileProps) {
  const p = useAppPalette()
  const toneColor = tone ? p.data[tone] : undefined
  return (
    <Box sx={{ minWidth: 0, px: `${TILE_PAD}px`, py: 1.25 }}>
      <Typography
        sx={{
          fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
          textTransform: 'uppercase', color: 'text.secondary',
          mb: 0.5,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 20, fontWeight: 600, lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: off ? 'text.disabled' : (toneColor ?? 'text.primary'),
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {value}
        {unit && (
          <Typography
            component="span"
            sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary', ml: 0.5, fontFamily: 'inherit' }}
          >
            {unit}
          </Typography>
        )}
      </Typography>
      <Typography
        sx={{
          fontSize: 11, color: 'text.disabled', mt: 0.4,
          minHeight: 15,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {sub ?? ''}
      </Typography>
    </Box>
  )
}

/**
 * The measurement strip: readouts sharing one bordered surface, divided by
 * hairlines rather than each floating in its own card. Reads as a single
 * instrument panel — and costs one border instead of N.
 */
export function StatRow({ children, minTile = 132 }: { children: ReactNode; minTile?: number }) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      {/* Every cell carries a top and left hairline; the grid is then offset by
          one pixel so the first row's and first column's hairlines land outside
          the frame and are clipped. Dividers therefore stay correct for any
          number of tiles at any wrap point — no :first-child special-casing,
          which breaks the moment the row wraps. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${minTile}px, 1fr))`,
          ml: '-1px',
          mt: '-1px',
          '& > *': { borderLeft: 1, borderTop: 1, borderColor: 'divider' },
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** Row of stat tiles with no shared frame — for nesting inside a Section. */
export function StatGrid({ children, minTile = 132 }: { children: ReactNode; minTile?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minTile}px, 1fr))`,
        gap: `${GRID_GAP}px`,
      }}
    >
      {children}
    </Box>
  )
}
