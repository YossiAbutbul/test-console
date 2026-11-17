import { useEffect, useState } from 'react'
import { Box, Tooltip } from '@mui/material'
import { useConnection } from '../../context/ConnectionContext'
import { StatusChip } from '../../ui'
import type { BleLinkPhase } from './useBleLink'

/**
 * Where the BLE radio sequence is, for the page header.
 *
 * The page spends most of a BLE test with the DUT off the link -- rebooting
 * onto a new power, or transmitting a tone it cannot be stopped from -- and
 * without this the only sign was a Send key greyed to "Needs DUT", which reads
 * as a fault. This says which step it is in and, on air, how long is left.
 *
 * Fixed width, so the keys beside it hold still as the label changes from
 * "Ready" to "On air · ch 22 · 148 s".
 */
const WIDTH = 212

function useCountdown(untilMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (untilMs == null) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [untilMs])
  return untilMs == null ? null : Math.max(0, Math.ceil((untilMs - now) / 1000))
}

export function BleLinkStatus({ phase, power }: { phase: BleLinkPhase; power: number | null }) {
  const left = useCountdown(phase.kind === 'on-air' ? phase.untilMs : null)
  const { status } = useConnection()
  // Idle only means nothing is in flight here; with no DUT on the link it
  // is not ready for anything, and "Ready" beside a "Needs DUT" key read
  // as a contradiction.
  const linked = !!(status?.connected && status.transport_ready)

  const view = ((): { label: string; detail?: string; tone: 'ok' | 'busy' | 'off' | 'error'; spinning?: boolean; tip: string } => {
    switch (phase.kind) {
      case 'idle':
        if (!linked) {
          return { label: 'No DUT', tone: 'off', tip: 'Connect the DUT to send a tone.' }
        }
        return {
          label: 'Ready',
          detail: power == null ? 'power unknown' : `power ${power}`,
          tone: 'ok',
          tip: power == null
            ? 'Not read yet. The first Send reads it, and resets the DUT only if it differs.'
            : `Tone power ${power}, as last read back from the DUT.`,
        }
      case 'setting-power':
        return { label: 'Setting power', detail: String(phase.param), tone: 'busy', spinning: true, tip: 'Tone power, then save-and-reset.' }
      case 'rebooting':
        return { label: 'Resetting DUT', detail: `power ${phase.param}`, tone: 'busy', spinning: true, tip: 'The DUT is rebooting onto the new power; reconnecting when it advertises.' }
      case 'on-air':
        return {
          label: 'On air',
          detail: `ch ${phase.channel} · ${left ?? 0} s`,
          tone: 'busy',
          tip: 'Transmitting a test tone. The DUT is off the link and cannot be stopped; it reconnects when the tone ends.',
        }
      case 'relinking':
        return { label: 'Reconnecting', tone: 'busy', spinning: true, tip: 'Scanning for the DUT to come back.' }
      case 'lost':
        return { label: 'DUT not back', tone: 'error', tip: phase.message }
    }
  })()

  return (
    <Tooltip title={view.tip}>
      <Box sx={{ width: WIDTH, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <StatusChip label={view.label} detail={view.detail} tone={view.tone} spinning={view.spinning} />
      </Box>
    </Tooltip>
  )
}
