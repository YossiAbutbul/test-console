/**
 * Constants and the add-row focus hook for the sweep panels' layout kit
 * (AutomationKit.tsx). Apart from the components so that file stays
 * components-only, which fast refresh needs.
 */
import { createContext, useEffect, useRef } from 'react'
import { CONTROL_H, scrollBehavior } from '../../ui'

/**
 * The sweep card grows with its rows up to `PANEL_HEIGHT`, then scrolls
 * inside. A fixed 250 left ~90 px of empty card under a one-row sweep that
 * Results wanted. The floor holds two rows, so adding or removing the
 * second row does not move the footer or the Results card under it.
 */
export const PANEL_HEIGHT = 250
export const PANEL_MIN_HEIGHT = 200

/**
 * Space between a panel's groups (Sweep, Measure) when it is a Test Sequence
 * step's editor. Wider than the page's GRID_GAP: there the groups are bordered
 * cards that separate themselves; flat inside a step, only space does.
 */
export const EDITOR_GAP = 24

/**
 * Where a compact Sweep card puts its heading keys (point count, settings,
 * Add): a node in the row above it, such as a Test Sequence step's tab row,
 * so the keys share that line instead of taking one of their own. Absent, the
 * card keeps them in its own heading. The same portal-slot idea as the window
 * toolbar's (ui/toolbarSlot.ts).
 */
export const SweepActionsSlot = createContext<HTMLElement | null>(null)

/**
 * True inside a compact Sweep card. Its rows then drop their "1." -- a Test
 * Sequence step's sweep is a row or two, and the number only pushed the
 * table in from the edge every other tab's fields start at.
 */
export const SweepCompactContext = createContext(false)

/** A row template without its leading index track (every panel's `COLS`
 *  starts with it), for a compact sweep. */
export const withoutIndex = (cols: string): string => cols.replace(/^\S+\s+/, '')

/** A settle above this is almost always a typo (500 → 50000). */
export const LONG_SETTLE_MS = 10_000

/** Budget for the command + measurement either side of the settle delay. */
export const STEP_OVERHEAD_TIMEOUT_MS = 30_000

/** One line box for every body cell. The word cells (PA, Verdict, Status) are
 *  in the proportional face and the numbers in MONO, and with each cell
 *  keeping its own font's line height the two sat 1-2 px apart along a row. */
export const BODY_ROW_SX = { '& > td': { verticalAlign: 'middle', lineHeight: '20px' } } as const

/** The sweep rows' input height. */
export const CELL_SX = { '& .MuiInputBase-root': { height: CONTROL_H.md } } as const

/**
 * Focus the first field of a row the operator just added, and scroll the
 * sweep to it. `request` is called by Add with the index the row will land
 * at; the effect acts once the row is rendered.
 *
 * A ref, not state: the effect only needs to know which row to focus once,
 * and holding it in state would mean clearing it from inside that effect for
 * nothing.
 */
export function useAddRowFocus(rowCount: number) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const pending = useRef<number | null>(null)
  // Runs when a row is added or removed; only acts when Add asked it to.
  useEffect(() => {
    const idx = pending.current
    if (idx == null) return
    pending.current = null
    inputRefs.current[idx]?.focus()
    const body = bodyRef.current
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: scrollBehavior() })
  }, [rowCount])
  return {
    bodyRef,
    /** Pass as the first field's `inputRef`. */
    inputRef: (i: number) => (el: HTMLInputElement | null) => { inputRefs.current[i] = el },
    request: (i: number) => { pending.current = i },
  }
}

