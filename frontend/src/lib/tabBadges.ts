/**
 * Sidebar tab badges: how many things happened on a page while it was not on
 * screen, coloured by the worst of them. Opening the page clears its badge.
 *
 * Pure, so the rules are tested apart from React (TabBadgesContext.tsx holds
 * the state).
 */

/**
 * What happened, worst first:
 * - error:     a run failed, or finished with a FAIL
 * - attention: a run needs the operator, finished with errors, or stopped
 * - success:   a run finished, all PASS (or nothing to judge)
 * - info:      something new arrived (a run added to a report)
 */
export type BadgeStatus = 'error' | 'attention' | 'success' | 'info'

export interface Badge {
  count: number
  status: BadgeStatus
}

export type Badges = Readonly<Record<string, Badge>>

const RANK: Record<BadgeStatus, number> = { error: 3, attention: 2, success: 1, info: 0 }

/** The worse of two statuses: a red stays red until the page is opened. */
export function worse(a: BadgeStatus, b: BadgeStatus): BadgeStatus {
  return RANK[a] >= RANK[b] ? a : b
}

/** One more event on `page`. Nothing for the page on screen: the operator is
 *  looking at it. */
export function raise(badges: Badges, page: string, status: BadgeStatus, activePage: string): Badges {
  if (!page || page === activePage) return badges
  const prev = badges[page]
  return {
    ...badges,
    [page]: prev ? { count: prev.count + 1, status: worse(prev.status, status) } : { count: 1, status },
  }
}

/** The page was opened: its badge goes. */
export function clear(badges: Badges, page: string): Badges {
  if (!badges[page]) return badges
  const next = { ...badges }
  delete next[page]
  return next
}

/** Several pages as one (a folded sidebar section): counts add up, the
 *  colour is the worst. Null when none of them has a badge. */
export function combine(badges: Badges, pages: string[]): Badge | null {
  let out: Badge | null = null
  for (const p of pages) {
    const b = badges[p]
    if (!b) continue
    out = out ? { count: out.count + b.count, status: worse(out.status, b.status) } : { ...b }
  }
  return out
}

/** The number on the circle: up to 99, then "99+". */
export function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(Math.max(0, Math.floor(count)))
}
