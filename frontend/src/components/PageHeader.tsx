import { Stack, Typography, Box } from '@mui/material'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { usePageActive, useToolbarSlot } from '../ui/toolbarSlot'
import { TEXT } from '../ui/tokens'

interface Props {
  protocol?: string
  group?: string
  label: string
  actions?: ReactNode
}

/**
 * The page's title and header keys, drawn into the window toolbar.
 *
 * The title is the toolbar's, as in a macOS window: one line. It used to be a
 * 26 px heading in the page with the keys beside it, which spent a 60 px band
 * of every page on a name the sidebar already highlights. In the toolbar the
 * keys stay put whatever the page scrolls to -- and, in their own slot,
 * whatever the live-output pills beside them do (see ToolbarSlots).
 *
 * The protocol leads the page name on the same line, "LoRa CW", in the same
 * ink and weight -- the operator read it as one name, and a grey "LoRa" as
 * less important than it is. It was a caption under the title; the operator
 * found the two-line stack fussy. Rig pages have no protocol and
 * show the page name alone -- "Components DC Analyzer" would read as one name.
 */
export function PageHeader({ protocol, group, label, actions }: Props) {
  const slots = useToolbarSlot()
  const active = usePageActive()
  if (!active) return null
  const prefix = group === 'Components' ? undefined : protocol
  return (
    <>
      {slots.title && createPortal(
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" noWrap sx={{ ...TEXT.title, color: 'text.primary' }}>
            {prefix && (
              <>{prefix}{' '}</>
            )}
            {label}
          </Typography>
        </Box>,
        slots.title,
      )}
      {actions && slots.actions && createPortal(
        // Header keys are fixed-width, so a state change never moves them.
        <Stack direction="row" alignItems="center">{actions}</Stack>,
        slots.actions,
      )}
    </>
  )
}
