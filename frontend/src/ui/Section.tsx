import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { CARD_SX, TEXT } from './tokens'

interface SectionProps {
  /** Heading text. Kept short — it is a label, not a sentence. */
  title: string
  /** Optional index, rendered as "1. Instruments". */
  step?: number
  /** Right-aligned controls on the heading row. */
  action?: ReactNode
  /** Small explanatory line under the heading. */
  hint?: string
  children: ReactNode
  /** Let the body grow and scroll — for the one panel per page that owns the
   *  remaining height (e.g. a results table). */
  grow?: boolean
}

/**
 * A titled block within a page.
 *
 * Every page used to inline the same 17px/700 + bottom-rule Typography, with
 * drift in `mb` and `color`. Using this keeps the rhythm identical everywhere
 * and gives headings one place to change.
 */
export function Section({ title, step, action, hint, children, grow }: SectionProps) {
  return (
    <Box
      sx={
        grow
          ? { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }
          : undefined
      }
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Typography sx={{ ...TEXT.section, color: 'text.primary', flexGrow: 1, minWidth: 0 }}>
          {step != null ? `${step}. ${title}` : title}
        </Typography>
        {action}
      </Stack>
      {hint && (
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mb: 1.5 }}>
          {hint}
        </Typography>
      )}
      <Box
        sx={
          grow
            ? { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }
            : undefined
        }
      >
        {children}
      </Box>
    </Box>
  )
}

/** Bordered container for status blocks and read-only panels. */
export function Card({ children, sx }: { children: ReactNode; sx?: object }) {
  return <Box sx={{ ...CARD_SX, ...sx }}>{children}</Box>
}
