import type { ReactNode } from 'react'
import { Box, IconButton, Stack, TextField, Tooltip, Typography, type TextFieldProps } from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import { CONTROL_H } from '../../ui'

/*
 * The pieces of the Sweep table the power, CW and modulated pages share --
 * headings once above the rows, numbered rows, a readout and a remove key at
 * the end, a hint line under a rule -- so both tables on this page read as
 * that one.
 */

/** Column heading: name, then a quieter unit beside it. */
export function ColHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <Typography component="span" sx={{
      fontSize: 13, fontWeight: 500, color: 'text.primary',
      display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {label}
      {hint && <Box component="span" sx={{ ml: 0.5, fontSize: 12, fontWeight: 400, color: 'text.secondary' }}>{hint}</Box>}
    </Typography>
  )
}

const ROW_GAP = 6

/** The heading row and the rows under it, on one column template. With
 *  `maxRows`, the rows past that many scroll under the fixed heading. */
export function PlanGrid({ cols, minWidth, heads, children, maxRows }: {
  cols: string
  minWidth: number
  heads: ReactNode
  children: ReactNode
  maxRows?: number
}) {
  // Both the heading and the rows reserve the scrollbar's gutter, scrolling
  // or not: the fields keep their width when a fourth row brings the bar in,
  // and stay under their headings.
  // overflowX is set too: overflowY alone makes overflowX compute to auto,
  // and the heading and the rows each drew a sideways bar of their own.
  const gutter = maxRows ? { scrollbarGutter: 'stable', overflowY: 'hidden', overflowX: 'hidden' } : {}
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, alignItems: 'end', mb: 0.75, ...gutter }}>
          {heads}
        </Box>
        <Stack spacing={`${ROW_GAP}px`} sx={maxRows ? {
          ...gutter, overflowY: 'auto',
          maxHeight: maxRows * CONTROL_H.md + (maxRows - 1) * ROW_GAP,
        } : undefined}>
          {children}
        </Stack>
      </Box>
    </Box>
  )
}

export function PlanRow({ cols, n, children, readout, onRemove, removeDisabled, removeLabel = 'Remove row' }: {
  cols: string
  n: number
  children: ReactNode
  readout?: ReactNode
  onRemove: () => void
  removeDisabled?: boolean
  removeLabel?: string
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, alignItems: 'center', flexShrink: 0 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right' }}>{n}.</Typography>
      {children}
      {/* A column of its own only for tables that have one. */}
      {readout !== undefined && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {readout}
        </Typography>
      )}
      {/* Pinned to the right edge on the card's fill, so a narrow panel that
          scrolls the row sideways keeps the key that removes it in reach. */}
      <Box sx={{ display: 'flex', position: 'sticky', right: 0, zIndex: 1, bgcolor: 'background.paper' }}>
        <Tooltip title={removeLabel}>
          <span>
            <IconButton size="small" aria-label={`${removeLabel} ${n}`} onClick={onRemove} disabled={removeDisabled}>
              <DeleteIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}

/** A row's text field, at the table's control height. */
export function CellField(props: TextFieldProps) {
  return <TextField size="small" {...props} sx={{ minWidth: 0, '& .MuiInputBase-root': { height: CONTROL_H.md }, ...props.sx }} />
}

/** A small labelled number in a section heading, as Sweep's "Settle ___ ms". */
export function HeadField({ label, unit, width = 84, ...props }: TextFieldProps & { label: string; unit: string; width?: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{label}</Typography>
      <TextField size="small" {...props}
        sx={{ width, '& .MuiInputBase-root': { height: CONTROL_H.sm } }} />
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{unit}</Typography>
    </Stack>
  )
}

/** The hint line under a rule, with what sits at its right. */
export function PlanFooter({ hint, children }: { hint: ReactNode; children?: ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}
      sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {hint}
      </Typography>
      {children}
    </Stack>
  )
}
