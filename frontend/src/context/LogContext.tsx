import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LogEntriesContext } from './logEntries'

const STORAGE_KEY = 'log-entries-v1'

export type LogSource =
  | 'DUT'
  | 'Power Sensor'
  | 'DC Analyzer'
  | 'Spectrum'
  | 'Motor'
  | 'Sweep'
  | 'System'
  | 'Automation'
  | 'LoadPull'
  | 'Switch'
  | 'Servo'
  | 'VNA'
  | 'Signal Gen'

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  source: LogSource
  msg: string
}

interface LogCtx {
  log: (source: LogSource, msg: string, level?: LogEntry['level']) => void
  clear: () => void
}

/*
 * Two contexts: the actions, which never change, and the entries, which
 * change at every line. Every page logs, so every page read the one context
 * that held both -- and each log line re-rendered all of them. At start-up,
 * pages logging as they mounted made that a cascade (hundreds of ms per page
 * by the last); during a run, each line of it redrew every page. Only the
 * log panel reads the entries.
 */
const Ctx = createContext<LogCtx | null>(null)

const MAX = 500

export function LogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as LogEntry[]) : []
    } catch {
      return []
    }
  })

  // Saved once the lines stop for a moment, not at each: a run logs many
  // lines a second, and each save serialised up to 500 entries.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
      } catch {
        /* quota / private mode */
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [entries])

  const log = useCallback((source: LogSource, msg: string, level: LogEntry['level'] = 'info') => {
    const ts = new Date().toLocaleTimeString([], { hour12: false })
    setEntries((prev) => {
      const next = [...prev, { ts, level, source, msg }]
      return next.length > MAX ? next.slice(next.length - MAX) : next
    })
  }, [])
  const clear = useCallback(() => {
    setEntries([])
    try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
  }, [])
  const value = useMemo(() => ({ log, clear }), [log, clear])
  return (
    <Ctx.Provider value={value}>
      <LogEntriesContext.Provider value={entries}>{children}</LogEntriesContext.Provider>
    </Ctx.Provider>
  )
}

/** Log and clear. Stable: reading this never re-renders on a new line. */
export function useLog(): LogCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLog must be inside LogProvider')
  return v
}
