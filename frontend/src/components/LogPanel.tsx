import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useRef } from 'react'
import { useLog } from '../context/LogContext'

interface Props {
  embedded?: boolean
}

export function LogPanel({ embedded = false }: Props) {
  const { entries, clear } = useLog()
  const ref = useRef<HTMLDivElement>(null)
  const view = [...entries].reverse()

  const body = (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        {!embedded && <Typography variant="h6">Log</Typography>}
        {embedded && <Typography variant="caption" color="text.secondary">{entries.length} entries</Typography>}
        <Button size="small" onClick={clear}>Clear</Button>
      </Stack>
      <Box
        ref={ref}
        sx={{
          flex: 1,
          minHeight: 180,
          height: embedded ? '100%' : 180,
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          bgcolor: 'background.default',
          p: 1,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        {view.map((e, i) => (
          <Box
            key={entries.length - 1 - i}
            sx={{
              color:
                e.level === 'error' ? 'error.main' : e.level === 'warn' ? 'warning.main' : 'text.primary',
              whiteSpace: 'pre-wrap',
            }}
          >
            [{e.ts}] {e.msg}
          </Box>
        ))}
        {entries.length === 0 && <Box sx={{ color: 'text.secondary' }}>(empty)</Box>}
      </Box>
    </>
  )

  if (embedded) {
    return <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{body}</Box>
  }
  return <Paper sx={{ p: 2 }}>{body}</Paper>
}
