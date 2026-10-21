/**
 * State and theme for one chart: view options, the DOM handle the PNG export
 * reads, and the colours that make Recharts legible in every theme mode.
 *
 * Pair with `<ChartFrame>` (which takes the handle and hosts the chart) and
 * `<ChartToolbar>` (download + options popover).
 */
import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useAppPalette } from '../../context/ThemeModeContext'
import {
  DEFAULT_CHART_OPTIONS, yDomain, type ChartOptions, type DomainBound,
} from './chartOptions'
import { downloadChartPng, type LegendItem } from './exportPng'

/** Ready-to-spread Recharts styling for the active theme mode. */
export interface ChartTheme {
  /** Categorical series colours; use `seriesColor(i)` to cycle. */
  series: string[]
  seriesColor: (i: number) => string
  grid: string
  axis: string
  /** The surface the chart sits on — also the PNG background. */
  background: string
  text: string
  /** For `<XAxis tick>` / `<YAxis tick>`. */
  tick: { fontSize: number; fill: string }
  /** For `<XAxis stroke>` / `<YAxis stroke>`. */
  axisStroke: string
  /** Spread into an axis `label` object so its text follows the theme too. */
  labelStyle: { fontSize: number; fill: string }
  /** For `<Tooltip contentStyle>`: Recharts defaults to a white box, which
   *  glares on the dark grounds. */
  tooltipStyle: CSSProperties
}

export function useChartTheme(): ChartTheme {
  const p = useAppPalette()
  return useMemo(() => {
    const series = p.chart.series
    return {
      series,
      seriesColor: (i: number) => series[i % series.length],
      grid: p.chart.grid,
      axis: p.chart.axis,
      background: p.paper,
      text: p.sidebar.text,
      // The 12 px floor holds on charts too.
      tick: { fontSize: 12, fill: p.chart.axis },
      axisStroke: p.chart.axis,
      labelStyle: { fontSize: 12, fill: p.chart.axis },
      tooltipStyle: {
        fontSize: 12,
        background: p.paper,
        border: `1px solid ${p.appBarBorder}`,
        color: p.sidebar.text,
      },
    }
  }, [p])
}

export interface ChartHandle {
  /** Registers the element containing the chart; `<ChartFrame>` calls it.
   *  Held in state rather than a `useRef` so the handle carries no ref the
   *  React Compiler lint would flag wherever the handle is passed. */
  attach: (el: HTMLDivElement | null) => void
  opts: ChartOptions
  setOpt: <K extends keyof ChartOptions>(k: K, v: ChartOptions[K]) => void
  reset: () => void
  theme: ChartTheme
  /** Y domain honouring the min/max fields; `fallback` is used per bound
   *  while a field is blank. */
  yDomain: (fallback?: [DomainBound, DomainBound]) => [DomainBound, DomainBound]
  /** Save the chart as PNG on the current theme's background. Pass the
   *  visible series to have a legend drawn into the image. */
  exportPng: (filename: string, legend?: LegendItem[]) => Promise<void>
}

export function useChart(defaults?: Partial<ChartOptions>): ChartHandle {
  const [frame, attach] = useState<HTMLDivElement | null>(null)
  // Captured once, like useState's initialiser: callers pass a literal and
  // re-reading it every render would make `reset` change identity for nothing.
  const [initial] = useState<ChartOptions>(() => ({ ...DEFAULT_CHART_OPTIONS, ...defaults }))
  const [opts, setOpts] = useState<ChartOptions>(initial)
  const theme = useChartTheme()

  const setOpt = useCallback(<K extends keyof ChartOptions>(k: K, v: ChartOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v })), [])
  const reset = useCallback(() => setOpts(initial), [initial])
  const exportPng = useCallback(
    (filename: string, legend?: LegendItem[]) => downloadChartPng(frame, {
      filename, legend, background: theme.background, textColor: theme.text,
    }),
    [frame, theme],
  )

  return {
    attach, opts, setOpt, reset, theme, exportPng,
    yDomain: (fallback) => yDomain(opts, fallback),
  }
}
