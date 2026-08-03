/**
 * Sweep results graph.
 *
 * Grouped the way the spreadsheet groups them: an "All" view plus one view per
 * rounded *measured* power, highest first, ignoring rows the sensor never
 * measured. Opening the export and opening this should show the same buckets,
 * or the two disagree about what the run found.
 *
 * Within a view the X axis is the test number, so the shape follows the order
 * the sweep actually ran in, and current rides on a second axis — the whole
 * point of a mode sweep is which combination reached a power, and at what cost
 * in current.
 */
import { useMemo, useState } from 'react'
import {
  Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import type { ResultRow } from '../../types/models'
import { MONO } from '../../ui'

/** Matches `UNDER_RANGE_DBM` in backend/sweep/export.py — readings at or below
 *  this are the sensor's under-range sentinel, not a measurement. */
const UNDER_RANGE_DBM = -50

const POWER_COLOR = '#2563EB'
const CURRENT_COLOR = '#D97706'

const ALL = 'all'

interface Bucket {
  key: string
  label: string
  rows: ResultRow[]
}

function buildBuckets(rows: ResultRow[]): Bucket[] {
  const measured = rows.filter(
    (r) => r.tx_power_dbm != null && r.tx_power_dbm >= UNDER_RANGE_DBM,
  )
  const byPower = new Map<number, ResultRow[]>()
  for (const r of measured) {
    const k = Math.round(r.tx_power_dbm as number)
    const list = byPower.get(k)
    if (list) list.push(r)
    else byPower.set(k, [r])
  }
  return [
    { key: ALL, label: 'All', rows },
    ...Array.from(byPower.keys())
      .sort((a, b) => b - a)
      .map((p) => ({ key: String(p), label: `${p} dBm`, rows: byPower.get(p) ?? [] })),
  ]
}

interface Props {
  open: boolean
  onClose: () => void
  rows: ResultRow[]
}

export function SweepResultsModal({ open, onClose, rows }: Props) {
  const [selected, setSelected] = useState<string>(ALL)
  const buckets = useMemo(() => buildBuckets(rows), [rows])
  // A bucket disappears when a new run measures different powers; fall back
  // rather than rendering an empty chart for a group that no longer exists.
  const active = buckets.find((b) => b.key === selected) ?? buckets[0]

  const data = useMemo(() => {
    if (!active) return []
    return [...active.rows]
      .sort((a, b) => a.idx - b.idx)
      .map((r) => ({
        idx: r.idx + 1,
        power: r.tx_power_dbm ?? null,
        current: r.current_a == null ? null : r.current_a * 1000,
        mode: `hp${r.hp_max} duty${r.pa_duty_cycle}`,
        set: r.power_dbm_setting,
      }))
  }, [active])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      transitionDuration={{ enter: 150, exit: 0 }}
      slotProps={{ paper: { sx: { borderRadius: 2, height: 600, maxHeight: '90vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <Stack direction="row" alignItems="baseline" spacing={1.5}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Sweep results</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {rows.length} row{rows.length === 1 ? '' : 's'} · {buckets.length - 1} power
            {buckets.length - 1 === 1 ? '' : 's'} measured
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      {/* One button per measured power, as the workbook has one sheet each. */}
      <Box sx={{ px: 3, pb: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {buckets.map((b) => {
          const on = active?.key === b.key
          return (
            <Button
              key={b.key}
              size="small"
              variant={on ? 'contained' : 'outlined'}
              color={on ? 'primary' : 'inherit'}
              onClick={() => setSelected(b.key)}
              sx={{
                minWidth: 0, height: 26, px: 1.25,
                fontSize: 12, fontFamily: b.key === ALL ? undefined : MONO,
              }}
            >
              {b.label}
              <Box component="span" sx={{ ml: 0.75, opacity: 0.65, fontSize: 11 }}>
                {b.rows.length}
              </Box>
            </Button>
          )
        })}
      </Box>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, pt: 0 }}>
        {data.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', m: 'auto' }}>
            No measured rows yet. Run the sweep first.
          </Typography>
        ) : (
          <Box sx={{ flexGrow: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.18)" />
                <XAxis
                  dataKey="idx"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Test #', position: 'bottom', offset: 4, fontSize: 12 }}
                />
                <YAxis
                  yAxisId="power"
                  tick={{ fontSize: 11 }}
                  width={54}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{ value: 'Measured (dBm)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="current"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  width={54}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  label={{ value: 'Current (mA)', angle: 90, position: 'insideRight', offset: 10, fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v: number | string, name: string) =>
                    typeof v === 'number'
                      ? [name === 'Current' ? v.toFixed(1) : v.toFixed(2), name]
                      : [v, name]}
                  labelFormatter={(idx) => {
                    const row = data.find((d) => d.idx === idx)
                    return row
                      ? `#${idx} · ${row.mode} · set ${row.set} dBm`
                      : `#${idx}`
                  }}
                />
                <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 12 }} />
                <Line
                  yAxisId="power"
                  name="Measured"
                  type="monotone"
                  dataKey="power"
                  stroke={POWER_COLOR}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="current"
                  name="Current"
                  type="monotone"
                  dataKey="current"
                  stroke={CURRENT_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={{ r: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
