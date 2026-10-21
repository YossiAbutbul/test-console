import { Stack, Typography, Box } from '@mui/material'
import type { ReactNode } from 'react'

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
      sx={{ mb: '12px', gap: 2 }}
    >
      {/* The section path rides on the title's baseline, after it, rather
          than as an uppercase kicker above it. Above, it was the first thing
          read on every page -- "LORA / TX" before "CW" -- and pushed the title
          down a line for a fact the sidebar already shows. */}
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography
          component="h1"
          sx={{
            fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: 'text.primary',
            textWrap: 'balance', minWidth: 0,
          }}
        >
          {label}
        </Typography>
        {crumbs.length > 0 && (
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 500, color: 'text.secondary', flexShrink: 0 }}>
            {crumbs.join(' · ')}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </Box>
      )}
    </Stack>
  )
}
