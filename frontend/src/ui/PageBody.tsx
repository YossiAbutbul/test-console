import type { ReactNode } from 'react'
import { Stack } from '@mui/material'
import { PAGE_W } from './tokens'

interface PageBodyProps {
  children: ReactNode
  /**
   * Content width. `form` for stacked input pages, `panel` for pages with a
   * status block plus controls, `full` for data-heavy pages.
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
      spacing={2}
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
