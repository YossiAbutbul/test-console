import { Box, Chip, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import type { RunStatus } from '../types/models'
import { useAppPalette } from '../context/ThemeModeContext'

const STATE_COLOR: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  idle: 'default',
  running: 'info',
  done: 'success',
  cancelled: 'warning',
  error: 'error',
}

function fmtElapsed(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 15,
          fontWeight: 600,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

export function ProgressRow({
  status,
  cancelling = false,
}: { status: RunStatus | undefined; cancelling?: boolean }) {
  const p = useAppPalette()
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status?.state !== 'running') return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [status?.state])

  const total = status?.total ?? 0
  const completed = status?.completed ?? 0
  const pct = total > 0 ? (completed / total) * 100 : 0
  const r = status?.last_row
  const state = status?.state ?? 'idle'
  const elapsed =
    status?.started_at != null
      ? ((status.finished_at ?? Date.now() / 1000) - status.started_at) * 1000
      : 0

  // Each bar runs from the state's colour into a lighter cast of it, so the
  // fill reads as one hue at a glance rather than as two. Palette-derived: a
  // fixed blue-into-navy sat oddly on the slate ground.
  const barGradient =
    cancelling || state === 'cancelled'
      ? `linear-gradient(90deg,${p.data.warn},${alpha(p.data.warn, 0.62)})`
      : state === 'error'
        ? `linear-gradient(90deg,${p.data.bad},${alpha(p.data.bad, 0.62)})`
        : `linear-gradient(90deg,${p.sidebar.accent},${alpha(p.sidebar.accent, 0.55)})`

  return (
    <Box
      sx={{
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Stack direction="row" alignItems="baseline" spacing={1.5}>
          <Chip
            size="small"
            color={cancelling ? 'warning' : (STATE_COLOR[state] ?? 'default')}
            label={cancelling ? 'cancelling' : state}
            sx={{
              textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5, height: 22,
              animation: cancelling ? 'tcPulse 1s ease-in-out infinite' : undefined,
              '@keyframes tcPulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.5 },
              },
            }}
          />
          <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>
            {completed} / {total}
          </Typography>
          {status?.error && (
            <Typography variant="caption" color="error">{status.error}</Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={2}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {fmtElapsed(elapsed)} elapsed
          </Typography>
          <Typography
            sx={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              fontWeight: 600,
              minWidth: 50,
              textAlign: 'right',
            }}
          >
            {pct.toFixed(0)}%
          </Typography>
        </Stack>
      </Stack>

      <Box
        sx={{
          position: 'relative',
          height: 10,
          borderRadius: 999,
          bgcolor: p.appBarBorder,
          overflow: 'hidden',
          mb: 2,
        }}
      >
        {cancelling ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: 999,
              backgroundImage: `${barGradient}, ${barGradient}`,
              backgroundSize: '40% 100%',
              backgroundRepeat: 'no-repeat',
              animation: 'tcSlide 1.2s linear infinite',
              '@keyframes tcSlide': {
                '0%': { backgroundPosition: '-40% 0' },
                '100%': { backgroundPosition: '140% 0' },
              },
            }}
          />
        ) : (
          <Box
            sx={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundImage: barGradient,
              transition: 'width 0.2s ease',
            }}
          />
        )}
      </Box>

      <Stack
        direction="row"
        spacing={2}
        divider={<Box sx={{ width: '1px', bgcolor: 'divider' }} />}
      >
        <Stat label="Step" value={r ? `#${r.idx}` : '—'} mono />
        <Stat
          label="HP / Duty"
          value={
            r
              ? `0x${r.hp_max.toString(16).padStart(2, '0')} / 0x${r.pa_duty_cycle.toString(16).padStart(2, '0')}`
              : '—'
          }
          mono
        />
        <Stat label="P set" value={r ? `${r.power_dbm_setting} dBm` : '—'} mono />
        <Stat
          label="P meas"
          value={r && r.tx_power_dbm != null ? `${r.tx_power_dbm.toFixed(2)} dBm` : '—'}
          mono
        />
        <Stat
          label="Current"
          value={r && r.current_a != null ? `${(r.current_a * 1000).toFixed(1)} mA` : '—'}
          mono
        />
        <Stat label="Result" value={r ? (r.ok ? 'PASS' : 'FAIL') : '—'} />
      </Stack>
    </Box>
  )
}
