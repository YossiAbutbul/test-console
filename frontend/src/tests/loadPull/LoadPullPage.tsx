import { Box, Typography } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import type { TestPageProps } from '../types'

export function LoadPullPage({ protocol, group }: TestPageProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader protocol={protocol} group={group} label="Load Pull" />
      <Box sx={{ mt: 4, display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 13, color: 'text.disabled', fontStyle: 'italic' }}>
          coming soon
        </Typography>
      </Box>
    </Box>
  )
}
