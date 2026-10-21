import { useEffect, useState } from 'react'
import SensorsRoundedIcon from '@mui/icons-material/SensorsRounded'
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded'
import CellTowerRoundedIcon from '@mui/icons-material/CellTowerRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import { Box, Stack, Tooltip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { formatDuration } from '../lib/async'
import { useLiveOutputs, type LiveOutputEntry } from '../context/liveOutput'

/**
 * A glyph per kind of output. Red already meant FAIL in the tables and the
 * emergency stop in the Load Pull header, so a red pill on its own said
 * "something is wrong" rather than which thing is live. The glyph says it:
 * radiating, powering, the LTE modem on air, a run in progress.
 */
const KIND_ICON = {
  rf: SensorsRoundedIcon,
  dc: PowerSettingsNewRoundedIcon,
  lte: CellTowerRoundedIcon,
  run: PlayArrowRoundedIcon,
} as const

interface Props {
  onSelect: (pageId: string) => void
  /** Drop the detail text on a narrow bar, where the search box needs the room. */
  compact?: boolean
}

/**
 * Re-render once a second while any pill is counting down, so the countdown
 * moves and an expired pill drops out. Idle otherwise.
 */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active])
  return active ? now : null
}

/**
 * Red pills in the top bar for every output that is live -- RF keyed, DC on,
 * LTE transmitting, a run in progress -- so it is visible from whichever page
 * the operator is on. Clicking one goes to the page that controls it.
 */
export function LiveOutputPills({ onSelect, compact }: Props) {
  const all = useLiveOutputs()
  const counting = all.some((e) => e.untilMs != null)
  const now = useNow(counting)

  // A run that keys the LTE modem point by point would otherwise flash an
  // "LTE TX" pill on and off at every point beside its own "Run" pill.
  const runPages = new Set(all.filter((e) => e.kind === 'run').map((e) => e.pageId))
  const shown = all.filter((e) => {
    if (e.kind === 'lte' && e.untilMs == null && runPages.has(e.pageId)) return false
    // Before the first tick `now` is null; keep the pill rather than guess.
    if (e.untilMs != null && now != null && e.untilMs <= now) return false
    return true
  })
  if (shown.length === 0) return null

  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
      {shown.map((e) => (
        <Pill key={e.key} entry={e} now={now} compact={compact} onSelect={onSelect} />
      ))}
    </Stack>
  )
}

function Pill({
  entry, now, compact, onSelect,
}: { entry: LiveOutputEntry; now: number | null; compact?: boolean; onSelect: (id: string) => void }) {
  // A run is ongoing work rather than a hazard on the bench, so it gets the
  // warning colour; anything radiating or powering the DUT is red.
  const tone = entry.kind === 'run' ? 'warning' : 'error'
  const Icon = KIND_ICON[entry.kind]
  const countdown = entry.untilMs != null && now != null
    ? formatDuration(Math.max(0, entry.untilMs - now))
    : null
  const detail = [entry.detail, countdown && `${countdown} left`].filter(Boolean).join(' · ')
  const title = [
    `${entry.label}${detail ? ` — ${detail}` : ''}`,
    entry.note,
    'Click to open its page.',
  ].filter(Boolean).join('\n')

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{title}</Box>}>
      <Box
        component="button"
        type="button"
        onClick={() => onSelect(entry.pageId)}
        aria-label={`${entry.label}${detail ? `, ${detail}` : ''}. Open its page.`}
        sx={(t) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          // Sized to the bench lamps beside it, and big enough to register
          // from across the bench: at 24 px and 11.5 px an RF ON pill was the
          // smallest thing on a page it was meant to dominate.
          height: 30,
          px: 1.25,
          border: `1px solid ${alpha(t.palette[tone].main, 0.55)}`,
          borderRadius: 15,
          bgcolor: alpha(t.palette[tone].main, 0.14),
          color: t.palette[tone].main,
          font: 'inherit',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.3,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          minWidth: 0,
          '&:hover': { bgcolor: alpha(t.palette[tone].main, 0.24) },
          '&:focus-visible': { outline: `2px solid ${t.palette[tone].main}`, outlineOffset: 1 },
        })}
      >
        <Box
          component="span"
          sx={{
            display: 'inline-flex', flexShrink: 0,
            // The pulse stays, now on the glyph: the one moving thing in the
            // bar is the thing that is live.
            animation: 'tcLivePulse 1.4s ease-in-out infinite',
            '@keyframes tcLivePulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.45 },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Icon sx={{ fontSize: 17 }} />
        </Box>
        {entry.label}
        {!compact && detail && (
          <Box
            component="span"
            sx={{ fontWeight: 500, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}
          >
            {detail}
          </Box>
        )}
      </Box>
    </Tooltip>
  )
}
