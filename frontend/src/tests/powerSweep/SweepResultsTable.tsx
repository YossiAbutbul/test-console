import { memo } from 'react'
import {
  Box, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import type { ResultRow } from '../../types/models'
import { MONO } from '../../ui'
import { fmt } from '../../lib/format'

const numSx = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' } as const

/** Columns mirror the exported workbook, so a row reads the same in both. */
const Row = memo(function Row({ r }: { r: ResultRow }) {
  return (
    <TableRow hover>
      <TableCell sx={numSx}>{r.idx + 1}</TableCell>
      <TableCell sx={numSx}>{r.hp_max}</TableCell>
      <TableCell sx={numSx}>{r.pa_duty_cycle}</TableCell>
      <TableCell sx={numSx}>{r.power_dbm_setting}</TableCell>
      <TableCell sx={numSx}>{fmt(r.tx_power_dbm, 2)}</TableCell>
      <TableCell sx={numSx}>
        {fmt(r.current_a == null ? null : r.current_a * 1000, 1)}
      </TableCell>
      <TableCell sx={{ fontSize: 11 }}>
        {r.error
          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
          : r.ok
            ? <Box component="span" sx={{ color: 'success.main' }}>ok</Box>
            : '—'}
      </TableCell>
    </TableRow>
  )
})

export function SweepResultsTable({ rows }: { rows: ResultRow[] }) {
  if (rows.length === 0) {
    return (
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        No rows yet. Set the ranges and press Run sweep.
      </Typography>
    )
  }
  return (
    // A fixed ceiling rather than "fill the rest": the panel sits in normal
    // page flow, and a table told to grow inside a container that does not
    // itself have a height just collapses to one row.
    <Box sx={{ maxHeight: 380, overflowY: 'auto', overflowX: 'auto' }}>
      <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '22%' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>HP Max</TableCell>
            <TableCell>PA DC</TableCell>
            <TableCell>Set (dBm)</TableCell>
            <TableCell>Measured (dBm)</TableCell>
            <TableCell>CC (mA)</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => <Row key={r.idx} r={r} />)}
        </TableBody>
      </Table>
    </Box>
  )
}
