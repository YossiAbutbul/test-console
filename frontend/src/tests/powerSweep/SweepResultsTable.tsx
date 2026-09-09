import { memo, useEffect, useRef } from 'react'
import {
  Box, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import type { ResultRow } from '../../types/models'
import { fmt } from '../../lib/format'

/**
 * Columns follow the sweep's configuration — Power, PA DC, HP Max — and mirror
 * the exported workbook, so a row reads the same in both. One exception: the
 * workbook also carries `Raw [dBm]`, the uncorrected sensor reading, which
 * exists so a wrong path loss can be undone after the fact. That is a job for
 * the file, not for a screen showing corrected numbers.
 */
const Row = memo(function Row({ r }: { r: ResultRow }) {
  return (
    <TableRow>
      <TableCell>{r.idx + 1}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.power_dbm_setting}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.pa_duty_cycle}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{r.hp_max}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.tx_power_dbm, 2)}</TableCell>
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>
        {fmt(r.current_a == null ? null : r.current_a * 1000, 1)}
      </TableCell>
      {/* Voltage is supplementary — a point can record current without it — so
          this is the one numeric cell that is routinely blank. */}
      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(r.voltage_v, 2)}</TableCell>
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
    // overflowX hidden, not auto. The vertical scrollbar takes ~15px out of
    // the content box, so a `width: 100%` fixed-layout table overflows by
    // exactly that much and earns a horizontal scrollbar it has no use for --
    // a strip of dead space along the bottom of the panel. The columns are
    // percentage widths on a fixed layout, so there is nothing to scroll to.
    <Box ref={scrollRef} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'hidden' }}>
      <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '7%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            {/* Same two names the workbook uses. "Power (dBm)" next to
                "Measured (dBm)" read as though one of them was not commanded. */}
            <TableCell>Power Set (dBm)</TableCell>
            <TableCell>PA DC</TableCell>
            <TableCell>HP Max</TableCell>
            <TableCell>Measured (dBm)</TableCell>
            <TableCell>CC (mA)</TableCell>
            <TableCell>V (V)</TableCell>
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
