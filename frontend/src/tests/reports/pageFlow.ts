/**
 * The report laid out on A4 sheets, as Word's print layout shows it.
 *
 * Blocks flow down a page until the next one does not fit, then start the
 * next page; the cover is a page of its own, and a page break ends its page.
 * A block taller than a page is not split (the editor cannot split a table
 * the way Word does) -- its page grows to hold it, and Word will carry the
 * rest over when it prints.
 *
 * The blocks stay one column in the DOM: a page boundary is a spacer before
 * the block that opens the next page, and the sheets are drawn behind. So a
 * block that moves to the next page is not re-mounted, and text being typed
 * keeps its focus while its block grows.
 */
import { useEffect, useRef, useState } from 'react'

/** A4 at 96 dpi; the margins are 2.54 cm. */
export const SHEET = { width: 794, height: 1123, margin: 96, gap: 28 } as const
export const BODY_H = SHEET.height - 2 * SHEET.margin

export interface FlowBlock {
  id: string
  /** Starts a page of its own and ends it (the cover). */
  ownPage?: boolean
  /** Ends its page (a page break). */
  breakAfter?: boolean
  /** Stays on the page of the block after it (a heading), as Word's
   *  "keep with next" does: a heading alone at the foot of a page, its table
   *  on the next, reads as a mistake. */
  keepWithNext?: boolean
}

export interface Sheet {
  top: number
  height: number
  /** The page opens with the cover: no header logo, no page number. */
  cover: boolean
}

export interface Flow {
  sheets: Sheet[]
  /** Space to leave before each block (0 for most). */
  spacer: Map<string, number>
  /** The column's full height, sheets and gaps included. */
  height: number
}

/**
 * `heights` are the blocks' measured heights; a block not measured yet
 * counts as `fallback`. `tail` is what follows the last block on its page
 * (the "Add component" key).
 */
export function layoutPages(blocks: FlowBlock[], heights: Map<string, number>, tail = 0, fallback = 60): Flow {
  const sheets: Sheet[] = []
  const spacer = new Map<string, number>()
  let top = 0          // the current sheet's top
  let used = 0         // body height used on it
  let cover = false    // the current sheet opens with the cover
  let forceNext = false

  const close = () => {
    const h = Math.max(SHEET.height, SHEET.margin * 2 + used)
    sheets.push({ top, height: h, cover })
    return h
  }

  // The blocks on the current page, for carrying headings over with the
  // block they introduce.
  let onPage: Array<{ id: string; h: number; keep: boolean }> = []

  blocks.forEach((b, i) => {
    const h = heights.get(b.id) ?? fallback
    const forced = forceNext || (!!b.ownPage && used > 0)
    const overflow = !forced && used > 0 && used + h > BODY_H
    if (i > 0 && (forced || overflow)) {
      // Headings just above a block that no longer fits go with it, unless
      // that would leave their page empty.
      const carried: typeof onPage = []
      if (overflow) {
        while (onPage.length > 1 && onPage[onPage.length - 1].keep) carried.unshift(onPage.pop()!)
      }
      const carriedH = carried.reduce((t, c) => t + c.h, 0)
      used -= carriedH
      const ph = close()
      const opens = carried[0]?.id ?? b.id
      spacer.set(opens, ph - SHEET.margin - used + SHEET.gap + SHEET.margin)
      top += ph + SHEET.gap
      used = carriedH
      onPage = carried
      cover = false
    }
    if (used === 0) cover = !!b.ownPage
    used += h
    onPage.push({ id: b.id, h, keep: !!b.keepWithNext })
    forceNext = !!b.ownPage || !!b.breakAfter
  })
  used += tail
  const last = close()
  return { sheets, spacer, height: top + last }
}

/**
 * Heights of the elements registered with `measure(id)`, kept current by
 * one ResizeObserver: a block that grows as it is typed into, or a picture
 * that loads, moves the page boundaries after it at once.
 */
export function useBlockHeights() {
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map())
  const els = useRef(new Map<string, HTMLElement>())
  const ids = useRef(new WeakMap<Element, string>())
  const observer = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Map<string, number> | null = null
        for (const en of entries) {
          const id = ids.current.get(en.target)
          if (!id) continue
          const h = Math.round((en.target as HTMLElement).offsetHeight)
          if (prev.get(id) !== h) {
            next ??= new Map(prev)
            next.set(id, h)
          }
        }
        return next ?? prev
      })
    })
    observer.current = ro
    for (const el of els.current.values()) ro.observe(el)
    return () => { ro.disconnect(); observer.current = null }
  }, [])

  const measure = (id: string) => (el: HTMLElement | null) => {
    const old = els.current.get(id)
    if (old && old !== el) observer.current?.unobserve(old)
    if (el) {
      els.current.set(id, el)
      ids.current.set(el, id)
      observer.current?.observe(el)
    } else {
      els.current.delete(id)
    }
  }
  return { heights, measure }
}
