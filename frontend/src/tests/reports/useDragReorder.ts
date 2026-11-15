/**
 * Drag a block by its handle to a new place in the report.
 *
 * Direct manipulation, as the apple-design notes have it: the block follows
 * the pointer 1:1 from where it was grabbed (pointer capture, so it keeps
 * tracking off the handle), the others slide aside as it passes their
 * middles, and past the first or last block it resists rather than stopping
 * dead. On release it glides into its slot and only then is the order
 * committed, so the DOM reorders under a block that is already where it
 * belongs -- no jump. With reduced motion it drops straight in.
 */
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const SETTLE_MS = 220
const SHIFT_MS = 200

function rubberband(over: number, dim: number, c = 0.55): number {
  return (over * dim * c) / (dim + c * Math.abs(over))
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

interface Drag {
  id: string
  from: number
  to: number
  dy: number
  settling: boolean
  /** Where every block stood when the drag began. */
  tops: number[]
  heights: number[]
  gap: number
}

export function useDragReorder(ids: string[], onCommit: (from: number, to: number) => void) {
  const els = useRef(new Map<string, HTMLElement>())
  const startY = useRef(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const set = (d: Drag | null) => { dragRef.current = d; setDrag(d) }

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el)
    else els.current.delete(id)
  }

  const onPointerDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || dragRef.current) return
    const from = ids.indexOf(id)
    const rects = ids.map((i) => els.current.get(i)?.getBoundingClientRect())
    if (from < 0 || rects.some((r) => !r)) return
    e.preventDefault()
    // Capture keeps the drag tracking off the handle. It throws for a pointer
    // the browser does not consider active (a synthetic one); the drag still
    // works without it while the pointer stays over the handle.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* see above */ }
    const tops = rects.map((r) => r!.top)
    const heights = rects.map((r) => r!.height)
    const gap = ids.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0
    startY.current = e.clientY
    set({ id, from, to: from, dy: 0, settling: false, tops, heights, gap })
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d || d.settling) return
    const { tops, heights } = d
    const last = tops.length - 1
    const lo = tops[0] - tops[d.from]
    const hi = tops[last] + heights[last] - (tops[d.from] + heights[d.from])
    let dy = e.clientY - startY.current
    if (dy < lo) dy = lo - rubberband(lo - dy, 400)
    if (dy > hi) dy = hi + rubberband(dy - hi, 400)
    const centre = tops[d.from] + heights[d.from] / 2 + dy
    let to = 0
    for (let i = 0; i < tops.length; i++) {
      if (i !== d.from && tops[i] + heights[i] / 2 < centre) to++
    }
    set({ ...d, dy, to })
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (!d || d.settling) return
    const { tops, heights } = d
    // Where the block will sit once the order is committed.
    const slotTop = d.to > d.from
      ? tops[d.to] + heights[d.to] - heights[d.from]
      : tops[d.to]
    const settle = slotTop - tops[d.from]
    const finish = () => {
      if (d.to !== d.from) onCommit(d.from, d.to)
      set(null)
    }
    if (reducedMotion()) { finish(); return }
    set({ ...d, dy: settle, settling: true })
    window.setTimeout(finish, SETTLE_MS)
  }

  const handleProps = (id: string) => ({
    onPointerDown: onPointerDown(id),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  })

  /** The transform for each block while one is being dragged. */
  const styleFor = (id: string): CSSProperties => {
    if (!drag) return {}
    const m = drag
    const i = ids.indexOf(id)
    const still = reducedMotion()
    if (id === drag.id) {
      return {
        transform: `translateY(${drag.dy}px)`,
        transition: drag.settling && !still ? `transform ${SETTLE_MS}ms ${EASE}` : 'none',
        zIndex: 3, position: 'relative',
      }
    }
    const step = m.heights[drag.from] + m.gap
    let shift = 0
    if (drag.to > drag.from && i > drag.from && i <= drag.to) shift = -step
    if (drag.to < drag.from && i >= drag.to && i < drag.from) shift = step
    return {
      transform: shift ? `translateY(${shift}px)` : undefined,
      transition: still ? 'none' : `transform ${SHIFT_MS}ms ${EASE}`,
    }
  }

  return { register, handleProps, styleFor, draggingId: drag?.id ?? null, settling: !!drag?.settling }
}
