import { useState } from 'react'
import { Box, Collapse, Link, Stack, Typography } from '@mui/material'
import type { ConnectFailure } from '../lib/instrumentError'
import { MONO, TEXT } from '../ui'

interface FailureNoteProps {
  failure: ConnectFailure
  /** Left inset, to line up under an icon + label row. */
  indent?: number
}

/**
 * A connect failure, explained.
 *
 * Leads with the fix, because that is what the person at the bench needs. The
 * driver's own text is kept one click away rather than removed — it is what
 * makes an unfamiliar failure diagnosable.
 */
export function FailureNote({ failure, indent = 0 }: FailureNoteProps) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <Box sx={{ ml: indent, mt: 0.25 }}>
      <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
        <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
          {failure.hint}
        </Typography>
        <Link
          component="button"
          type="button"
          underline="hover"
          onClick={() => setShowRaw((v) => !v)}
          sx={{ ...TEXT.micro, color: 'text.secondary' }}
        >
          {showRaw ? 'hide details' : 'details'}
        </Link>
      </Stack>
      <Collapse in={showRaw}>
        <Typography
          sx={{
            ...TEXT.micro,
            fontFamily: MONO,
            color: 'text.secondary',
            mt: 0.5,
            p: 1,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            wordBreak: 'break-word',
          }}
        >
          {failure.raw}
        </Typography>
      </Collapse>
    </Box>
  )
}
