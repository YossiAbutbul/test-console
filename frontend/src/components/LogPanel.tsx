import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import { useRef } from 'react'
import { useLog } from '../context/LogContext'

interface Props {
  embedded?: boolean
}

export function LogPanel({ embedded = false }: Props) {
  const { entries, clear } = useLog()
  const ref = useRef<HTMLDivElement>(null)
  const view = [...entries].reverse()

  const download = () => {
    const text = entries.map((e) => `[${e.ts}] ${(e.level ?? 'info').toUpperCase()} ${e.msg}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const a = document.createElement('a')
    a.href = url
    a.download = `log-${ts}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const body = (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        {!embedded && <Typography variant="h6">Log</Typography>}
        {embedded && <Box />}
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Download as .txt">
            <IconButton size="small" onClick={download} disabled={entries.length === 0}>
              <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear log">
            <IconButton size="small" onClick={clear} disabled={entries.length === 0}>
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
      <Box
        ref={ref}
        sx={{
          flex: 1,
          minHeight: 180,
          height: embedded ? '100%' : 180,
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13.5,
          bgcolor: 'transparent',
          p: 1,
          borderRadius: 1,
          border: 0,
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
      </Box>
    </>
  )

  if (embedded) {
    return <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{body}</Box>
  }
  return <Paper sx={{ p: 2 }}>{body}</Paper>
}
