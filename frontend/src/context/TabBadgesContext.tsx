/**
 * Sidebar tab badges: the provider (tabBadges.ts has the contexts and hooks,
 * lib/tabBadges.ts the rules).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clear, raise, type Badges, type BadgeStatus } from '../lib/tabBadges'
import { TabBadgeActionsContext, TabBadgesContext } from './tabBadges'

export function TabBadgesProvider({ activePage, children }: { activePage: string; children: ReactNode }) {
  const [badges, setBadges] = useState<Badges>({})

  // Opening a page is seeing what happened on it. Cleared while rendering,
  // as React documents for state that follows a prop, so the badge never
  // shows for a frame on the page just opened.
  const [seen, setSeen] = useState(activePage)
  if (seen !== activePage) {
    setSeen(activePage)
    setBadges((b) => clear(b, activePage))
  }

  // Read when an event arrives, not captured: a run that ends after the
  // operator moved away must badge the page it ran on.
  const active = useRef(activePage)
  useEffect(() => { active.current = activePage }, [activePage])

  const raiseOn = useCallback((page: string, status: BadgeStatus) => {
    setBadges((b) => raise(b, page, status, active.current))
  }, [])
  const actions = useMemo(() => ({ raise: raiseOn }), [raiseOn])

  return (
    <TabBadgeActionsContext.Provider value={actions}>
      <TabBadgesContext.Provider value={badges}>{children}</TabBadgesContext.Provider>
    </TabBadgeActionsContext.Provider>
  )
}
