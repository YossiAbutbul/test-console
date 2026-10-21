import { useMemo } from 'react'
import { Box, Tooltip } from '@mui/material'
import { useInstrumentsActions, useInstrumentsState } from '../context/InstrumentsContext'
import { useInstrumentsUnavailableReason } from '../context/CapabilitiesContext'
import { CheckMark, type CheckState } from '../ui'

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
  overflow: 'hidden',
  // Each lamp keeps one width whatever it says (see the widths below): the
  // text changes on connect, the bar must not move.
  justifyContent: 'flex-start',
  '&:hover': { borderColor: 'text.secondary' },
  '&:focus-visible': { outline: 2, outlineColor: 'text.primary', outlineOffset: 1 },
} as const

/**
 * Instrument state in the top bar, on every page: a mark plus "Instruments
 * n/7", never a bare dot. Opens the Instruments panel; does nothing to the
 * hardware on its own. (The DUT has no lamp: its connection controls sit in
 * the top bar themselves.)
 */
export function BenchLamps({ compact }: { compact?: boolean }) {
  const { instruments } = useInstrumentsState()
  const { setOpen } = useInstrumentsActions()
  // Non-null on the DUT-only build, which has no instrument support at all.
  const noInstruments = useInstrumentsUnavailableReason()

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
      <Tooltip
        title={failed.length
          ? `${failed.map((f) => `${f.label}: ${f.failure?.title ?? 'error'}`).join('\n')}\nClick to open Instruments.`
          : 'Click to open Instruments.'}
        slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => { if (!noInstruments) setOpen(true) }}
          aria-disabled={noInstruments ? true : undefined}
          aria-label={`Instruments: ${up} of ${rig.length} connected${failed.length ? `, ${failed.length} with an error` : ''}. Open Instruments.`}
          sx={{ ...lampSx, width: compact ? 132 : 168 }}
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
  )
}
