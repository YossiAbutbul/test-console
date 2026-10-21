/**
 * Post-processing graph viewer for the TX automation results tables.
 *
 * Smart axis selection based on what the sweep actually varied:
 *   - swept power, fixed freq  → X = Set (dBm),  one series per freq
 *   - swept freq,  fixed power → X = Freq (MHz), one series per set power
 *   - swept both                → X = Set (dBm), one series per freq (default)
 *   - degenerate (1 point)      → X = Set (dBm), single dot
 *
 * Each of those is further split per signal configuration (`row.series`), so
 * modulated runs that repeat a frequency and power under several waveforms
 * draw one line per waveform instead of overwriting each other — see
 * `./graphSeries`.
 *
 * Two tabs pick the Y metric: measured dBm or current mA. The frame, export
 * and axis options come from the shared chart kit in `ui/chart`.
 */
import { useMemo, useState } from 'react'
import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, Slider, Stack, Tab, Tabs,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import {
  CartesianGrid, LabelList, Legend, Line, LineChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useConnection } from '../../context/ConnectionContext'
import { ChartFrame, ChartSwitch, ChartToolbar, fileTimestamp, useChart } from '../../ui'
import { buildSeries, pickAxis, type GraphableRow } from './graphSeries'

export type { GraphableRow } from './graphSeries'

interface Props {
  open: boolean
  onClose: () => void
  results: GraphableRow[]
}

type Mode = 'power' | 'current'

/** Options only this graph has; Y range, grid and legend live in the kit. */
interface LineOptions {
  strokeWidth: number
  dotRadius: number     // 0 = hide dots
  showLabels: boolean   // render the Y value next to every dot
  connectNulls: boolean
}

const DEFAULT_LINE_OPTIONS: LineOptions = {
  strokeWidth: 2,
  dotRadius: 3,
  showLabels: false,
  connectNulls: true,
}

