import { memo, useId } from 'react'
import { useTheme } from '@mui/material/styles'
import { useAppPalette } from '../../context/ThemeModeContext'
import { Z0 } from './smith'

/** The constant-R circles and constant-X arcs, by their value in ohms. */
const GRID_OHMS = [10, 25, 50, 100, 250]

/**
 * The Smith chart's grid as a report draws it: hairline constant-R circles
 * and constant-X arcs, the resistances labelled along the real axis and the
 * reactances round the rim, the rim itself, and a cross at Z0.
 *
 * Shared by the point chart and the working-area figure so the two read as
 * one chart. Memoised and data-free: during a run new points arrive every
 * few seconds and none of this needs drawing again.
 */
export const SmithGrid = memo(function SmithGrid({
  cx, cy, R, grid,
}: {
  cx: number
  cy: number
  R: number
  /** The circles and their labels; the rim, the axis and Z0 always show. */
  grid: boolean
}) {
  const pal = useAppPalette()
  const font = String(useTheme().typography.fontFamily)
  const clipId = useId().replace(/:/g, '')
  const ink = pal.sidebar.text
  const dim = pal.sidebar.textDim
  const label = { fontFamily: font, fill: dim, fontSize: 10.5 } as const
  return (
    <g>
      <defs><clipPath id={clipId}><circle cx={cx} cy={cy} r={R} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`} fill="none" stroke={pal.chart.grid} strokeWidth={0.8}>
        {grid && GRID_OHMS.map((o) => {
          const r = o / Z0
          return <circle key={`r${o}`} cx={cx + (r / (1 + r)) * R} cy={cy} r={R / (1 + r)} />
        })}
        {grid && GRID_OHMS.flatMap((o) => [o, -o]).map((o) => {
          const x = o / Z0
          return <circle key={`x${o}`} cx={cx + R} cy={cy - R / x} r={Math.abs(R / x)} />
        })}
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} />
      </g>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={ink} strokeWidth={1.2} />

      {grid && GRID_OHMS.map((o) => {
        const r = o / Z0
        return (
          <text key={`rl${o}`} {...label} x={cx + ((r - 1) / (r + 1)) * R - 3} y={cy - 4} textAnchor="end">
            {o}
          </text>
        )
      })}
      {grid && GRID_OHMS.flatMap((o) => [o, -o]).map((o) => {
        const x = o / Z0
        const gr = (x * x - 1) / (x * x + 1)
        const gi = (2 * x) / (x * x + 1)
        return (
          <text
            key={`xl${o}`} {...label}
            x={cx + gr * (R + 13)} y={cy - gi * (R + 13)} textAnchor="middle" dominantBaseline="middle"
          >
            {o > 0 ? '+' : '−'}j{Math.abs(o)}
          </text>
        )
      })}

      <path d={`M${cx - 6} ${cy}H${cx + 6}M${cx} ${cy - 6}V${cy + 6}`} stroke={ink} strokeWidth={1.2} />
    </g>
  )
})
