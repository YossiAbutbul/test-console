import { Typography, type SxProps, type Theme } from '@mui/material'
import { TEXT } from './tokens'
import { formatRunTiming, useRunEta, type RunEtaOptions } from './useRunEta'

interface RunTimingProps extends RunEtaOptions {
  sx?: SxProps<Theme>
}

/**
 * Elapsed / remaining line for a running test. Renders nothing while idle, so
 * a page can leave it in place and show its pre-run estimate beside it.
 */
export function RunTiming({ sx, ...opts }: RunTimingProps) {
  const eta = useRunEta(opts)
  if (!eta) return null
  return (
    <Typography
      component="span"
      sx={[
        {
          ...TEXT.micro,
          color: 'text.secondary',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {formatRunTiming(eta)}
    </Typography>
  )
}
