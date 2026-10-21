import { Stack, Typography, Box } from '@mui/material'
import type { ReactNode } from 'react'
import { CONTROL_H } from '../ui'

interface Props {
  protocol?: string
  group?: string
  label: string
  actions?: ReactNode
}

export function PageHeader({ protocol, group, label, actions }: Props) {
  const crumbs = [protocol, group].filter(Boolean) as string[]
  return (
    <Stack
      direction="row"
      alignItems="center"
      // As tall as a header key even with no actions, so a page without
      // them (Switch) starts its content where every other page does.
      // Keys drop to their own line, right-aligned, only when the title and
      // keys cannot share one (laptop width with the log docked). Header keys
      // are fixed-width, so a state change never flips this wrap.
      sx={{ mb: '12px', columnGap: 2, rowGap: 1, flexWrap: 'wrap', flexShrink: 0, minHeight: CONTROL_H.md }}
    >
      {/* The section path rides on the title's baseline, after it, rather
          than as an uppercase kicker above it. Above, it was the first thing
          read on every page -- "LORA / TX" before "CW" -- and pushed the title
          down a line for a fact the sidebar already shows. */}
      <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        {/* One line, always. Wrapping at laptop width with the log docked
            stacked "Load Pull Test" three lines deep under its own crumbs. */}
        <Typography
          component="h1"
          noWrap
          sx={{
            // Tighter tracking at display size: at 26 px the system face's
            // default spacing reads loose.
            fontWeight: 700, fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'text.primary',
            flexShrink: 0,
          }}
        >
          {label}
        </Typography>
        {crumbs.length > 0 && (
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 500, color: 'text.secondary', flexShrink: 100, minWidth: 0 }}>
            {crumbs.join(' · ')}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
          {actions}
        </Box>
      )}
    </Stack>
  )
}
