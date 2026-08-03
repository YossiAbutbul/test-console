import { memo, useEffect, useRef } from 'react'
import {
  Box, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import type { ResultRow } from '../../types/models'
import { fmt } from '../../lib/format'

/** Columns mirror the exported workbook, so a row reads the same in both. */
const Row = memo(function Row({ r }: { r: ResultRow }) {
  return (
    <TableRow>
      <TableCell>{r.idx + 1}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.hp_max}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.pa_duty_cycle}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.power_dbm_setting}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.tx_power_dbm, 2)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>
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
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Follow the run: the row that just landed is the one worth seeing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [rows.length])

  if (rows.length === 0) {
    return (
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
        No data yet. Set the ranges and press Run sweep.
      </Typography>
    )
  }

  return (
    <Box ref={scrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto' }}>
      <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '18%' }} />
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
