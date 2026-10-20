import { useMemo, useState } from 'react'
import { Box, Popover, Tooltip, Typography } from '@mui/material'
import { useConnection } from '../context/ConnectionContext'
import { useInstrumentsActions, useInstrumentsState } from '../context/InstrumentsContext'
import { useNicknames } from '../context/NicknamesContext'
import { CheckMark, type CheckState } from '../ui'
import { DutControls } from './ConnectionPanel'

const lampSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  height: 30,
  px: 1,
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
  color: 'text.primary',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  minWidth: 0,
  '&:hover': { borderColor: 'text.secondary' },
  '&:focus-visible': { outline: 2, outlineColor: 'text.primary', outlineOffset: 1 },
} as const

/**
 * DUT and instrument state in the top bar, on every page.
 *
 * The test pages carry the same facts in their check course; these are for
 * everywhere else -- a Components page has no course, and before this the
 * only sign of the DUT there was a word at the foot of the sidebar. Each lamp
 * is a mark plus words, never a bare dot.
 *
 * The DUT lamp opens the DUT controls in a popover, since a page without a
 * course has no other place to connect from. The Instruments lamp opens the
 * Instruments panel. Neither does anything to the hardware on its own.
 */
export function BenchLamps({ compact }: { compact?: boolean }) {
  const { status } = useConnection()
  const nicknames = useNicknames()
  const { instruments } = useInstrumentsState()
  const { setOpen } = useInstrumentsActions()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const dutReady = !!(status?.connected && status?.transport_ready)
  const dutState: CheckState = dutReady ? 'ok' : status?.connected ? 'busy' : 'todo'
  const dutName = status?.address ? nicknames.get(status.address) ?? status?.name ?? status.address : null

  const rig = useMemo(
    () => Object.values(instruments).filter((i) => !i.placeholder),
    [instruments],
  )
  const up = rig.filter((i) => i.status === 'connected').length
  const failed = rig.filter((i) => i.status === 'error')
  // Ticked only with the whole rig up. "Any one connected" used to light this
  // green, which told an operator with one sensor up that the bench was ready.
  const instState: CheckState = failed.length ? 'error' : up === rig.length ? 'ok' : 'todo'

  return (
    <>
      <Tooltip title={dutReady ? `DUT connected${dutName ? `: ${dutName}` : ''}` : 'DUT not connected. Click to connect.'}>
        <Box
          component="button"
          type="button"
          onClick={(e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
          aria-label={dutReady ? 'DUT connected. Open DUT controls.' : 'DUT not connected. Open DUT controls.'}
          sx={lampSx}
        >
          <CheckMark size={18} state={dutState} />
          DUT
          {!compact && (
            <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
              {dutReady ? (dutName ?? 'connected') : status?.connected ? 'connecting' : 'not connected'}
            </Box>
          )}
        </Box>
      </Tooltip>
      <Tooltip
        title={failed.length
          ? `${failed.map((f) => `${f.label}: ${f.failure?.title ?? 'error'}`).join('\n')}\nClick to open Instruments.`
          : 'Click to open Instruments.'}
        slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Instruments: ${up} of ${rig.length} connected${failed.length ? `, ${failed.length} with an error` : ''}. Open Instruments.`}
          sx={lampSx}
        >
          <CheckMark size={18} state={instState} />
          Instruments
          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {up}/{rig.length}
          </Box>
          {failed.length > 0 && !compact && (
            <Box component="span" sx={{ color: 'error.main' }}>
              {failed.length} error
            </Box>
          )}
        </Box>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 2, mt: 1, width: 'min(860px, calc(100vw - 32px))' } } }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5 }}>DUT</Typography>
        <DutControls />
      </Popover>
    </>
  )
}
