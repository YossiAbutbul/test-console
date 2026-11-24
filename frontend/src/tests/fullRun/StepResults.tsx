/**
 * One step's measured points, read-only: what its last run found, and while
 * it runs, what it has found so far.
 *
 * Open during a run without touching it -- a look, not an action -- so a
 * failure can be understood while the rest of the sequence carries on. It
 * opens on the points that went wrong, each with why, since that is what
 * the operator came to see; All shows the rest.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { SegmentedChoice, TEXT, VerdictMark } from '../../ui'
import type { JudgedRow } from '../engine/sweepTest'
import type { AnySweepTest } from '../engine/sweepTest'

interface Props {
  test: AnySweepTest
  rows: JudgedRow[]
  /** The step is the one in flight: its table is still filling. */
  live: boolean
}

type Show = 'problems' | 'all'

/** Rows in view before the table scrolls. */
const ROWS_IN_VIEW = 4

const isProblem = (r: JudgedRow) => r.verdict === 'fail' || !!r.error

/** A row's height in the table. */
const ROW_PX = 32
const HEAD_SX = { fontSize: 11.5, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.01em' } as const
const CELL_SX = { fontSize: 12.5, fontVariantNumeric: 'tabular-nums' } as const
/** Both tables: fixed layout on shared widths, no grid lines. */
const TABLE_SX = {
  tableLayout: 'fixed',
  '& td, & th': { borderBottom: 0, py: 0, height: ROW_PX, px: 1.25, whiteSpace: 'nowrap' },
} as const

type Cell = string | number | boolean | null | undefined

interface Col {
  key: string
  name: string
  unit?: string
  numeric: boolean
  render: (cells: Cell[], row: JudgedRow) => ReactNode
  /** The cell as text, for sizing its column. */
  text: (cells: Cell[], row: JudgedRow) => string
}

const dash = (v: Cell) => (v == null || v === '' ? '—' : String(v))

/** "Freq [MHz]" → name and unit. */
function splitHead(h: string): { name: string; unit?: string } {
  const m = /^(.*?)\s*\[(.+)\]$/.exec(h)
  return m ? { name: m[1], unit: m[2] } : { name: h }
}

/**
 * The columns worth reading here, from a test's export columns: where it
 * measured, what it asked for, what it got, the current, and the verdict. A setting that is the same for every point (PA mode, BW,
 * MCS...) adds nothing and is left out; one that varies is kept, since it is
 * what tells two rows apart. Raw power, path loss, voltage and the limits
 * stay in the report.
 */
function columnsOf(header: readonly string[], body: Cell[][]): Col[] {
  const at = (h: string) => header.indexOf(h)
  const cols: Col[] = []
  const plain = (h: string, key = h, numeric = true) => {
    const i = at(h)
    if (i < 0) return
    cols.push({ key, ...splitHead(h), numeric, render: (c) => dash(c[i]), text: (c) => dash(c[i]) })
  }
  const varies = (h: string) => {
    const i = at(h)
    return i >= 0 && new Set(body.map((r) => String(r[i] ?? ''))).size > 1
  }
  plain('Channel'); plain('EARFCN')
  plain('Freq [MHz]'); plain('Frequency [MHz]', 'freq')
  plain('Set [dBm]', 'set'); plain('Power param', 'set'); plain('Power [dBm]', 'set')
  for (const h of ['Band', 'PA mode', 'Modem', 'BW', 'Datarate', 'MCS', 'RBs']) {
    if (varies(h)) plain(h, h, h !== 'PA mode' && h !== 'Modem' && h !== 'BW')
  }
  plain('Measured [dBm]', 'measured')
  // Frequency accuracy: what the zoom found, and how far off.
  plain('Error [Hz]'); plain('Error [ppm]')
  plain('CC [mA]')
  const st = at('Status') >= 0 ? at('Status') : at('Note')
  if (st >= 0) {
    const text = (c: Cell[], r: JudgedRow) => r.error ?? dash(c[st])
    cols.push({ key: 'status', name: 'Status', numeric: false, render: text, text })
  }
  // The verdict last, at the right edge: its mark is where the eye ends
  // each row, and the column of marks reads down the table at a glance.
  if (at('Verdict') >= 0) {
    cols.push({
      key: 'verdict', name: 'Verdict', numeric: true,
      render: (_c, r) => <VerdictMark verdict={r.verdict} />, text: () => 'FAIL',
    })
  }
  return cols
}

export function StepResults({ test, rows, live }: Props) {
  const problems = rows.filter(isProblem).length
  const [show, setShow] = useState<Show>(problems > 0 ? 'problems' : 'all')
  const { header, body } = test.csv(rows)
  const cols = columnsOf(header, body)
  const shown = body
    .map((cells, i) => ({ cells, row: rows[i], i }))
    .filter((x) => show === 'all' || isProblem(x.row))
  const fails = rows.filter((r) => r.verdict === 'fail').length

  // Four rows in view, measured rather than assumed: a row's height follows
  // its font and padding, and the sideways scrollbar, when there is one,
  // takes room too. Set on the element, after layout, so nothing re-renders.
  const headRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const bodyRows = [...box.querySelectorAll('tbody tr')].slice(0, ROWS_IN_VIEW)
    const rowsH = bodyRows.reduce((a, r) => a + r.getBoundingClientRect().height, 0)
    const chrome = box.offsetHeight - box.clientHeight // the sideways scrollbar, if any
    box.style.maxHeight = `${Math.ceil(rowsH + chrome)}px`
  })

  // Each column as wide as its widest value across every point -- not just
  // the ones shown -- so switching Problems / All moves nothing.
  const widths = cols.map((c) => {
    if (c.key === 'verdict') return 76
    const longest = Math.max(
      c.name.length + (c.unit ? c.unit.length + 1 : 0),
      ...body.map((cells, i) => String(c.text(cells, rows[i])).length),
    )
    const ch = c.key === 'status' ? Math.min(longest, 32) : longest
    return `calc(${ch}ch + 22px)`
  })
  const tableW = `calc(${[36, ...widths].map((w) => (typeof w === 'number' ? `${w}px` : w)).join(' + ')})`
  const colgroup = (
    <colgroup>
      <col style={{ width: 36 }} />
      {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
    </colgroup>
  )
  const errors = rows.filter((r) => !!r.error).length

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Typography sx={{ ...TEXT.label, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {rows.length === 0
            ? (live ? 'Waiting for the first point…' : 'No points measured')
            : `${rows.length} point${rows.length === 1 ? '' : 's'}${live ? ' so far' : ''}`
              + (fails ? ` · ${fails} failed` : '')
              + (errors ? ` · ${errors} could not be measured` : '')
              + (!fails && !errors ? ' · nothing went wrong' : '')}
        </Typography>
        <SegmentedChoice
          value={show}
          options={[
            { value: 'problems', label: `Problems${problems ? ` (${problems})` : ''}` },
            { value: 'all', label: 'All' },
          ]}
          onChange={setShow}
        />
      </Stack>

      {/* The heading stays put and only the points scroll under it, up to
          four in view. Two tables on one set of widths; a sideways scroll
          of the points carries the heading with it. Each keeps the
          scrollbar's lane, so their columns line up. */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '10px', bgcolor: 'background.paper', overflow: 'hidden' }}>
        <Box ref={headRef} sx={{ overflow: 'hidden', scrollbarGutter: 'stable', boxShadow: (t) => `inset 0 -1px 0 ${t.palette.divider}` }}>
          <Table size="small" sx={{ ...TABLE_SX, width: tableW, minWidth: '100%' }}>
            {colgroup}
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...HEAD_SX, textAlign: 'right' }}>#</TableCell>
                {cols.map((c) => (
                  <TableCell key={c.key} sx={{ ...HEAD_SX, textAlign: c.numeric ? 'right' : 'left' }}>
                    {c.name}
                    {c.unit && <Box component="span" sx={{ ml: 0.5, fontWeight: 400, color: 'text.disabled' }}>{c.unit}</Box>}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
          </Table>
        </Box>
        <Box
          ref={boxRef}
          onScroll={(e) => { if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft }}
          sx={{ overflow: 'auto', scrollbarGutter: 'stable' }}
        >
          <Table size="small" sx={{ ...TABLE_SX, width: tableW, minWidth: '100%', '& tbody tr:nth-of-type(even)': { bgcolor: 'action.hover' } }}>
            {colgroup}
            <TableBody>
              {shown.map(({ cells, row, i }) => {
                const bad = isProblem(row)
                return (
                  <TableRow key={i} sx={bad ? { bgcolor: (t) => `${alpha(t.palette.error.main, 0.07)} !important` } : undefined}>
                    <TableCell sx={{ ...CELL_SX, textAlign: 'right', color: 'text.secondary' }}>{i + 1}</TableCell>
                    {cols.map((c) => (
                      <TableCell
                        key={c.key}
                        sx={{
                          ...CELL_SX,
                          textAlign: c.numeric ? 'right' : 'left',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          ...(c.key === 'measured' && row.verdict === 'fail' ? { color: 'error.main', fontWeight: 600 } : null),
                          ...(c.key === 'status' && row.error ? { color: 'error.main' } : null),
                        }}
                        title={c.key === 'status' && row.error ? row.error : undefined}
                      >
                        {c.render(cells, row)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
              {shown.length === 0 && rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={cols.length + 1} sx={{ ...CELL_SX, color: 'text.secondary', textAlign: 'center', height: 48 }}>
                    No failed or errored points{live ? ' so far' : ''}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </Stack>
  )
}
