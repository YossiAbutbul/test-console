import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { fmt } from '../../lib/format'
import { HeadCell, NUM_CELL_SX, RESULTS_H, FollowLatest, useFollowBottom } from '../../ui'
import type { PathLossAt } from '../../lib/pathLoss'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { vswrLabel } from './smith'
import { SENSOR_MAX_DBM, SENSOR_MIN_DBM, confidenceColor, powerConfidence } from './powerConfidence'

/** Columns in the table, for the spacer rows' colSpan. */
const COLS = 12
/** Height of one row before the first one is measured. */
const ROW_H_GUESS = 33
/** Rows rendered beyond each edge of the view, so a fast scroll does not
 *  show blank space before the next render lands. */
const OVERSCAN = 12

interface Props {
  results: LoadPullResultRow[]
  lossAt: (freqMhz: number | null | undefined) => PathLossAt
  /** Colour raw readings outside the power sensor's range. Off when the
   *  spectrum analyzer read power. */
  judgeSensorRange?: boolean
}

/**
 * The Load Pull results table, rendering only the rows in view.
 *
 * Its own memoised component, and windowed, because of a crash: an attenuator
 * sweep across five channels runs to thousands of points, and the table lived
 * in the page body, so every render of the page -- each point, the ETA tick
 * every 500 ms, the motor poll -- rebuilt every row. At 5000 rows that was
 * ~1.9 s and ~100 MB a render; the page froze mid-run and Chrome killed it
 * ("Aw, Snap!"), taking the run with it. Memoised, it re-renders only when the
 * rows change; windowed, that costs the same at row 10 000 as at row 10.
 */
export const LoadPullResultsTable = memo(function LoadPullResultsTable({ results, lossAt, judgeSensorRange = true }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const firstRowRef = useRef<HTMLTableRowElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [rowH, setRowH] = useState(ROW_H_GUESS)

  // Measured off a real row rather than assumed, so the spacers match the
  // theme's density whatever it is.
  useLayoutEffect(() => {
    const h = firstRowRef.current?.getBoundingClientRect().height
    if (h && Math.abs(h - rowH) > 0.5) setRowH(h)
  }, [rowH, results.length])

  // Follow the newest row, unless the operator has scrolled up to read one.
  const follow = useFollowBottom(scrollRef, results.length)

  const visible = Math.ceil(RESULTS_H / rowH)
  const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN)
  const last = Math.min(results.length, first + visible + OVERSCAN * 2)
  const above = first * rowH
  const below = (results.length - last) * rowH

  return (
    // One height, whatever is in it. `maxHeight` let the panel grow with
    // the first rows and collapse again on Clear, so everything below —
    // and the page's scroll position — moved on its own.
    //
    // No "no data yet" line: the table itself, header and an empty
    // body, so the panel looks the same before the first row as after.
    <Box
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      sx={{
        height: RESULTS_H,
        // `scroll`, not `auto`: a scrollbar that appears with the ninth
        // row would resize the columns under the cursor.
        overflowY: 'scroll',
        // Only below this does the table stop being readable; above it
        // the percentages below make every column fit with no sideways
        // scroll at all.
        overflowX: 'auto',
      }}
    >
      <Table
        size="small"
        stickyHeader
        sx={{ tableLayout: 'fixed', width: '100%', minWidth: 780 }}
      >
        {/* One <col> per column — there were eight for ten columns after
            Freq and Set were added, and under `table-layout: fixed` the
            two with no width ran off the right-hand edge. */}
        <colgroup>
          {/* Set and Att wide enough for "Set [dBm]", "Att [dB]" and
              "Power [dBm]" whole;
              the room comes from Status, which holds "ok". */}
          <col style={{ width: 40 }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <HeadCell label="#" numeric />
            <HeadCell label="Pos" unit="mm" numeric />
            {/* A row is only identified by position, frequency and
                power together now that a run sweeps all three. */}
            <HeadCell label="Freq" unit="MHz" numeric />
            <HeadCell label="Set" unit="dBm" numeric />
            <HeadCell label="Att" unit="dB" numeric />
            <HeadCell label="Power" unit="dBm" numeric />
            <HeadCell label="CC" unit="mA" numeric />
            <HeadCell label="R" unit="Ω" numeric />
            <HeadCell label="X" unit="Ω" numeric />
            <HeadCell label="S11" unit="dB" numeric />
            <HeadCell label="VSWR" numeric />
            <HeadCell label="Status" />
          </TableRow>
        </TableHead>
        <TableBody>
          {/* Stand-ins for the rows out of view, so the scrollbar and the
              scroll position are those of the whole table. */}
          {above > 0 && <tr aria-hidden style={{ height: above }}><td colSpan={COLS} /></tr>}
          {results.slice(first, last).map((r, j) => {
            const i = first + j
            // Judged on the raw reading. Older rows have none, so the
            // correction is undone with the loss for that row's own
            // frequency -- exact for anything this app measured, and
            // the best available for a file imported from elsewhere.
            const raw = r.power_dbm_raw
              ?? (r.power_dbm == null ? null : r.power_dbm - lossAt(r.freq_mhz).db)
            // The sensor's range says nothing about an analyzer reading.
            const confidence = judgeSensorRange ? powerConfidence(raw) : 'ok'
            return (
              <TableRow key={i} ref={j === 0 ? firstRowRef : undefined}>
                <TableCell sx={NUM_CELL_SX}>{i + 1}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.pos_mm, 2)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.freq_mhz ?? null, 2)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.power_dbm_setting ?? null, 0)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.att_db ?? null, 0)}</TableCell>
                <TableCell
                  // Says why it is red: the corrected figure in the cell can
                  // look perfectly ordinary while the sensor was out of range.
                  title={confidence === 'poor' && raw != null
                    ? `Sensor read ${raw.toFixed(2)} dBm, outside its ${SENSOR_MIN_DBM} to +${SENSOR_MAX_DBM} dBm range`
                    : undefined}
                  sx={{
                    ...NUM_CELL_SX,
                    color: confidenceColor(confidence),
                    fontWeight: confidence === 'ok' ? undefined : 600,
                  }}
                >
                  {fmt(r.power_dbm, 2)}
                </TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.r_ohm, 2)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.x_ohm, 2)}</TableCell>
                <TableCell sx={NUM_CELL_SX}>{fmt(r.s11_db, 2)}</TableCell>
                {/* Derived from the point's own S11, not stored on it, so
                    an imported file shows one whether or not it was
                    exported with the column. */}
                <TableCell sx={NUM_CELL_SX}>{vswrLabel(r)}</TableCell>
                {/* The numeric cells' type and baseline, left-aligned,
                    so "ok" sits on the same line as the figures beside
                    it. One line like them: a long error is cut with an
                    ellipsis and given in full on hover. */}
                <TableCell
                  title={r.error ?? undefined}
                  sx={{
                    ...NUM_CELL_SX, textAlign: 'left', verticalAlign: 'middle',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {r.error
                    ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
                    : <Box component="span" sx={{ color: 'text.secondary' }}>ok</Box>}
                </TableCell>
              </TableRow>
            )
          })}
          {below > 0 && <tr aria-hidden style={{ height: below }}><td colSpan={COLS} /></tr>}
        </TableBody>
      </Table>
      <FollowLatest follow={follow} />
    </Box>
  )
})
