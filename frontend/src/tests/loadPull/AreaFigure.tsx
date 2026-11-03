import { memo, useId, useMemo, type Ref } from 'react'
import { useTheme } from '@mui/material/styles'
import { useAppPalette } from '../../context/ThemeModeContext'
import { EFF_BANDS, VCC, bandColor, bandOf as bandOfSpan, impedance, rampColor } from './smith'
import { SmithGrid } from './SmithGrid'

const bandOf = (e: number, range: { min: number; max: number }) => bandOfSpan(e, range, 0.05)
import { QUANTITY, contourLevels, type AreaResult, type Quantity } from './areaCompute'
import { NO_LIMITS, type Area, type G, type Limits } from './workingArea'

const NO_POINTS: G[] = []

/** What the figure draws: the worker's result and what it was computed for. */
export type AreaView = AreaResult & {
  meta: { fieldFreqs: Array<number | null>; tauPs: number; power: number | null; contourKey: Quantity }
}

/**
 * The working area as one figure, laid out as a load-pull plot is in a
 * report: a title saying what is filled, the chart with its grid labelled,
 * the allowed region in bands of the chosen quantity, contours per frequency, the
 * edge of what was measured, the optimum, a colour bar and the legends.
 *
 * One SVG for all of it rather than the chart plus HTML around it, so that
 * Copy chart pastes the figure whole -- title, scale and legend are what
 * make the picture readable once it is out of this dialog.
 */

/** Figure geometry, in viewBox units. */
const W = 704
const TITLE_H = 50
const CHART = 560
const R = 236
const CX = 290
const CY = TITLE_H + CHART / 2
const BAR = { x: 602, w: 16, top: CY - 210, h: 420 }
const BANDS = EFF_BANDS
const LEGEND_W = W - 16
const ROW = 17


const num = (v: number) => String(Number(v.toFixed(2)))

