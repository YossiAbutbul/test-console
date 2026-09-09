import { useState, type ReactNode } from 'react'
import { Box, Collapse, Stack, Typography } from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
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
  /**
   * Drop the panel's bottom padding.
   *
   * For a `grow` panel whose child is its own scroll area: the padding leaves
   * a strip of dead space under scrolling content, which reads as the list
   * having stopped short rather than as breathing room. Only sensible with
   * `panel`, and only when the child actually reaches the edge.
   */
  flush?: boolean
  /**
   * Let the whole heading row toggle the body. For detail that is worth
   * keeping on the page but not worth the room it takes when you are not
   * reading it — a raw frame dump, a long parameter list.
   */
  collapsible?: boolean
  /** Start expanded. Ignored unless `collapsible`. */
  defaultOpen?: boolean
}

/**
 * A titled block within a page.
 *
 * Two looks share one heading rhythm: a bordered `panel`, or the default flat
 * heading with a bottom rule. Both use the same 13px uppercase label so the
 * eye reads them as one hierarchy level regardless of the frame.
 */
export function Section({
  title, step, action, hint, children, grow, panel, collapsible, flush,
  defaultOpen = true,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const growSx = { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }
  // A collapsed body must not keep reserving the heading's bottom margin, or
  // every collapsed panel carries a band of empty space under its title.
  const collapsed = collapsible && !open

  const heading = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      onClick={collapsible ? () => setOpen((v) => !v) : undefined}
      // The whole row is the target: a 16px chevron is a needlessly small
      // thing to ask someone to hit for a purely presentational toggle.
      {...(collapsible
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-expanded': open,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpen((v) => !v)
              }
            },
          }
        : null)}
      sx={{
        mb: collapsed ? 0 : 1.25,
        pb: panel ? 0 : 0.75,
        ...(panel ? null : { borderBottom: 1, borderColor: 'divider' }),
        flexShrink: 0,
        minHeight: 26,
        transition: 'margin 0.15s',
        ...(collapsible
          ? {
              cursor: 'pointer',
              userSelect: 'none',
              // Widen the hit area to the panel edges without moving the text.
              mx: panel ? `-${CARD_PAD}px` : 0,
              px: panel ? `${CARD_PAD}px` : 0,
              borderRadius: 1,
              '&:hover .section-title': { color: 'text.primary' },
              '&:focus-visible': { outline: 2, outlineColor: 'text.primary', outlineOffset: 2 },
            }
          : null),
      }}
    >
      <Typography
        className="section-title"
        sx={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'text.secondary',
          flexGrow: 1,
          minWidth: 0,
          transition: 'color 0.15s',
        }}
      >
        {step != null ? `${step}. ${title}` : title}
      </Typography>
      {action}
      {collapsible && (
        // The rotation goes on a wrapper, not the icon: a CSS transform set
        // directly on an <svg> is not honoured everywhere, so the chevron
        // silently stayed put while the panel opened underneath it.
        <Box
          component="span"
          sx={{
            display: 'flex',
            flexShrink: 0,
            color: 'text.secondary',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s',
          }}
        >
          <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
      )}
    </Stack>
  )

  const inner = (
    <>
      {hint && (
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: -0.5, mb: 1.25 }}>
          {hint}
        </Typography>
      )}
      <Box sx={grow ? growSx : undefined}>{children}</Box>
    </>
  )

  // `unmountOnExit` so a collapsed panel costs nothing to keep on the page —
  // these hold frame dumps and result lists, not a line of text.
  const body = collapsible
    ? <Collapse in={open} unmountOnExit>{inner}</Collapse>
    : inner

  return (
    <Box
      sx={{
        ...(panel
          ? { ...PANEL_SX, p: `${CARD_PAD}px`, ...(flush ? { pb: 0 } : null) }
          : null),
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
