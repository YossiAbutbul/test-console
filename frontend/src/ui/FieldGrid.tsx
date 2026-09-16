import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { FIELD_MAX_W, FIELD_MIN_W, GRID_GAP } from './tokens'

interface FieldGridProps {
  children: ReactNode
  /** Columns at the widest breakpoint. Two rows of three beats one row of six. */
  columns?: number
  /** Let the grid use the full panel width — for wide inputs, not numbers. */
  wide?: boolean
}

/**
 * The row of inputs at the top of a command page.
 *
 * Stacked in a single column these read as a tall, mostly-empty form that
 * pushes the result off screen; stretched across a fluid panel they become
 * number fields half a screen wide. This keeps them in a compact block that
 * stops growing at a readable width.
 */
export function FieldGrid({ children, columns = 3, wide }: FieldGridProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: `${GRID_GAP}px`,
        // Container queries, not viewport ones: these grids sit inside a panel
        // that may be one of two columns with the log dock open, so the window
        // width is no guide to how many fields fit. `FIELD_MIN_W` is the point
        // below which a labelled number field starts clipping its label.
        gridTemplateColumns: '1fr',
        [`@container (min-width:${FIELD_MIN_W * 2 + GRID_GAP}px)`]: {
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        },
        [`@container (min-width:${FIELD_MIN_W * columns + GRID_GAP * (columns - 1)}px)`]: {
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        },
        ...(wide ? null : { maxWidth: FIELD_MAX_W }),
      }}
    >
      {children}
    </Box>
  )
}