/** Γ to chart coordinates. */
const px = (p: G) => ({ x: CX + p.gr * R, y: CY - p.gi * R })
const pts = (line: G[]) => line.map((p) => { const q = px(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}` }).join(' ')

const insideConvex = (p: G, poly: G[]) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length]
  return (b.gr - a.gr) * (p.gi - a.gi) - (b.gi - a.gi) * (p.gr - a.gr) >= -1e-12
})

/** "28 < Pout < 30 dBm and Icc < 650 mA", or null with no limits. */
function describeLimits(limits: Limits): string | null {
  const one = (name: string, unit: string, [lo, hi]: [number | null, number | null]) =>
    lo != null && hi != null ? `${num(lo)} < ${name} < ${num(hi)} ${unit}`
      : lo != null ? `${name} > ${num(lo)} ${unit}`
      : hi != null ? `${name} < ${num(hi)} ${unit}` : null
  const parts = [one('Pout', 'dBm', limits.pout), one('Icc', 'mA', limits.icc), one('eff', '%', limits.eff)]
    .filter((p): p is string => p != null)
  return parts.length ? parts.join(' and ') : null
}

const fmtZopt = (z: { r: number; x: number }) =>
  `${z.r.toFixed(0)}${z.x >= 0 ? '+' : '−'}${Math.abs(z.x).toFixed(0)}j Ω`

const RANGE_OF = { pout: 'poutRange', icc: 'iccRange', eff: 'effRange' } as const
/** The span a quantity's colours run over, worst case per cell. */
const rangeOf = (area: Area | null, key: Quantity) => (area ? area[RANGE_OF[key]] : null)

/** The allowed cells as a picture, each in its band of `key`. */
function fillImage(area: Area, key: Quantity): string | null {
  const range = rangeOf(area, key)
  if (!range) return null
  const values = area[key]
  const n = area.n
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const rgb = Array.from({ length: BANDS }, (_, b) => {
    const h = bandColor(b)
    return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  })
  const img = ctx.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    if (!area.ok[i]) continue
    const [r, g, b] = rgb[bandOf(values[i], range)]
    img.data.set([r, g, b, 255], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Memoised: it is the heaviest thing in the dialog, and the cursor moving
 * over it, or anything else in the dialog changing, need not redraw it.
 */
export const AreaFigure = memo(function AreaFigure({
  svgRef, view, pending, slots, colour, freqColor, grid, gridN, onCursor,
}: {
  /** What the region is coloured by. */
  colour: Quantity
  svgRef: Ref<SVGSVGElement>
  view: AreaView | null
  /** Frequencies to make room for in the legend: the run's, whichever are
   *  shown, so the figure keeps one size through loading, a limit with no
   *  contour, and Shown / All. */
  slots: number
  /** A new result is on its way (held long enough to be seen, see
   *  useHeldFlag): the old one softens under the loading sheet. */
  pending: boolean
  freqColor: (f: number | null) => string
  grid: boolean
  gridN: number
  onCursor: (cell: number | null) => void
}) {
  const pal = useAppPalette()
  const font = String(useTheme().typography.fontFamily)
  const clipId = useId().replace(/:/g, '')
  const ink = pal.sidebar.text
  const dim = pal.sidebar.textDim
  const paper = pal.paper

  const area = view?.area ?? null
  const limits: Limits = view?.limits ?? NO_LIMITS
  const fieldFreqs = view?.meta.fieldFreqs ?? []
  const tauPs = view?.meta.tauPs ?? 0
  const power = view?.meta.power ?? null
  const fieldPts = view?.pts ?? []
  const boundary = view?.boundary ?? NO_POINTS
  const optimum = area?.best ? impedance(area.best.gr, area.best.gi) : null

  const src = useMemo(() => (area ? fillImage(area, colour) : null), [area, colour])
  const contourKey: Quantity = view?.contourKey ?? 'pout'
  const levels = useMemo(() => contourLevels(limits, contourKey), [limits, contourKey])
  const cq = QUANTITY[contourKey]
  const fq = QUANTITY[colour]
  // One label per line set, on the longest line, at its middle point inside
  // the boundary -- the part of a line outside it is not drawn.
  const contours = useMemo(() => (view?.contours ?? []).map((byLevel) => byLevel.map((lines) => {
    let label: { x: number; y: number; deg: number } | null = null
    let best = 0
    for (const line of lines) {
      const inside = line.map((p, i) => ({ p, i })).filter(({ p }) => insideConvex(p, boundary))
      if (inside.length < 3 || inside.length <= best) continue
      best = inside.length
      const { i } = inside[Math.floor(inside.length / 2)]
      const a = px(line[Math.max(0, i - 1)])
      const b = px(line[Math.min(line.length - 1, i + 1)])
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      if (deg > 90) deg -= 180
      if (deg < -90) deg += 180
      label = { ...px(line[i]), deg }
    }
    return { lines, label }
  })), [view, boundary])

  const freqText = fieldFreqs.filter((f): f is number => f != null).map(num).join('/')
  const cond = describeLimits(limits)
  // Before the first result the titles say so, on the same two lines.
  const title1 = !view ? 'Working area' : `${power != null ? `Set ${num(power)} dBm` : 'Load pull'} · ${
    tauPs ? `PA reference plane (${num(tauPs)} ps cable de-embedded)` : 'tuner reference plane (no cable delay)'}`
  const title2 = !view ? '' : `Filled: ${cond ? `region where ${cond}` : 'every measured load'}${
    freqText ? ` at ${freqText} MHz` : ''}; colour = ${fq.inline}`

  // Legend layout: the contour block, then the key. The block is always
  // there and always sized for three levels and every frequency of the run:
  // sized to what it listed, the figure grew and shrank -- and, scaled to
  // fit its box, the chart with it -- each time a result landed.
  const MAX_LEVELS = 3
  const nSlots = Math.max(1, slots, fieldPts.length)
  const cols = Math.min(3, nSlots)
  const blocks = Math.ceil(nSlots / cols)
  const contourH = 8 + ROW + blocks * MAX_LEVELS * ROW + 6
  const legendTop = TITLE_H + CHART + 4
  const keyTop = legendTop + contourH + 8
  const keyH = 8 + 2 * ROW + 4
  const H = keyTop + keyH + 6

  const range = rangeOf(area, colour)
  const nWorst = fieldPts.length
  const best = area?.best ?? null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.getScreenCTM()
    if (!m) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const gr = (p.x - CX) / R
    const gi = (CY - p.y) / R
    if (gr * gr + gi * gi > 1) { onCursor(null); return }
    const c = Math.floor((gr + 1) / (2 / gridN))
    const r = Math.floor((1 - gi) / (2 / gridN))
    onCursor(c < 0 || r < 0 || c >= gridN || r >= gridN ? null : r * gridN + c)
  }

  const text = { fontFamily: font, fill: ink } as const
  const star = (x: number, y: number, outer: number) => Array.from({ length: 10 }, (_, k) => {
    const a = (Math.PI / 5) * k - Math.PI / 2
    const rr = k % 2 ? outer * 0.42 : outer
    return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`
  }).join(' ')

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W} height={H}
      style={{
        width: '100%', height: '100%', display: 'block',
        // While a new result is worked out the old one softens -- a touch
        // of blur, a little faded -- under the loading sheet the dialog lays
        // over it: still there to read, plainly not current. The new one
        // comes back sharp quickly, settling as it lands.
        opacity: pending && view ? 0.7 : 1,
        filter: pending ? 'blur(1.5px) saturate(0.8)' : 'none',
        transition: pending
          ? 'opacity 220ms ease-out, filter 220ms ease-out'
          : 'opacity 140ms ease-out, filter 140ms ease-out',
      }}
      onMouseMove={onMove}
      onMouseLeave={() => onCursor(null)}
    >
      <defs>
        <clipPath id={`${clipId}-disc`}><circle cx={CX} cy={CY} r={R} /></clipPath>
        {boundary.length > 2 && <clipPath id={`${clipId}-meas`}><polygon points={pts(boundary)} /></clipPath>}
      </defs>

      {/* While busy the dialog's loading capsule takes the title's place, so
          the title steps aside rather than poking out from under it. */}
      <g style={{ opacity: pending ? 0 : 1, transition: 'opacity 160ms ease-out' }}>
        <text {...text} x={W / 2} y={18} textAnchor="middle" fontSize={13} fontWeight={600}>{title1}</text>
        <text {...text} x={W / 2} y={37} textAnchor="middle" fontSize={11.5} fill={dim}>{title2}</text>
      </g>

      {/* The region, under the grid so the circles read through it. */}
      {src && (
        <image
          href={src} x={CX - R} y={CY - R} width={2 * R} height={2 * R}
          preserveAspectRatio="none" clipPath={`url(#${clipId}-disc)`}
        />
      )}

      <SmithGrid cx={CX} cy={CY} R={R} grid={grid} />

      {/* Where every frequency was measured. */}
      {boundary.length > 2 && (
        <polygon points={pts(boundary)} fill="none" stroke={dim} strokeWidth={1} strokeDasharray="7 3 1.5 3" />
      )}

      {/* Measured tuner states, every frequency's. */}
      {/* Where the tuner was: context, not data to read, so barely there. */}
      <g fill={dim} opacity={0.35}>
        {fieldPts.flatMap((fp, fi) => fp.map((p, i) => {
          const q = px(p)
          return <circle key={`${fi}-${i}`} cx={q.x} cy={q.y} r={0.55} />
        }))}
      </g>

      {/* Contours, kept to the measured area. */}
      <g clipPath={boundary.length > 2 ? `url(#${clipId}-meas)` : undefined} fill="none" strokeLinecap="round">
        {contours.map((byLevel, fi) => byLevel.map(({ lines }, li) => lines.map((line, k) => (
          <polyline
            key={`${fi}-${li}-${k}`} points={pts(line)}
            stroke={freqColor(fieldFreqs[fi])} strokeWidth={0.8} strokeDasharray={levels[li].dash}
          />
        ))))}
      </g>
      {contours.map((byLevel, fi) => byLevel.map(({ label }, li) => label && (
        <text
          key={`cl${fi}-${li}`} {...text} fill={freqColor(fieldFreqs[fi])} fontSize={11} fontWeight={600}
          x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle"
          transform={`rotate(${label.deg.toFixed(1)} ${label.x.toFixed(1)} ${label.y.toFixed(1)})`}
          stroke={paper} strokeWidth={3} paintOrder="stroke"
        >
          {num(levels[li].v)}
        </text>
      )))}


      {best && optimum && (() => {
        const q = px(best)
        const label = `opt. ${fmtZopt(optimum)}`
        const w = label.length * 7.3 + 10
        const left = q.x + 14 + w > CX + R + 30
        const bx = left ? q.x - 14 - w : q.x + 14
        return (
          <g pointerEvents="none">
            <rect x={bx} y={q.y - 11} width={w} height={20} rx={3} fill={paper} fillOpacity={0.88} />
            <text {...text} x={bx + 5} y={q.y + 4} fontSize={12.5} fontWeight={700}>{label}</text>
            <polygon points={star(q.x, q.y, 10)} fill="#F05A28" stroke={ink} strokeWidth={0.9} strokeLinejoin="round" />
          </g>
        )
      })()}

      {/* Colour bar, in the fill's bands. */}
      <g>
        {range ? Array.from({ length: BANDS }, (_, b) => (
          <rect
            key={b} x={BAR.x} width={BAR.w} height={BAR.h / BANDS + 0.5}
            y={BAR.top + BAR.h - ((b + 1) * BAR.h) / BANDS} fill={bandColor(b)}
          />
        )) : null}
        {view && <rect x={BAR.x} y={BAR.top} width={BAR.w} height={BAR.h} fill="none" stroke={dim} strokeWidth={0.8} />}
        {range ? Array.from({ length: 6 }, (_, k) => {
          const v = range.min + ((range.max - range.min) * k) / 5
          const y = BAR.top + BAR.h - (k / 5) * BAR.h
          return (
            <g key={k}>
              <line x1={BAR.x + BAR.w} x2={BAR.x + BAR.w + 4} y1={y} y2={y} stroke={dim} strokeWidth={0.8} />
              <text {...text} fontSize={11} x={BAR.x + BAR.w + 7} y={y} dominantBaseline="middle">{v.toFixed(fq.digits)}</text>
            </g>
          )
        }) : (
          <text {...text} fill={dim} fontSize={11} x={BAR.x + BAR.w + 7} y={CY} dominantBaseline="middle">{view ? 'none' : ''}</text>
        )}
        <text
          {...text} fontSize={11.5} x={W - 10} y={CY} textAnchor="middle"
          transform={`rotate(-90 ${W - 10} ${CY})`}
        >
          {fq.label}, {fq.unit}
          {colour === 'eff'
            ? ` (${nWorst > 1 ? `worst of ${nWorst} frequencies, ` : ''}Vcc = ${VCC} V)`
            : nWorst > 1 ? ` (${fq.worst} of ${nWorst} frequencies)` : ''}
        </text>
      </g>

      {/* Contour legend: a column per frequency, a row per level. */}
      {(
        <g>
          <rect x={8} y={legendTop} width={LEGEND_W} height={contourH} rx={4} fill="none" stroke={pal.chart.grid} />
          <text {...text} fontSize={11.5} x={W / 2} y={legendTop + 8 + 10} textAnchor="middle">
            {cq.label} contours (colour = frequency, line style = level)
          </text>
          {levels.length === 0 && (
            <text
              {...text} fill={dim} fontSize={11} x={W / 2} textAnchor="middle" dominantBaseline="middle"
              y={legendTop + 8 + ROW + (contourH - 8 - ROW - 6) / 2}
            >
              {view ? `Set a ${cq.inline} limit to draw its contours` : ''}
            </text>
          )}
          {fieldPts.map((_, fi) => {
            const col = fi % cols
            const blk = Math.floor(fi / cols)
            const cw = (LEGEND_W - 16) / cols
            const x0 = 16 + col * cw
            return levels.map((l, li) => {
              const y = legendTop + 8 + ROW + (blk * MAX_LEVELS + li) * ROW + 9
              const none = contours[fi][li].lines.length === 0
              return (
                <g key={`lg${fi}-${li}`} opacity={none ? 0.55 : 1}>
                  <line
                    x1={x0} x2={x0 + 26} y1={y} y2={y} stroke={freqColor(fieldFreqs[fi])}
                    strokeWidth={1.1} strokeDasharray={l.dash} strokeLinecap="round"
                  />
                  <text {...text} fontSize={11} x={x0 + 33} y={y} dominantBaseline="middle">
                    {cq.label} = {num(l.v)} {cq.unit}{fieldFreqs[fi] != null ? ` @ ${num(fieldFreqs[fi]!)} MHz` : ''}{none ? ' (none)' : ''}
                  </text>
                </g>
              )
            })
          })}
        </g>
      )}

      {/* Key. */}
      <g>
        <rect x={8} y={keyTop} width={LEGEND_W} height={keyH} rx={4} fill="none" stroke={pal.chart.grid} />
        {([
          ['fill', `Allowed region, colour = ${fq.inline}`],
          ['edge', 'Boundary of measured area'],
          ['centre', '50 Ω (chart centre)'],
          ['star', best && optimum ? `Optimum Zopt = ${fmtZopt(optimum)}`
            : view ? 'Optimum: no load meets the limits' : 'Optimum Zopt'],
          ['dot', 'Measured tuner states'],
        ] as const).map(([kind, label], i) => {
          const cw = (LEGEND_W - 16) / 3
          const x0 = 16 + (i % 3) * cw
          const y = keyTop + 8 + Math.floor(i / 3) * ROW + 9
          return (
            <g key={kind}>
              {kind === 'fill' && <rect x={x0} y={y - 5} width={24} height={10} rx={1.5} fill={rampColor(0.55)} />}
              {kind === 'edge' && <line x1={x0} x2={x0 + 24} y1={y} y2={y} stroke={dim} strokeDasharray="7 3 1.5 3" />}
              {kind === 'centre' && <path d={`M${x0 + 6} ${y}H${x0 + 18}M${x0 + 12} ${y - 6}V${y + 6}`} stroke={ink} strokeWidth={1.2} />}
              {kind === 'star' && <polygon points={star(x0 + 12, y, 7)} fill="#F05A28" stroke={ink} strokeWidth={0.8} />}
              {kind === 'dot' && <circle cx={x0 + 12} cy={y} r={2} fill={dim} />}
              <text {...text} fontSize={11} x={x0 + 31} y={y} dominantBaseline="middle">{label}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
})
