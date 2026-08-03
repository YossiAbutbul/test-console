import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { FIELD_MAX_W, GRID_GAP } from './tokens'

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
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: `repeat(${columns}, minmax(0, 1fr))`,
        },
        ...(wide ? null : { maxWidth: FIELD_MAX_W }),
      }}
    >
      {children}
    </Box>
  )
}
