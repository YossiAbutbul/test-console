import { Box, TableCell, type TableCellProps } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'

interface HeadCellProps extends Omit<TableCellProps, 'children'> {
  label: string
  /** Unit, on a quieter line of its own: "MHz", "dBm". */
  unit?: string
  /** Numeric columns align right, over their numbers. */
  numeric?: boolean
}

/**
 * Column heading with its unit underneath rather than in brackets.
 *
 * "Freq (MHz)" in a narrow fixed column wrapped onto two lines at the
 * bracket, so the header row changed height with the window. Putting the
 * unit on its own line makes the two lines deliberate and the same in every
 * column, and the label never has to share a line with it.
 */
export function HeadCell({ label, unit, numeric, sx, ...rest }: HeadCellProps) {
  return (
    <TableCell
      {...rest}
      sx={[
        { textAlign: numeric ? 'right' : 'left', verticalAlign: 'bottom', whiteSpace: 'nowrap' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box component="span" sx={{ display: 'block', fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>
        {label}
      </Box>
      <Box
        component="span"
        sx={{ display: 'block', fontSize: 12, fontWeight: 400, lineHeight: 1.25, minHeight: '1.25em', opacity: 0.85 }}
      >
        {unit ?? ''}
      </Box>
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
