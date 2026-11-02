import { useMemo } from 'react'
import { Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { PathLossPoint } from '../../lib/pathLoss'
import { DASH, fmt } from '../../lib/format'
import { HeadCell, ModalShell, NUM_CELL_SX, TEXT } from '../../ui'

interface Props {
  open: boolean
  /** The table as it is. */
  current: PathLossPoint[]
  /** What the S21 sweep would put there instead. */
  next: PathLossPoint[]
  defaultDb: number
  onCancel: () => void
  onConfirm: () => void
}

type Change = 'same' | 'changed' | 'added' | 'removed'

interface Line {
  freqMhz: number
  now: number | null
  next: number | null
  change: Change
}

/** Frequencies as the table matches them (to the kHz and finer), so 902.3
 *  typed in and 902.3 from the sweep are one row. */
const key = (f: number) => f.toFixed(6)

function compare(current: PathLossPoint[], next: PathLossPoint[]): Line[] {
  const lines = new Map<string, Line>()
  for (const p of current) {
    lines.set(key(p.freqMhz), { freqMhz: p.freqMhz, now: p.db, next: null, change: 'removed' })
  }
  for (const p of next) {
    const had = lines.get(key(p.freqMhz))
    lines.set(key(p.freqMhz), {
      freqMhz: p.freqMhz,
      now: had?.now ?? null,
      next: p.db,
      change: !had ? 'added' : had.now === p.db ? 'same' : 'changed',
    })
  }
  return [...lines.values()].sort((a, b) => a.freqMhz - b.freqMhz)
}

/**
 * Asks before the S21 markers replace a path loss table that has points.
 *
 * It shows both tables side by side, a row per frequency, rather than only
 * counting them: "overwrite the 5 points with 1 marker" did not say which
 * calibrated frequencies were about to go, which is the thing to check before
 * throwing a calibration away.
 */
export function PathLossReplaceDialog({ open, current, next, defaultDb, onCancel, onConfirm }: Props) {
  const lines = useMemo(() => compare(current, next), [current, next])
  const count = (c: Change) => lines.filter((l) => l.change === c).length
  const summary = (
    [['changed', count('changed')], ['added', count('added')], ['removed', count('removed')], ['unchanged', count('same')]] as const
  ).filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`).join(' · ')

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      title="Replace the path loss table?"
      subtitle={summary}
      maxWidth="xs"
      dividers
      footer={{
        secondary: <Button variant="outlined" color="inherit" onClick={onCancel}>Cancel</Button>,
        primary: <Button variant="contained" onClick={onConfirm}>Replace</Button>,
      }}
    >
      {/* Its own scroll, so a long table keeps the keys in view. */}
      <Box sx={{ maxHeight: 320, overflowY: 'auto', mx: -1 }}>
        <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
          <TableHead>
            <TableRow>
              <HeadCell label="Freq" unit="MHz" numeric />
              <HeadCell label="Now" unit="dB" numeric />
              <HeadCell label="New" unit="dB" numeric />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={key(l.freqMhz)}>
                <TableCell
                  sx={{ ...NUM_CELL_SX, color: l.change === 'removed' ? 'text.disabled' : undefined }}
                >
                  {fmt(l.freqMhz, 3)}
                </TableCell>
                <TableCell
                  sx={{
                    ...NUM_CELL_SX,
                    color: l.change === 'removed' ? 'text.disabled' : 'text.secondary',
                    textDecoration: l.change === 'removed' ? 'line-through' : undefined,
                  }}
                >
                  {l.now == null ? DASH : fmt(l.now, 2)}
                </TableCell>
                <TableCell
                  sx={{
                    ...NUM_CELL_SX,
                    fontWeight: l.change === 'same' ? undefined : 700,
                    color: l.change === 'removed' ? 'error.main' : l.change === 'same' ? undefined : 'info.main',
                  }}
                >
                  {l.next == null ? 'removed' : fmt(l.next, 2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary', mt: 1.5 }}>
        Default ({fmt(defaultDb, 2)}{' '}dB) is kept.
      </Typography>
    </ModalShell>
  )
}
