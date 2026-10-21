import type { Theme } from '@mui/material/styles'
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
 * The hazard ring, retired.
 *
 * A red outline marked every key that acts on the bench: first 2 px, then a
 * 1 px half-strength inset after the operator found it too loud, then an
 * outline outside the blue fill once the inset proved invisible there. Drawn
 * visibly on Run and Send it read as an error or focus state rather than "this
 * key touches hardware", and the operator asked for it gone. The glyph each
 * hazard key carries (HazardGlyph: radiating, power, move, path) now says it
 * alone; E-Stop keeps its red, as a tinted key.
 *
 * Kept as a no-op rather than deleted so the call sites keep naming which
 * keys are hazards -- the place to hang a future cue if one is ever wanted.
 */
export function hazardRingSx(kind: HazardKind | null | undefined) {
  // A theme callback, for use as one entry of an `sx` array.
  void kind
  return (): SystemStyleObject<Theme> => ({})
}
