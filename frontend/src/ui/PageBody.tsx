import type { ReactNode } from 'react'
import { Box, Stack } from '@mui/material'
import { GRID_GAP, PAGE_W } from './tokens'

interface PageBodyProps {
  children: ReactNode
  /**
   * Content width. `form` for stacked input pages, `panel` for pages with a
   * status block plus controls, `grid` for the wide dashboard layout, `full`
   * for data-heavy pages.
   */
  width?: keyof typeof PAGE_W
  /** Let the body own the remaining height and scroll internally — for pages
   *  with a results table that should stay on screen. */
  scroll?: boolean
}

/**
 * Standard content container below `PageHeader`.
 *
 * Pages previously each chose their own top margin (mt 1 vs 2), max width
 * (720 / 760 / 900 / none) and overflow behaviour, so switching pages moved
 * the first control. One container fixes the rhythm.
 */
export function PageBody({ children, width = 'panel', scroll }: PageBodyProps) {
  return (
    <Stack
      spacing={`${GRID_GAP}px`}
      sx={{
        mt: 1,
        maxWidth: PAGE_W[width],
        ...(scroll
          ? { flexGrow: 1, minHeight: 0, overflowY: 'auto', pr: 1, pb: 2 }
          : null),
      }}
    >
      {children}
    </Stack>
  )
}

interface TwoColProps {
  children: ReactNode
  /** Column template. Defaults to two equal columns that stack under `minCol`. */
  left?: number
  right?: number
  /** Below this container width the columns stack to one. */
  minCol?: number
}

/**
 * Responsive two-column layout for dashboard pages: config on the left, live
 * results on the right. Collapses to a single column when the content area is
 * narrow (log drawer open on a small window).
 */
export function TwoCol({ children, left = 1, right = 1, minCol = 300 }: TwoColProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: `${GRID_GAP}px`,
        gridTemplateColumns: {
          xs: '1fr',
          md: `minmax(${minCol}px, ${left}fr) minmax(${minCol}px, ${right}fr)`,
        },
        alignItems: 'start',
      }}
    >
      {children}
    </Box>
  )
}