export function ResultsGraphModal({ open, onClose, results }: Props) {
  const [mode, setMode] = useState<Mode>('power')
  const chart = useChart()
  const { opts, theme } = chart
  const [line, setLine] = useState<LineOptions>(DEFAULT_LINE_OPTIONS)
  const setLineOpt = <K extends keyof LineOptions>(k: K, v: LineOptions[K]) =>
    setLine((o) => ({ ...o, [k]: v }))
  // Series the user has clicked off in the legend, by label rather than
  // dataKey: keys are positional, so a frequency arriving mid-run would shift
  // them and switch a different line off.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const toggleSeries = (label: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  const { status: bleStatus } = useConnection()

  const axis = useMemo(() => pickAxis(results), [results])

  const yPick = useMemo(
    () => (mode === 'power'
      ? (r: GraphableRow) => r.measured_dbm
      : (r: GraphableRow) => (r.current_a == null ? null : r.current_a * 1000)),
    [mode],
  )

  const { series, data, xLabel, xText } = useMemo(
    () => buildSeries(results, yPick, axis),
    [results, yPick, axis],
  )

  const yLabel = mode === 'power' ? 'Measured (dBm)' : 'Current (mA)'
  const yFmt = (v: number) => (mode === 'power' ? v.toFixed(2) : v.toFixed(1))
  const xFmt = (v: number) => (axis === 'set' ? String(v) : `${v.toFixed(1)}`)

  const freqCount = new Set(results.map((r) => r.freq_mhz)).size
  const powerCount = new Set(results.map((r) => r.set_power_dbm)).size

  const downloadPng = () => {
    const macSlug = (bleStatus?.address ?? '').replace(/:/g, '').toUpperCase()
    const base = macSlug || 'tx-power-graph'
    // Name what is visible: a series switched off on screen is off in the file.
    const legend = opts.showLegend
      ? series
        .map((s, i) => ({ label: s.label, color: theme.seriesColor(i) }))
        .filter((s) => !hidden.has(s.label))
      : []
    return chart.exportPng(`${base}-${mode}-${fileTimestamp()}.png`, legend)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      transitionDuration={{ enter: 150, exit: 0 }}
      slotProps={{ paper: { sx: { borderRadius: 2, height: 620, maxHeight: '90vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <Stack direction="row" alignItems="baseline" spacing={1.5}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Results graph</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {results.length} point{results.length === 1 ? '' : 's'} · {freqCount} freq{freqCount === 1 ? '' : 's'} · {powerCount} power{powerCount === 1 ? '' : 's'}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <ChartToolbar
            chart={chart}
            onDownload={downloadPng}
            disabled={results.length === 0}
            onReset={() => setLine(DEFAULT_LINE_OPTIONS)}
            controls={(
              <>
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Line width — {line.strokeWidth}px
                  </Typography>
                  <Slider
                    size="small" min={1} max={5} step={1} value={line.strokeWidth}
                    onChange={(_, v) => setLineOpt('strokeWidth', v as number)}
                  />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Dot size — {line.dotRadius === 0 ? 'hidden' : `${line.dotRadius}px`}
                  </Typography>
                  <Slider
                    size="small" min={0} max={6} step={1} value={line.dotRadius}
                    onChange={(_, v) => setLineOpt('dotRadius', v as number)}
                  />
                </Box>
              </>
            )}
            toggles={(
              <>
                <ChartSwitch label="Point labels" checked={line.showLabels}
                  onChange={(c) => setLineOpt('showLabels', c)} />
                <ChartSwitch label="Connect gaps" checked={line.connectNulls}
                  onChange={(c) => setLineOpt('connectNulls', c)} />
              </>
            )}
          />
          <IconButton size="small" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </DialogTitle>

      <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={mode}
          onChange={(_, v) => setMode(v)}
          sx={{
            minHeight: 36,
            '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 13, textTransform: 'none', fontWeight: 600 },
          }}
        >
          <Tab value="power" label={`Measured vs ${axis === 'set' ? 'Set' : 'Freq'}`} />
          <Tab value="current" label={`Current vs ${axis === 'set' ? 'Set' : 'Freq'}`} />
        </Tabs>
      </Box>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {results.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', m: 'auto' }}>
            No data yet. Run automation first.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, mt: 1 }}>
            <ChartFrame chart={chart}>
              <LineChart data={data} margin={{ top: 8, right: 24, bottom: 36, left: 12 }}>
                {opts.showGrid && <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />}
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={data.map((d) => d.x)}
                  interval={0}
                  tickFormatter={xFmt}
                  label={{ value: xLabel, position: 'bottom', offset: 4, ...theme.labelStyle }}
                  tick={theme.tick}
                  stroke={theme.axisStroke}
                />
                <YAxis
                  domain={chart.yDomain()}
                  // Without this Recharts widens a typed range to fit the
                  // data, so Y min/max could only ever zoom out.
                  allowDataOverflow
                  label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 4, ...theme.labelStyle }}
                  tick={theme.tick}
                  stroke={theme.axisStroke}
                  tickFormatter={(v: number) => yFmt(v)}
                />
                <Tooltip
                  formatter={(v: number | string) => (typeof v === 'number' ? yFmt(v) : v)}
                  labelFormatter={(x) => `${xLabel.split(' ')[0]}: ${xText(Number(x))}`}
                  contentStyle={theme.tooltipStyle}
                />
                {opts.showLegend && (
                  <Legend
                    verticalAlign="top"
                    align="right"
                    // Not a fixed height: per-configuration labels can wrap
                    // to several rows and would overlap the plot.
                    wrapperStyle={{ fontSize: 12, cursor: 'pointer', paddingBottom: 4 }}
                    onClick={(e: { value?: string }) => {
                      if (e.value) toggleSeries(e.value)
                    }}
                    formatter={(value: string) => (
                      <span style={{ color: theme.text, opacity: hidden.has(value) ? 0.35 : 1 }}>
                        {value}
                      </span>
                    )}
                  />
                )}
                {series.map((s, i) => (
                  <Line
                    key={s.key}
                    name={s.label}
                    type="monotone"
                    dataKey={s.key}
                    stroke={theme.seriesColor(i)}
                    strokeWidth={line.strokeWidth}
                    dot={line.dotRadius > 0 ? { r: line.dotRadius } : false}
                    activeDot={line.dotRadius > 0 ? { r: line.dotRadius + 2 } : false}
                    connectNulls={line.connectNulls}
                    hide={hidden.has(s.label)}
                    isAnimationActive={false}
                  >
                    {line.showLabels && (
                      <LabelList
                        dataKey={s.key}
                        position="top"
                        formatter={(v: number | string) =>
                          typeof v === 'number' ? yFmt(v) : ''}
                        style={{ fontSize: 12, fill: theme.seriesColor(i) }}
                      />
                    )}
                  </Line>
                ))}
              </LineChart>
            </ChartFrame>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
