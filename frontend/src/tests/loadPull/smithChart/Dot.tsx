import { memo, useSyncExternalStore } from 'react'
import type { CursorStore } from './cursorStore'

/**
 * One plotted point.
 *
 * Memoised, as is ListRow: the dialog stays open through a run to watch it
 * live, and each new row used to rebuild every dot and every list row --
 * 233 ms a row at 890 rows, and growing -- which piled garbage on a tab that
 * then crashed mid-run. Now a new row adds one dot, and the rest re-render
 * only when their own colour or hover changes.
 */
export const Dot = memo(function Dot({
  x, y, idx, r, fill, stroke, hoverStroke, hovered, onPick,
}: {
  x: number; y: number; idx: number; r: number; fill: string; stroke: string; hoverStroke: string
  /** The hovered point, held outside React state: see the dialog's
   *  `hoverStore`. Each dot asks only whether it is the one. */
  hovered: CursorStore
  onPick: (idx: number) => void
}) {
  const hover = useSyncExternalStore(hovered.subscribe, () => hovered.get() === idx)
  return (
    <circle
      cx={x} cy={y}
      r={hover ? r + 2.5 : r}
      fill={fill}
      stroke={hover ? hoverStroke : stroke}
      strokeWidth={hover ? 2 : 0.8}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => hovered.set(idx)}
      onDoubleClick={() => onPick(idx)}
    />
  )
})
