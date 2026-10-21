import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadRounded'
import { useRef } from 'react'
import { useLog } from '../context/LogContext'
import { MONO } from '../ui'

interface Props {
  embedded?: boolean
}

export function LogPanel({ embedded = false }: Props) {
  const { entries, clear } = useLog()
  const ref = useRef<HTMLDivElement>(null)
  const view = [...entries].reverse()

  const download = () => {
    const text = entries.map((e) => `[${e.ts}] ${(e.level ?? 'info').toUpperCase()} [${e.source}] ${e.msg}`).join('\n')
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
        {/* An empty slot keeps the download and clear keys on the right. */}
        {embedded && <Box />}
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Download as .txt">
            <span>
              <IconButton size="small" aria-label="Download log as text" onClick={download} disabled={entries.length === 0}>
                <FileDownloadOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Clear log">
            <span>
              <IconButton size="small" aria-label="Clear log" onClick={clear} disabled={entries.length === 0}>
                <DeleteOutlineIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
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
          fontFamily: MONO,
          fontSize: 13.5,
          bgcolor: 'transparent',
          p: 1,
          borderRadius: 1,
          border: 0,
        }}
      >
        {entries.length === 0 && (
          // An empty pane said nothing about what would appear in it.
          <Typography sx={{ fontFamily: (t) => t.typography.fontFamily, fontSize: 13, color: 'text.secondary', mt: 1 }}>
            Nothing logged yet. Instrument and DUT traffic appears here, newest first.
          </Typography>
        )}
        {view.map((e, i) => (
          <Box
            key={entries.length - 1 - i}
            sx={{
              color:
                e.level === 'error' ? 'error.main' : e.level === 'warn' ? 'warning.main' : 'text.primary',
              whiteSpace: 'pre-wrap',
            }}
          >
            <Box component="span" sx={{ color: 'text.disabled' }}>[{e.ts}]</Box>{' '}
            <Box component="span" sx={{ fontWeight: 700 }}>[{e.source}]</Box> {e.msg}
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
