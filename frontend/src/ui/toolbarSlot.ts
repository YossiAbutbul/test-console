import { createContext, useContext } from 'react'

/**
 * Where a page's title and header keys go: the window toolbar above the
 * content, which the shell owns and the page fills.
 *
 * A portal target rather than a prop the shell reads back: every page mounts
 * at start-up and keeps its own state (see TestArea), and its header keys are
 * wired to that state -- Run to the page's own mutation, E-STOP to its own
 * abort controller. Lifting them into the shell would mean lifting the state
 * too. The page renders them where they always were in its tree; only the DOM
 * lands in the toolbar.
 *
 * Three targets, not one. The title and the keys are separate slots with a
 * slot for transient status between them: in a single slot, status appearing
 * pushed the keys left -- the RF ON pill (since removed) moved RF Off 245 px
 * at the moment the operator reached for it. Status takes its room from the
 * title and the keys stay pinned to the edge.
 * `bar` is the toolbar itself, for the run progress line along its bottom.
 */
export interface ToolbarSlots {
  bar: HTMLElement | null
  title: HTMLElement | null
  actions: HTMLElement | null
}

export const ToolbarSlotContext = createContext<ToolbarSlots>({ bar: null, title: null, actions: null })

/**
 * Whether this page is the one on screen. Only the page on screen may fill the
 * toolbar: every page is mounted, and a hidden one portalling its header would
 * stack fourteen titles in one bar.
 */
export const PageActiveContext = createContext(false)

export function useToolbarSlot(): ToolbarSlots {
  return useContext(ToolbarSlotContext)
}

export function usePageActive(): boolean {
  return useContext(PageActiveContext)
}
