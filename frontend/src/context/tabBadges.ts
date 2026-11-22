/**
 * Sidebar tab badges: the contexts and hooks (TabBadgesContext.tsx is the
 * provider; lib/tabBadges.ts has the rules). Its own file so the provider's
 * keeps to components for fast refresh, as logEntries.ts does for the log.
 *
 * Two contexts: the actions, which never change, and the badges, which change
 * at each event. Every page raises badges through its run reporter, and only
 * the sidebar reads them; one context for both would re-render every mounted
 * page whenever any badge changed.
 */
import { createContext, useCallback, useContext, useEffect } from 'react'
import type { Badges, BadgeStatus } from '../lib/tabBadges'

export interface TabBadgeActions {
  /** One event on `page`; nothing if that page is on screen. */
  raise: (page: string, status: BadgeStatus) => void
}

export const TabBadgeActionsContext = createContext<TabBadgeActions | null>(null)
export const TabBadgesContext = createContext<Badges>({})

/** The id of the page a component is mounted in (testRegistry's `id`), set
 *  by App's PageSlot, so a reporter deep in a page badges the right tab
 *  without being handed it. */
export const PageIdContext = createContext<string>('')

/** Every page's badge, for the sidebar. */
export function useTabBadges(): Badges {
  return useContext(TabBadgesContext)
}

/**
 * Raise a badge: on this page by default, or on another by id (a run added
 * to a report badges Product reports). Outside the provider -- a component
 * rendered in a test -- it does nothing.
 */
export function usePageBadge(): (status: BadgeStatus, page?: string) => void {
  const actions = useContext(TabBadgeActionsContext)
  const own = useContext(PageIdContext)
  return useCallback(
    (status: BadgeStatus, page?: string) => actions?.raise(page ?? own, status),
    [actions, own],
  )
}

/** While `waiting` is true the page is waiting on the operator (a prompt mid
 *  run): one amber event on its tab each time it starts waiting. */
export function useNeedsUserBadge(waiting: boolean): void {
  const badge = usePageBadge()
  useEffect(() => {
    if (waiting) badge('attention')
  }, [waiting, badge])
}
