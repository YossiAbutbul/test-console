import { Box, ButtonBase, TableCell, type TableCellProps } from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { focusRingOf, PRESS_SX } from './feel'
import { CONTROL_H } from './tokens'

interface HeadCellProps extends Omit<TableCellProps, 'children'> {
  label: string
  /** Unit, quieter, in brackets after the label: "MHz" -> "[MHz]". */
  unit?: string
  /** Kept for call sites; every column is left-aligned now (see NUM_CELL_SX). */
  numeric?: boolean
}

/**
 * Column heading with its unit beside it, quieter, rather than in brackets.
 *
 * "Freq (MHz)" in a narrow fixed column wrapped onto two lines at the
 * bracket, so the header row changed height with the window. The unit then
 * went on a line of its own, which held the height but made every table's
 * header two rows tall; the operator wanted one. One line, never wrapping:
 * the label and its unit keep together, and the header row is one text line
 * high in every table.
 */
export function HeadCell({ label, unit, numeric, sx, ...rest }: HeadCellProps) {
  void numeric
  return (
    <TableCell
      {...rest}
      sx={[
        { textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box component="span" sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>
        {label}
      </Box>
      {unit && (
        // In square brackets, the engineering convention for a unit in a
        // column heading ("Freq [MHz]"): it reads as the label's unit, not a
        // second word of the label.
        <Box component="span" sx={{ ml: 0.5, fontSize: 12, fontWeight: 400, lineHeight: 1.25, opacity: 0.85 }}>
          [{unit}]
        </Box>
      )}
    </TableCell>
  )
}

/**
 * PASS / FAIL / N/A as a mark plus a word, at the size of the numbers beside
 * it.
 *
 * It was a 10 px tinted chip: the smallest text in a table whose whole point
 * is this column. The glyph means the verdict survives without its colour.
 */
export function VerdictMark({ verdict }: { verdict: 'pass' | 'fail' | null | undefined }) {
  if (verdict == null) {
    // Not "—": the point was measured, it just had nothing to be judged
    // against, and a dash reads as a missing reading.
    return <Box component="span" sx={{ color: 'text.secondary', fontSize: 12.5 }}>N/A</Box>
  }
  const pass = verdict === 'pass'
  const Icon = pass ? CheckRoundedIcon : CloseRoundedIcon
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.4,
        fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4,
        color: pass ? 'success.main' : 'error.main',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon sx={{ fontSize: 16 }} />
      {pass ? 'PASS' : 'FAIL'}
    </Box>
  )
}

/** Which rows the results table shows. */
export type VerdictFilter = 'all' | 'pass' | 'fail'

interface VerdictTallyProps {
  pass: number
  fail: number
  /** Measured points with no tolerance to judge them against. */
  na: number
  /** Points in the table. */
  measured: number
  /** Points planned, while a run is filling the table in. */
  planned?: number
  /** The table's current filter. With `onFilter`, the counts are filter keys. */
  filter?: VerdictFilter
  onFilter?: (next: VerdictFilter) => void
}

/**
 * The run's verdict, above its table, and the table's filter: PASS and FAIL
 * counts as filter keys, then N/A and how much of the plan is in.
 *
 * Without it the only tally was a line in the log, and a long run had to be
 * scrolled to find out whether anything failed. Pressing "7 fail" now shows
 * just those seven rows; pressing it again shows them all. A key with a zero
 * count is disabled -- filtering to an empty table answers nothing -- and FAIL
 * takes its red only when there is at least one, so a clean run does not look
 * alarmed.
 *
 * Each key holds three digits at a fixed width, so the count climbing during
 * a run never pushes the line along, and choosing one changes its fill, not
 * its size.
 */
export function VerdictTally({
  pass, fail, na, measured, planned, filter = 'all', onFilter,
}: VerdictTallyProps) {
  const key = (kind: 'pass' | 'fail', count: number, label: string, Icon: typeof CheckRoundedIcon) => {
    const tone = kind === 'pass' ? 'success' : 'error'
    const active = filter === kind
    const lit = count > 0
    return (
      <ButtonBase
        disableRipple
        disabled={!onFilter || count === 0}
        aria-pressed={active}
        aria-label={`${count} ${label}${onFilter ? (active ? ', showing only these. Show all' : '. Show only these') : ''}`}
        onClick={() => onFilter?.(active ? 'all' : kind)}
        sx={(t: Theme) => ({
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
          minWidth: 104, px: 1.25, height: CONTROL_H.sm, borderRadius: '7px',
          // Chosen: the solid tone with white ink. Not chosen: the tint, as
          // before. While another key is chosen this one steps back a little.
          bgcolor: active
            ? t.palette[tone].main
            : lit ? alpha(t.palette[tone].main, 0.14) : alpha(t.palette.text.secondary, 0.1),
          color: active ? '#FFFFFF' : lit ? `${tone}.main` : 'text.secondary',
          opacity: filter !== 'all' && !active ? 0.6 : 1,
          fontSize: 14, fontWeight: 650, whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          transition: 'background-color .15s ease, color .15s ease, opacity .15s ease, transform 120ms',
          ...PRESS_SX,
          '&:hover': onFilter && count > 0 && !active ? { bgcolor: alpha(t.palette[tone].main, 0.22) } : {},
          '&.Mui-focusVisible': { boxShadow: focusRingOf(t) },
          // A disabled key keeps the look of its count (a quiet zero), not a
          // greyed-out control: the number is still information.
          '&.Mui-disabled': { color: lit ? `${tone}.main` : 'text.secondary' },
        })}
      >
        <Icon sx={{ fontSize: 17 }} />{count} {label}
      </ButtonBase>
    )
  }
  const shown = filter === 'pass' ? pass : filter === 'fail' ? fail : null
  return (
    <Box
      role="group"
      aria-label={`${pass} pass, ${fail} fail, ${na} not judged, ${measured} measured`}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}
    >
      {key('pass', pass, 'pass', CheckRoundedIcon)}
      {key('fail', fail, 'fail', CloseRoundedIcon)}
      <Box component="span" sx={{ fontSize: 13, color: 'text.secondary', ml: 0.5 }}>
        {shown != null && `showing ${shown} of ${measured} · `}
        {na > 0 && `${na} N/A · `}
        {planned != null && planned > measured
          ? `${measured} of ${planned} measured`
          : `${measured} measured`}
      </Box>
    </Box>
  )
}
