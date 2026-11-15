/**
 * A component's width, set by dragging its edge.
 *
 * Direct manipulation, as the apple-design notes have it: the edge follows
 * the pointer 1:1 from where it was grabbed (pointer capture keeps it
 * tracking off the handle), a badge says the width as it changes, it settles
 * onto the widths a layout reaches for (a quarter, a third, a half, two
 * thirds, three quarters, full) when it passes close by, and past its
 * smallest or largest it resists rather than stopping dead, then settles
 * back on release.
 *
 * Widths are a share of the text width, as the Word file prints them. A
 * centred component (a picture) grows from both edges, so either handle
 * moves both; a left-aligned one (a table, a paragraph) from its right edge.
 */
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { REDUCED_MOTION } from '../../ui'

const SNAPS = [25, 33, 50, 66, 75, 100]
const SNAP_PX = 6

function rubberband(over: number, dim: number, c = 0.55): number {
  return (over * dim * c) / (dim + c * Math.abs(over))
}

export function Resizable({ width, onResize, align = 'left', min = 20, children }: {
  /** Percent of the text width. */
  width: number
  /** `start` is called once as a drag begins (so it can be undone in one
   *  step), then the width as it changes, then the settled width. */
  onResize: (width: number, phase: 'start' | 'move' | 'end') => void
  align?: 'left' | 'center'
  min?: number
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; w: number; full: number; side: 1 | -1 } | null>(null)
  const [live, setLive] = useState<number | null>(null)

  const down = (side: 1 | -1) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const full = box.current?.parentElement?.getBoundingClientRect().width ?? 0
    if (!full) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* see useDragReorder */ }
    drag.current = { x: e.clientX, w: width, full, side }
    onResize(width, 'start')
    setLive(width)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // A centred block moves both edges, so the pointer's travel counts twice.
    const per = (align === 'center' ? 2 : 1) * d.side * 100 / d.full
    let w = d.w + (e.clientX - d.x) * per
    // Past the ends it follows less and less (rubber band).
    if (w > 100) w = 100 + rubberband(w - 100, 60)
    if (w < min) w = min - rubberband(min - w, 60)
    // Settle onto a common width when passing within a few pixels of it.
    const near = SNAPS.find((sn) => Math.abs(sn - w) * d.full / 100 < SNAP_PX)
    if (near !== undefined) w = near
    setLive(w)
    onResize(Math.round(Math.min(100, Math.max(min, w))), 'move')
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    const w = Math.round(Math.min(100, Math.max(min, live ?? width)))
    setLive(null)
    onResize(w, 'end')
  }

  const shown = live ?? width
  const handle = (side: 1 | -1) => (
    <Box
      className="blk-chrome"
      role="slider"
      aria-label="Width"
      aria-valuemin={min}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, Math.max(min, shown)))}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1
        const by = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
        if (!by) return
        e.preventDefault()
        onResize(Math.min(100, Math.max(min, width + by * side)), 'start')
      }}
      onPointerDown={down(side)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      sx={(t) => ({
        position: 'absolute', top: '50%', [side === 1 ? 'right' : 'left']: -7, zIndex: 3,
        width: 8, height: 40, mt: '-20px', borderRadius: 4, cursor: 'ew-resize', touchAction: 'none',
        bgcolor: '#FFFFFF', border: `1.5px solid ${t.palette.primary.main}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        transition: 'transform 100ms ease-out',
        '&:hover, &:focus-visible': { transform: 'scaleY(1.15)', outline: 'none' },
        [REDUCED_MOTION]: { transition: 'none' },
      })}
    />
  )

  return (
    <Box ref={box} sx={{ position: 'relative', width: `${Math.min(100, Math.max(min, shown))}%`, mx: align === 'center' ? 'auto' : 0 }}>
      {children}
      {handle(1)}
      {align === 'center' && handle(-1)}
      {live !== null && (
        <Box sx={(t) => ({
          position: 'absolute', top: -30, right: 0, zIndex: 4, px: 1, py: 0.25, borderRadius: '6px',
          bgcolor: t.palette.primary.main, color: '#FFFFFF', fontSize: 12, fontWeight: 600,
          fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        })}>
          {Math.round(Math.min(100, Math.max(min, shown)))}%
        </Box>
      )}
    </Box>
  )
}
