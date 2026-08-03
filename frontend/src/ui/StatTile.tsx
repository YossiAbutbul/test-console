import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { GRID_GAP, MONO, TILE_PAD } from './tokens'

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
}

/**
 * One readout in the measurement strip.
 *
 * Deliberately plain: a hairline cell, 12px padding, no shadow, no accent bar,
 * no icon. In a data-dense instrument view the *numbers* carry the meaning, so
 * chrome around them is noise — colour is reserved for encoding state (a dead
 * channel greys out), never for decoration.
 */
export function StatTile({ label, value, unit, sub, off }: StatTileProps) {
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
          color: off ? 'text.disabled' : 'text.primary',
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
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minTile}px, 1fr))`,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        // Hairline between cells, drawn on the cell itself so wrapped rows
        // divide correctly without a separate divider element.
        '& > *:not(:first-of-type)': {
          borderLeft: 1,
          borderColor: 'divider',
        },
      }}
    >
      {children}
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
