import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  msg: string
}

interface LogCtx {
  entries: LogEntry[]
  log: (msg: string, level?: LogEntry['level']) => void
  clear: () => void
}

const Ctx = createContext<LogCtx | null>(null)

const MAX = 500

export function LogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const log = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    const ts = new Date().toLocaleTimeString([], { hour12: false })
    setEntries((prev) => {
      const next = [...prev, { ts, level, msg }]
      return next.length > MAX ? next.slice(next.length - MAX) : next
    })
  }, [])
  const clear = useCallback(() => setEntries([]), [])
  const value = useMemo(() => ({ entries, log, clear }), [entries, log, clear])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLog(): LogCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLog must be inside LogProvider')
  return v
}
