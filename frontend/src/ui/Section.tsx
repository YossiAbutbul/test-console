import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { CARD_PAD, CARD_SX, PANEL_SX, TEXT } from './tokens'

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
  /**
   * Render as a bordered panel instead of a bare heading + rule.
   *
   * Panels are for content that is a distinct object on the page (a config
   * block, a results pane). Plain headings are for sections that simply divide
   * a single flow — wrapping those in a border just adds lines to look at.
   */
  panel?: boolean
}

/**
 * A titled block within a page.
 *
 * Two looks share one heading rhythm: a bordered `panel`, or the default flat
 * heading with a bottom rule. Both use the same 13px uppercase label so the
 * eye reads them as one hierarchy level regardless of the frame.
 */
export function Section({
  title, step, action, hint, children, grow, panel,
}: SectionProps) {
  const growSx = { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }

  const heading = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        mb: panel ? 1.25 : 1.25,
        pb: panel ? 0 : 0.75,
        ...(panel ? null : { borderBottom: 1, borderColor: 'divider' }),
        flexShrink: 0,
        minHeight: 26,
      }}
    >
      <Typography
        sx={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'text.secondary',
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {step != null ? `${step}. ${title}` : title}
      </Typography>
      {action}
    </Stack>
  )

  const body = (
    <>
      {hint && (
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: -0.5, mb: 1.25 }}>
          {hint}
        </Typography>
      )}
      <Box sx={grow ? growSx : undefined}>{children}</Box>
    </>
  )

  return (
    <Box
      sx={{
        ...(panel ? { ...PANEL_SX, p: `${CARD_PAD}px` } : null),
        ...(grow ? growSx : null),
      }}
    >
      {heading}
      {body}
    </Box>
  )
}

/** Bordered container for status blocks and read-only panels. */
export function Card({ children, sx }: { children: ReactNode; sx?: object }) {
  return <Box sx={{ ...CARD_SX, ...sx }}>{children}</Box>
}
