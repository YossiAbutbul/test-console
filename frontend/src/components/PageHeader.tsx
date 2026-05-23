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
      alignItems="flex-end"
      sx={{ mb: '12px', gap: 2 }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {crumbs.length > 0 && (
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: 'text.secondary',
              mb: 0.5,
            }}
          >
            {crumbs.join(' / ')}
          </Typography>
        )}
        <Typography
          component="h1"
          sx={{ fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: 'text.primary' }}
        >
          {label}
        </Typography>
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </Box>
      )}
    </Stack>
  )
}
