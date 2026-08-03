import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import type { ResultRow } from '../../types/models'

const PALETTE = [
  '#2563EB', '#DC2626', '#16A34A', '#D97706',
  '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
]

/** Beyond this many curves the legend is longer than the chart is tall. */
const MAX_SERIES = 8

interface Point {
  x: number
  [series: string]: number | null
}

/**
 * Measured power against the power that was asked for, one curve per mode.
 *
 * The sweep varies three things at once, so a single line would fold three
 * dimensions onto one axis and show nothing. Set power goes on X because that
 * is the axis with a expected answer — an ideal PA plots as y = x, so a curve
 * flattening at the top *is* the compression the sweep exists to find, visible
 * without reading a single row.
 */
function buildSeries(rows: ResultRow[], metric: 'power' | 'current') {
  const pick = (r: ResultRow) =>
    metric === 'power'
      ? r.tx_power_dbm ?? null
      : r.current_a == null ? null : r.current_a * 1000

  const modeKey = (r: ResultRow) => `hp${r.hp_max} duty${r.pa_duty_cycle}`
  const xs = Array.from(new Set(rows.map((r) => r.power_dbm_setting))).sort((a, b) => a - b)
  const modes = Array.from(new Set(rows.map(modeKey)))

  // Keep the first modes seen rather than an arbitrary slice: the sweep walks
  // them in order, so these are the ones with the most complete curves.
  const series = modes.slice(0, MAX_SERIES)
  const shown = new Set(series)

  const byKey = new Map<string, number | null>()
  for (const r of rows) {
    if (!shown.has(modeKey(r))) continue
    byKey.set(`${r.power_dbm_setting}|${modeKey(r)}`, pick(r))
  }

  const data: Point[] = xs.map((x) => {
    const row: Point = { x }
    for (const m of series) row[m] = byKey.get(`${x}|${m}`) ?? null
    return row
  })

  return { series, data, hiddenCount: modes.length - series.length }
}

interface Props {
  rows: ResultRow[]
  metric?: 'power' | 'current'
  height?: number
}

export function SweepChart({ rows, metric = 'power', height = 240 }: Props) {
  const { series, data, hiddenCount } = useMemo(
    () => buildSeries(rows, metric),
    [rows, metric],
  )

  if (rows.length === 0) {
    return (
      <Box
        sx={{
          height,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          Measured points appear here as the sweep runs.
        </Typography>
      </Box>
    )
  }

  const yLabel = metric === 'power' ? 'Measured (dBm)' : 'Current (mA)'
  const fmt = (v: number) => (metric === 'power' ? v.toFixed(2) : v.toFixed(1))

  return (
    <Box>
      <Box sx={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.18)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 11 }}
              label={{ value: 'Set (dBm)', position: 'bottom', offset: 0, fontSize: 11 }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={46}
              tickFormatter={fmt}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 12, fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: number | string) => (typeof v === 'number' ? fmt(v) : v)}
              labelFormatter={(x) => `Set: ${x} dBm`}
              contentStyle={{ fontSize: 12 }}
            />
            {series.length > 1 && (
              <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 11 }} />
            )}
            {series.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
                // The chart redraws on every polled row; animating each redraw
                // makes a running sweep look like it is stuttering.
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
      {hiddenCount > 0 && (
        <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>
          Showing {series.length} of {series.length + hiddenCount} modes — export for the rest.
        </Typography>
      )}
    </Box>
  )
}
