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

interface VerdictTallyProps {
  pass: number
  fail: number
  /** Measured points with no tolerance to judge them against. */
  na: number
  /** Points in the table. */
  measured: number
  /** Points planned, while a run is filling the table in. */
  planned?: number
}

/**
 * The run's verdict, above its table: PASS and FAIL counts as the largest
 * text in the panel, then N/A and how much of the plan is in.
 *
 * Without it the only tally was a line in the log, and a long run had to be
 * scrolled to find out whether anything failed. FAIL takes the red frame only
 * when there is at least one; at zero it stays quiet so a clean run does not
 * look alarmed.
 */
export function VerdictTally({ pass, fail, na, measured, planned }: VerdictTallyProps) {
  const box = (tone: 'success' | 'error' | null) => ({
    display: 'inline-flex', alignItems: 'center', gap: 0.5,
    px: 1.25, height: 34, borderRadius: 1, border: 1,
    borderColor: tone ? `${tone}.main` : 'divider',
    color: tone ? `${tone}.main` : 'text.secondary',
    fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  })
  return (
    <Box
      role="status"
      aria-label={`${pass} pass, ${fail} fail, ${na} not judged, ${measured} measured`}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}
    >
      <Box sx={box(pass > 0 ? 'success' : null)}>
        <CheckRoundedIcon sx={{ fontSize: 19 }} />{pass} PASS
      </Box>
      <Box sx={box(fail > 0 ? 'error' : null)}>
        <CloseRoundedIcon sx={{ fontSize: 19 }} />{fail} FAIL
      </Box>
      <Box component="span" sx={{ fontSize: 13, color: 'text.secondary', ml: 0.5 }}>
        {na > 0 && `${na} N/A · `}
        {planned != null && planned > measured
          ? `${measured} of ${planned} measured`
          : `${measured} measured`}
      </Box>
    </Box>
  )
}
