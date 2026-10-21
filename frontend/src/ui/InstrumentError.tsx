import { Box, Typography } from '@mui/material'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import { MONO, TEXT } from './tokens'

interface InstrumentErrorProps {
  /** What failed, in a few words. */
  title?: string
  /** The detail: a classified hint, or the instrument's own error text. */
  message: string
  /** The message is the instrument's or driver's own words, set in mono. */
  raw?: boolean
}

/**
 * An instrument error on a Components page, in one shape everywhere.
 *
 * Each page used to style this itself -- 11 px mono on two pages, 12 px sans
 * on two more, a bold title with a grey hint on the Power Meter -- so the same
 * kind of failure looked like a different kind of message depending on the
 * page. The leading "RuntimeError: " a Python exception carries is dropped:
 * it names the exception class, not the problem.
 */
export function InstrumentError({ title = 'The instrument reported an error', message, raw }: InstrumentErrorProps) {
  const text = raw ? message.replace(/^[A-Z]\w*(Error|Exception):\s*/, '') : message
  return (
    <Box role="alert" sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1.5 }}>
      <ErrorOutlineRoundedIcon sx={{ fontSize: 18, color: 'error.main', mt: '1px', flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ ...TEXT.label, fontWeight: 600, color: 'error.main' }}>{title}</Typography>
        <Typography
          sx={{
            ...TEXT.hint,
            color: 'text.secondary',
            fontFamily: raw ? MONO : undefined,
            overflowWrap: 'anywhere',
          }}
        >
          {text}
        </Typography>
      </Box>
    </Box>
  )
}
