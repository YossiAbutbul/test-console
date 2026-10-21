import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { useAppPalette } from '../context/ThemeModeContext'
import { CARD_PAD, CARD_RADIUS, GRID_GAP, MONO, TEXT, TILE_PAD } from './tokens'

const DASH = '—'

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
          ...TEXT.eyebrow,
          color: 'text.secondary',
          mb: 0.5,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          // 24 rather than 20: this is the number the operator walks over to
          // read, and the tile has the width for it at every wrap point.
          fontFamily: MONO,
          fontSize: 24, fontWeight: 600, lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: off ? 'text.disabled' : (toneColor ?? 'text.primary'),
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {value}
        {/* No unit after a dash: "— dBm" reads as a reading of nothing in
            dBm, and the bare dash beside it ("RF output —") disagreed. */}
        {unit && value !== DASH && (
          <Typography
            component="span"
            sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', ml: 0.5, fontFamily: 'inherit' }}
          >
            {unit}
          </Typography>
        )}
      </Typography>
      {/* A fixed line box, not a minimum: 12 px text at the inherited
          line-height is 18 px, so an empty caption (16) and a filled one (18)
          made every strip 2 px taller on connect. Secondary ink: this line is
          read ("25.2 mW", "not read yet"), and disabled grey said it was not. */}
      <Typography
        sx={{
          fontSize: 12, lineHeight: '16px', height: 16, color: 'text.secondary', mt: 0.4,
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
export function StatRow({ children, minTile = 132, inCard }: {
  children: ReactNode
  minTile?: number
  /** Inside a Section card: no frame of its own, the hairline strip running
   *  to the card's edges under the heading, so tiles never sit in a box in a
   *  box with two radii. */
  inCard?: boolean
}) {
  return (
    <Box
      sx={inCard
        ? {
            borderTop: 1,
            borderColor: 'divider',
            mx: `-${CARD_PAD}px`,
            mb: `-${CARD_PAD}px`,
            overflow: 'hidden',
          }
        : {
            border: 1,
            borderColor: 'divider',
            // A card's radius: the strip sits between cards, and the control
            // radius it had read as a tighter, different kind of box.
            borderRadius: CARD_RADIUS,
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
