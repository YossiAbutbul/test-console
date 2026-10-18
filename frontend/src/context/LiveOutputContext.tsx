import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ActionsCtx, StateCtx, same, type LiveOutput } from './liveOutput'

/**
 * Provider for the live-output pills. The types and hooks live in
 * `./liveOutput`, so this file exports only a component (fast refresh).
 */
export function LiveOutputProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, LiveOutput>>({})

  const publish = useCallback((key: string, value: LiveOutput | null) => {
    setEntries((prev) => {
      // Unchanged updates keep the same object, so a page republishing the
      // same reading on every poll does not re-render the top bar.
      if (same(prev[key], value)) return prev
      const next = { ...prev }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }, [])

  const actions = useMemo(() => ({ publish }), [publish])

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={entries}>{children}</StateCtx.Provider>
    </ActionsCtx.Provider>
  )
}

