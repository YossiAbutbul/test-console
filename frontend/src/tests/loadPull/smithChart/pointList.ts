import { MONO } from '../../../ui'

/** Point-list rows rendered beyond each edge of the view. */
export const LIST_OVERSCAN = 10
/** Height of one point-list row before the first is measured. */
export const LIST_ROW_H_GUESS = 26

/** Shared by every list row, so they resolve to one class between them. */
export const LIST_ROW_SX = {
  px: 1.25, py: 0.5, cursor: 'default',
  fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
  display: 'grid', columnGap: '6px', alignItems: 'center',
  '&:hover': { bgcolor: 'action.hover' },
  '&[data-on="true"]': { bgcolor: 'action.selected' },
} as const

/** Width of the point list. */
export const LIST_W = 320

/**
 * The point list's columns, shared by its head and every row: #, Pos, Att
 * (with a sweep), Z, Pout, Eff. Fixed widths, the figures right-aligned in
 * tabular digits; only Z takes what is left, and cuts with an ellipsis.
 *
 * They were flex shares sized by their content, so the columns drifted row
 * to row: a three-digit step ran into its position ("13" and "3.9" read as
 * "133.9"), and a long impedance pushed Pout and Eff along.
 */
export const listCols = (hasAtt: boolean) =>
  `40px 42px ${hasAtt ? '22px ' : ''}minmax(0, 1fr) 36px 44px`

/** A list cell: numbers right, one line, cut rather than overflowing. */
const cellSx = (align: 'left' | 'right') => ({
  textAlign: align, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
}) as const
export const NUM_SX = cellSx('right')
export const TXT_SX = cellSx('left')
