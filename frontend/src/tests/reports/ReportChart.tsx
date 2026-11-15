/**
 * A run's results drawn as an SVG chart in the report's style: the title in
 * navy Calibri, light grid, the series in Office's chart colours from the
 * report's navy on, a legend under the title.
 *
 * Drawn by hand rather than with a chart library so the picture Word gets
 * (svgToPng below, sent on export) is exactly the one on the page: one SVG,
 * fonts and colours set on its own elements, nothing laid out by CSS.
 */
import type { ReportEntry } from '../../api/reports'
import { chartData, niceTicks } from './chartData'
import { FONT, PAPER, SERIES } from './paperStyle'


const W = 640
const H = 360
const PAD = { l: 58, r: 18, t: 58, b: 52 }

function fmt(v: number): string {
  return String(Number(v.toPrecision(6)))
}

export function ReportChart({ entry, x, ys, kind, title, svgId }: {
  entry: ReportEntry
  x: number
  ys: number[]
  kind: 'line' | 'bar' | 'scatter'
  title: string
  svgId: string
}) {
  const d = chartData(entry, x, ys)
  const all = d.ys.flat().filter((v): v is number => v !== null)
  const yt = niceTicks(Math.min(...all, kind === 'bar' ? 0 : Infinity), Math.max(...all))
  const y0 = yt[0]
  const y1 = yt[yt.length - 1]
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const sy = (v: number) => PAD.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih

  // X: a numeric axis for line and points; slots for bars and for words.
  const slots = kind === 'bar' || !d.numericX
  const xnums = d.xs as number[]
  const xt = slots ? [] : niceTicks(Math.min(...xnums), Math.max(...xnums), 6)
  const x0 = xt[0] ?? 0
  const x1 = xt[xt.length - 1] ?? 1
  const slotW = iw / Math.max(1, d.xs.length)
  const sx = (i: number) => slots
    ? PAD.l + slotW * (i + 0.5)
    : PAD.l + ((xnums[i] - x0) / (x1 - x0 || 1)) * iw

  const text = { fontFamily: FONT.body, fill: PAPER.ink }
  const xName = entry.columns[x] ?? ''
  const yName = d.names.length === 1 ? d.names[0] : ''
  const barW = Math.max(2, Math.min(28, (slotW * 0.75) / Math.max(1, d.ys.length)))

  if (!d.xs.length || !all.length) {
    return (
      <svg data-chart-svg={svgId} viewBox={`0 0 ${W} 120`} width="100%" role="img" aria-label="Empty chart">
        <text x={W / 2} y={64} textAnchor="middle" fontSize={14} {...text} fill={PAPER.muted}>
          Nothing to plot: pick a run and columns with numbers
        </text>
      </svg>
    )
  }

  return (
    <svg data-chart-svg={svgId} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title || 'Chart'}
      xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', background: '#FFFFFF' }}>
      <rect x={0} y={0} width={W} height={H} fill="#FFFFFF" />
      {title && <text x={W / 2} y={22} textAnchor="middle" fontSize={16} fontWeight={700} {...text} fill={PAPER.navy}>{title}</text>}

      {/* Legend, under the title. */}
      <g transform={`translate(${W / 2}, 42)`}>
        {(() => {
          const widths = d.names.map((n) => 26 + n.length * 6.4)
          const total = widths.reduce((a, b) => a + b, 0)
          const starts = widths.map((_, i) => -total / 2 + widths.slice(0, i).reduce((a, b) => a + b, 0))
          return d.names.map((n, i) => {
            const gx = starts[i]
            return (
              <g key={n} transform={`translate(${gx}, 0)`}>
                {kind === 'bar'
                  ? <rect x={0} y={-6} width={14} height={9} fill={SERIES[i % SERIES.length]} />
                  : <line x1={0} y1={-1.5} x2={16} y2={-1.5} stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} />}
                <text x={20} y={2} fontSize={11.5} {...text}>{n}</text>
              </g>
            )
          })
        })()}
      </g>

      {/* Grid and Y axis. */}
      {yt.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#D9D9D9" strokeWidth={1} />
          <text x={PAD.l - 8} y={sy(v) + 4} textAnchor="end" fontSize={11} {...text} fill={PAPER.muted}>{fmt(v)}</text>
        </g>
      ))}
      {yName && (
        <text transform={`translate(15, ${PAD.t + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} {...text}>{yName}</text>
      )}

      {/* X axis. */}
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="#8C8C8C" strokeWidth={1} />
      {slots
        ? d.xs.map((v, i) => (
          (d.xs.length <= 16 || i % Math.ceil(d.xs.length / 16) === 0) && (
            <text key={i} x={sx(i)} y={PAD.t + ih + 16} textAnchor="middle" fontSize={11} {...text} fill={PAPER.muted}>
              {typeof v === 'number' ? fmt(v) : v}
            </text>
          )))
        : xt.map((v) => {
          const px = PAD.l + ((v - x0) / (x1 - x0 || 1)) * iw
          return (
            <g key={v}>
              <line x1={px} x2={px} y1={PAD.t + ih} y2={PAD.t + ih + 4} stroke="#8C8C8C" />
              <text x={px} y={PAD.t + ih + 17} textAnchor="middle" fontSize={11} {...text} fill={PAPER.muted}>{fmt(v)}</text>
            </g>
          )
        })}
      <text x={PAD.l + iw / 2} y={H - 10} textAnchor="middle" fontSize={11.5} {...text}>{xName}</text>

      {/* The series. */}
      {d.ys.map((s, si) => {
        const color = SERIES[si % SERIES.length]
        if (kind === 'bar') {
          return s.map((v, i) => v === null ? null : (
            <rect key={`${si}-${i}`} x={sx(i) - (barW * d.ys.length) / 2 + si * barW} width={barW - 1}
              y={Math.min(sy(v), sy(Math.max(y0, 0)))} height={Math.abs(sy(Math.max(y0, 0)) - sy(v))} fill={color} />
          ))
        }
        const pts = s.map((v, i) => (v === null ? null : [sx(i), sy(v)] as const))
        const path = pts.reduce((acc, p, i) => {
          if (!p) return acc
          const prev = pts[i - 1]
          return `${acc}${prev ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
        }, '')
        return (
          <g key={si}>
            {kind === 'line' && <path d={path} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" />}
            {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={kind === 'scatter' ? 4 : 3} fill={color} />)}
          </g>
        )
      })}
    </svg>
  )
}
