/**
 * Post-processing graph viewer for the TX-Power automation table.
 *
 * Smart axis selection based on what the sweep actually varied:
 *   - swept power, fixed freq  → X = Set (dBm),  one series per freq
 *   - swept freq,  fixed power → X = Freq (MHz), one series per set power
 *   - swept both                → X = Set (dBm), one series per freq (default)
 *   - degenerate (1 point)      → X = Set (dBm), single dot
 *
 * Two tabs pick the Y metric: measured dBm or current mA.
 */
import { useMemo, useRef, useState } from 'react'
import {
  Box, Dialog, DialogContent, DialogTitle, Divider, FormControlLabel,
  IconButton, Popover, Slider, Stack, Switch, Tab, Tabs,
  TextField, Tooltip as MuiTooltip, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import DownloadIcon from '@mui/icons-material/Download'
import {
  CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { AutomationResultRow } from '../../store/powerPageStore'
import { useConnection } from '../../context/ConnectionContext'

interface Props {
  open: boolean
  onClose: () => void
  results: AutomationResultRow[]
}

const PALETTE = [
  '#2563EB', '#DC2626', '#16A34A', '#D97706',
  '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
]

type Mode = 'power' | 'current'
type Axis = 'set' | 'freq'

interface GraphOptions {
  strokeWidth: number
  dotRadius: number     // 0 = hide dots
  showGrid: boolean
  showLegend: boolean
  showLabels: boolean   // render the Y value next to every dot
  connectNulls: boolean
  yMin: number | null   // null = auto (dataMin)
  yMax: number | null   // null = auto (dataMax)
}

const DEFAULT_OPTIONS: GraphOptions = {
  strokeWidth: 2,
  dotRadius: 3,
  showGrid: true,
  showLegend: true,
  showLabels: false,
  connectNulls: true,
  yMin: null,
  yMax: null,
}

interface SeriesPoint {
  x: number
  [seriesKey: string]: number | null
}

const freqLabel = (mhz: number): string => `${mhz.toFixed(1)} MHz`
const powerLabel = (dbm: number): string => `${dbm} dBm`

function uniqueSorted<T extends number>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((a, b) => a - b) as T[]
}

/** Pivot the result list into recharts-friendly rows.
 *  `xKey` picks the X axis (set power or frequency); `groupKey` picks the
 *  series labels (the other dimension). */
function buildSeries(
  results: AutomationResultRow[],
  pick: (r: AutomationResultRow) => number | null,
  xKey: Axis,
): { series: string[]; data: SeriesPoint[]; xLabel: string } {
  const xPicker = xKey === 'set' ? (r: AutomationResultRow) => r.set_power_dbm
                                 : (r: AutomationResultRow) => r.freq_mhz
  const groupPicker = xKey === 'set' ? (r: AutomationResultRow) => r.freq_mhz
                                     : (r: AutomationResultRow) => r.set_power_dbm
  const groupLabel = xKey === 'set' ? freqLabel : powerLabel

  const xs = uniqueSorted(results.map(xPicker))
  const groups = uniqueSorted(results.map(groupPicker))
  const series = groups.map(groupLabel)
  const byKey = new Map<string, number | null>()
  for (const r of results) {
    byKey.set(`${xPicker(r)}|${groupPicker(r)}`, pick(r))
  }
  const data: SeriesPoint[] = xs.map((x) => {
    const row: SeriesPoint = { x }
    for (const g of groups) {
      const v = byKey.get(`${x}|${g}`)
      row[groupLabel(g)] = v == null ? null : v
    }
    return row
  })
  const xLabel = xKey === 'set' ? 'Set (dBm)' : 'Freq (MHz)'
  return { series, data, xLabel }
}

export function ResultsGraphModal({ open, onClose, results }: Props) {
  const [mode, setMode] = useState<Mode>('power')
  const [opts, setOpts] = useState<GraphOptions>(DEFAULT_OPTIONS)
  const [tuneAnchor, setTuneAnchor] = useState<HTMLElement | null>(null)
  // Series names the user has clicked off in the legend.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const toggleSeries = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const setOpt = <K extends keyof GraphOptions>(k: K, v: GraphOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }))
  const chartRef = useRef<HTMLDivElement | null>(null)
  const { status: bleStatus } = useConnection()

  /** Snapshot the rendered SVG to a PNG via canvas, then save as a file. */
  const downloadPng = async () => {
    const root = chartRef.current
    const svg = root?.querySelector('svg')
    if (!svg) return
    const w = svg.clientWidth || 1000
    const h = svg.clientHeight || 600
    // Clone so we can inline width/height (some browsers need explicit dims).
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const xml = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          // 2× upscale for crisper export.
          const scale = 2
          const canvas = document.createElement('canvas')
          canvas.width = w * scale
          canvas.height = h * scale
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('canvas 2d ctx unavailable'))
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0)
          canvas.toBlob((png) => {
            if (!png) return reject(new Error('toBlob returned null'))
            const a = document.createElement('a')
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            a.href = URL.createObjectURL(png)
            const macSlug = (bleStatus?.address ?? '').replace(/:/g, '').toUpperCase()
            const base = macSlug || 'tx-power-graph'
            a.download = `${base}-${mode}-${ts}.png`
            a.click()
            URL.revokeObjectURL(a.href)
            resolve()
          }, 'image/png')
        }
        img.onerror = () => reject(new Error('svg image load failed'))
        img.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Decide which axis varies: pick whichever dimension has more distinct
  // values. Ties keep the historical default (Set on X).
  const axis: Axis = useMemo(() => {
    const freqs = new Set(results.map((r) => r.freq_mhz)).size
    const powers = new Set(results.map((r) => r.set_power_dbm)).size
    return freqs > powers ? 'freq' : 'set'
  }, [results])

  const yPick = useMemo(
    () => (mode === 'power'
      ? (r: AutomationResultRow) => r.measured_dbm
      : (r: AutomationResultRow) => (r.current_a == null ? null : r.current_a * 1000)),
    [mode],
  )

  const { series, data, xLabel } = useMemo(
    () => buildSeries(results, yPick, axis),
    [results, yPick, axis],
  )

  const yLabel = mode === 'power' ? 'Measured (dBm)' : 'Current (mA)'
  const yFmt = (v: number) => (mode === 'power' ? v.toFixed(2) : v.toFixed(1))
  const xFmt = (v: number) => (axis === 'set' ? String(v) : `${v.toFixed(1)}`)

  const freqCount = new Set(results.map((r) => r.freq_mhz)).size
  const powerCount = new Set(results.map((r) => r.set_power_dbm)).size

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
          <MuiTooltip title="Download as PNG">
            <span>
              <IconButton
                size="small"
                onClick={() => { void downloadPng() }}
                disabled={results.length === 0}
              >
                <DownloadIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </MuiTooltip>
          <MuiTooltip title="Graph options">
            <IconButton size="small" onClick={(e) => setTuneAnchor(e.currentTarget)}>
              <TuneIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </MuiTooltip>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </DialogTitle>

      <Popover
        open={!!tuneAnchor}
        anchorEl={tuneAnchor}
        onClose={() => setTuneAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 2, width: 280 } } }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
          Graph options
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" type="number" label="Y min"
              value={opts.yMin ?? ''}
              placeholder="auto"
              onChange={(e) => {
                const s = e.target.value.trim()
                setOpt('yMin', s === '' ? null : Number(s))
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small" type="number" label="Y max"
              value={opts.yMax ?? ''}
              placeholder="auto"
              onChange={(e) => {
                const s = e.target.value.trim()
                setOpt('yMax', s === '' ? null : Number(s))
              }}
              sx={{ flex: 1 }}
            />
          </Stack>

          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Line width — {opts.strokeWidth}px
            </Typography>
            <Slider
              size="small" min={1} max={5} step={1} value={opts.strokeWidth}
              onChange={(_, v) => setOpt('strokeWidth', v as number)}
            />
          </Box>

          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Dot size — {opts.dotRadius === 0 ? 'hidden' : `${opts.dotRadius}px`}
            </Typography>
            <Slider
              size="small" min={0} max={6} step={1} value={opts.dotRadius}
              onChange={(_, v) => setOpt('dotRadius', v as number)}
            />
          </Box>

          <Divider />

          <FormControlLabel
            control={<Switch size="small" checked={opts.showGrid}
              onChange={(_, c) => setOpt('showGrid', c)} />}
            label={<Typography sx={{ fontSize: 13 }}>Grid</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={opts.showLegend}
              onChange={(_, c) => setOpt('showLegend', c)} />}
            label={<Typography sx={{ fontSize: 13 }}>Legend</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={opts.showLabels}
              onChange={(_, c) => setOpt('showLabels', c)} />}
            label={<Typography sx={{ fontSize: 13 }}>Point labels</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={opts.connectNulls}
              onChange={(_, c) => setOpt('connectNulls', c)} />}
            label={<Typography sx={{ fontSize: 13 }}>Connect gaps</Typography>}
          />

          <Divider />
          <Typography
            component="button"
            onClick={() => setOpts(DEFAULT_OPTIONS)}
            sx={{
              fontSize: 12, color: 'primary.main', textAlign: 'left',
              background: 'none', border: 0, cursor: 'pointer', p: 0,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Reset to defaults
          </Typography>
        </Stack>
      </Popover>

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
          <Box ref={chartRef} sx={{ flexGrow: 1, minHeight: 0, mt: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 24, bottom: 36, left: 12 }}>
                {opts.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />}
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  ticks={data.map((d) => d.x)}
                  interval={0}
                  tickFormatter={xFmt}
                  label={{ value: xLabel, position: 'bottom', offset: 4, fontSize: 12 }}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  domain={[
                    opts.yMin != null && Number.isFinite(opts.yMin) ? opts.yMin : 'dataMin',
                    opts.yMax != null && Number.isFinite(opts.yMax) ? opts.yMax : 'dataMax',
                  ]}
                  label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 4, fontSize: 12 }}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => yFmt(v)}
                />
                <Tooltip
                  formatter={(v: number | string) => (typeof v === 'number' ? yFmt(v) : v)}
                  labelFormatter={(x) => `${xLabel.split(' ')[0]}: ${xFmt(Number(x))}`}
                  contentStyle={{ fontSize: 12 }}
                />
                {opts.showLegend && (
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={28}
                    wrapperStyle={{ fontSize: 12, cursor: 'pointer' }}
                    onClick={(e: { value?: string }) => {
                      if (e.value) toggleSeries(e.value)
                    }}
                    formatter={(value: string) => (
                      <span style={{ opacity: hidden.has(value) ? 0.35 : 1 }}>
                        {value}
                      </span>
                    )}
                  />
                )}
                {series.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={opts.strokeWidth}
                    dot={opts.dotRadius > 0 ? { r: opts.dotRadius } : false}
                    activeDot={opts.dotRadius > 0 ? { r: opts.dotRadius + 2 } : false}
                    connectNulls={opts.connectNulls}
                    hide={hidden.has(name)}
                    isAnimationActive={false}
                  >
                    {opts.showLabels && (
                      <LabelList
                        dataKey={name}
                        position="top"
                        formatter={(v: number | string) =>
                          typeof v === 'number' ? yFmt(v) : ''}
                        style={{
                          fontSize: 10,
                          fill: PALETTE[i % PALETTE.length],
                        }}
                      />
                    )}
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
