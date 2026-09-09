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
  /**
   * Own the remaining height without scrolling, so a `grow` Section inside can
   * hand it to its own scroll area. Use when one panel on the page — a results
   * table — should take the leftover space and scroll within itself.
   */
  grow?: boolean
}

/**
 * Standard content container below `PageHeader`.
 *
 * Pages previously each chose their own top margin (mt 1 vs 2), max width
 * (720 / 760 / 900 / none) and overflow behaviour, so switching pages moved
 * the first control. One container fixes the rhythm.
 */
export function PageBody({ children, width = 'panel', scroll, grow }: PageBodyProps) {
  return (
    <Stack
      spacing={`${GRID_GAP}px`}
      sx={{
        mt: 1,
        maxWidth: PAGE_W[width],
        ...(scroll
          ? { flexGrow: 1, minHeight: 0, overflowY: 'auto', pr: 1, pb: 2 }
          : null),
        // `minHeight: 0` is the load-bearing half: without it the flex item
        // refuses to shrink below its content and the inner scroll never
        // engages, pushing the table off the bottom of the page instead.
        //
        // No bottom padding, unlike `scroll`. `main` already carries a 24px
        // gutter, so a second one here only shortened the panel that was
        // supposed to be taking the leftover height -- 16px of empty card
        // under a results table that wanted the room. A scrolling body needs
        // the gap so its last row does not butt against the edge; a growing
        // one ends in a bordered panel that provides its own.
        ...(grow && !scroll ? { flexGrow: 1, minHeight: 0 } : null),
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
  /**
   * Match the columns' heights instead of letting each end where its content
   * does. Use when both sides are bordered panels, where unequal heights read
   * as a mistake rather than as a layout.
   */
  stretch?: boolean
}

/**
 * Responsive two-column layout for dashboard pages: config on the left, live
 * results on the right. Collapses to a single column when the content area is
 * narrow (log drawer open on a small window).
 */
export function TwoCol({
  children, left = 1, right = 1, minCol = 300, stretch,
}: TwoColProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: `${GRID_GAP}px`,
        gridTemplateColumns: {
          xs: '1fr',
          md: `minmax(${minCol}px, ${left}fr) minmax(${minCol}px, ${right}fr)`,
        },
        alignItems: stretch ? 'stretch' : 'start',
      }}
    >
      {children}
    </Box>
  )
}
