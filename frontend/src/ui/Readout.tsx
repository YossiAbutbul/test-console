import type { ReactNode } from 'react'
import { Box, Chip, CircularProgress, Typography } from '@mui/material'
import { MONO, TEXT } from './tokens'

/** Uppercase micro-label that sits above a value. */
export function Eyebrow({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography sx={{ ...TEXT.eyebrow, color: 'text.secondary', ...sx }}>
      {children}
    </Typography>
  )
}

interface ReadoutProps {
  /** Micro-label above the value. Omit for a bare value. */
  label?: string
  /** Pre-formatted value. Use `lib/format` to produce it. */
  value: ReactNode
  /** Unit of the value — "pulses", "dBm". */
  unit?: string
  /** Any other short trailing annotation, e.g. the command that set the value.
   *  Rendered like `unit`; separate so `unit` keeps meaning a unit. */
  note?: string
}

/** Labelled monospace measurement value — the app's primary "number" display. */
export function Readout({ label, value, unit, note }: ReadoutProps) {
  const trailing = [unit, note].filter(Boolean).join(' · ')
  return (
    <Box sx={{ minWidth: 0 }}>
      {label && <Eyebrow>{label}</Eyebrow>}
      <Typography sx={{ ...TEXT.readout, color: 'text.primary' }}>
        {value}
        {trailing && (
          <Typography
            component="span"
            sx={{ ...TEXT.hint, color: 'text.secondary', ml: 0.75, fontFamily: 'inherit' }}
          >
            {trailing}
          </Typography>
        )}
      </Typography>
    </Box>
  )
}

/** 8px filled circle — the app's connection/activity indicator. */
export function StatusDot({ color }: { color: string }) {
  return <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, ml: 0.75 }} />
}

interface StatusChipProps {
  label: string
  /** Drives the dot and text colour. */
  tone: 'ok' | 'busy' | 'off' | 'error'
  /** Extra detail appended after a separator. */
  detail?: string
  /** Show a spinner instead of a static dot. */
  spinning?: boolean
}

const TONE_COLOR: Record<StatusChipProps['tone'], string> = {
  ok: 'success.main',
  busy: 'warning.main',
  off: 'text.disabled',
  error: 'error.main',
}

/** Dot + label chip. Used for every instrument/connection state in the app. */
export function StatusChip({ label, tone, detail, spinning }: StatusChipProps) {
  const color = TONE_COLOR[tone]
  return (
    <Chip
      size="small"
      icon={
        spinning
          ? <CircularProgress size={10} sx={{ color: `${color} !important`, ml: 0.75 }} />
          : <StatusDot color={color} />
      }
      label={detail ? `${label} · ${detail}` : label}
      sx={{ ...TEXT.dense, color }}
    />
  )
}

/** Monospace label/value pair used for identifiers (MAC, resource, port). */
export function MonoText({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography sx={{ fontFamily: MONO, ...TEXT.hint, color: 'text.secondary', ...sx }}>
      {children}
    </Typography>
  )
}
