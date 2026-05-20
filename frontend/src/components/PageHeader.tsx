import { Stack, Typography, Box } from '@mui/material'
import type { ReactNode } from 'react'

interface Props {
  group?: string
  label: string
  actions?: ReactNode
}

export function PageHeader({ group, label, actions }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{ mb: 3, gap: 2, minHeight: 40 }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexGrow: 1, minWidth: 0 }}>
        {group && <Typography sx={{ fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>{group}</Typography>}
        {group && <Typography sx={{ fontWeight: 600, fontSize: 22, color: 'text.secondary', lineHeight: 1.2 }}>/</Typography>}
        <Typography sx={{ fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>{label}</Typography>
      </Stack>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </Box>
      )}
    </Stack>
  )
}
