import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { scrollBehavior } from './feel'

/** How near the bottom still counts as "at the newest row", in px: a scroll
 *  that ends a few pixels short (fractional row heights, zoom) still follows. */
const AT_BOTTOM_PX = 8

/** Keys that scroll a list up when it has focus. */
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

export interface FollowBottom {
  /** Rows that landed since the operator scrolled up; 0 while following. */
  unseen: number
  /** Back to the newest row, following again. */
  jump: () => void
}

/**
 * Keep a results list on its newest row while the operator is watching it
 * there, and leave it alone once they have scrolled up to read an older one.
 *
 * Every table used to scroll to the bottom on each new row, so during a run
 * it was impossible to read anything above: each point yanked the view back
 * down. Following now stops when the operator scrolls up and resumes when
 * they scroll back to the bottom (or press the pill) -- the way a terminal or
 * a chat does. A list that gets shorter (Clear, an import) follows again.
 * `FollowLatest` is the pill.
 *
 * Only the operator's own hand stops it -- a wheel, a key, a drag on the
 * scrollbar or a touch -- never the scroll position alone. The position also
 * moves on its own: a smooth scroll to the last row that is cut short, the
 * windowed table's height settling once its rows are measured, the browser
 * clamping after a resize. Read as "the operator scrolled up", any of those
 * stopped the following with nobody touching the table (seen in the demo).
 *
 * `ref` is the scrolling element, mounted for the life of the component.
 */
export function useFollowBottom(ref: RefObject<HTMLElement | null>, count: number): FollowBottom {
  const followRef = useRef(true)
  const lastCountRef = useRef(count)
  const [unseen, setUnseen] = useState(0)

  const follow = useCallback(() => {
    followRef.current = true
    setUnseen(0)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let pressed = false
    let lastTop = el.scrollTop
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX
    const leave = () => {
      if (el.scrollTop > 0 || el.scrollHeight > el.clientHeight) followRef.current = false
    }
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) leave() }
    const onKey = (e: KeyboardEvent) => { if (UP_KEYS.has(e.key)) leave() }
    const onPress = () => { pressed = true }
    const onRelease = () => { pressed = false }
    const onScroll = () => {
      const top = el.scrollTop
      // A drag on the scrollbar or a touch pan sends no wheel: upwards
      // while held is the operator.
      if (pressed && top < lastTop - 1) followRef.current = false
      else if (atBottom()) follow()
      lastTop = top
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('keydown', onKey)
    el.addEventListener('pointerdown', onPress)
    el.addEventListener('touchstart', onPress, { passive: true })
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('touchend', onRelease)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('pointerdown', onPress)
      el.removeEventListener('touchstart', onPress)
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('touchend', onRelease)
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref, follow])

  useEffect(() => {
    const prev = lastCountRef.current
    lastCountRef.current = count
    if (count < prev) follow()
    const el = ref.current
    if (!el) return
    if (!followRef.current) {
      if (count > prev) setUnseen((n) => n + count - prev)
      return
    }
    // A page in the background does not run smooth scrolls; jump there, so
    // the table is on its newest row when the page is shown again.
    el.scrollTo({ top: el.scrollHeight, behavior: document.hidden ? 'auto' : scrollBehavior() })
  }, [ref, count, follow])

  const jump = useCallback(() => {
    follow()
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() })
  }, [ref, follow])

  return { unseen, jump }
}
