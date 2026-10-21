import { alpha, type Theme } from '@mui/material/styles'
import type { SystemStyleObject } from '@mui/system'

/**
 * What a control does to the bench when pressed.
 *
 * - `tx`: the DUT or the signal generator radiates.
 * - `power`: the DUT or the modem is powered.
 * - `move`: the trombone moves.
 * - `path`: the RF switch changes the path.
 */
export type HazardKind = 'tx' | 'power' | 'move' | 'path'

/**
 * Ring for a hazard key: a 2 px red outline around the whole control, drawn
 * inside it so the button keeps its size. Only while enabled -- a disabled
 * key cannot do anything to the bench, and a red ring on it would say it can.
 *
 * Send, Run, Graph and Export used to share one look, as did Jog and
 * Recapture; this is the one thing that now sets the keys that act on
 * hardware apart, together with the glyph naming what they do.
 */
export function hazardRingSx(kind: HazardKind | null | undefined) {
  // A theme callback, for use as one entry of an `sx` array.
  return (t: Theme): SystemStyleObject<Theme> => (kind
    ? { '&:not(.Mui-disabled)': { boxShadow: `inset 0 0 0 2px ${alpha(t.palette.error.main, 0.9)}` } }
    : {})
}
