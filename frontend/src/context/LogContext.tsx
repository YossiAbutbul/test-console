import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  source: LogSource
  msg: string
}

interface LogCtx {
  entries: LogEntry[]
  log: (source: LogSource, msg: string, level?: LogEntry['level']) => void
  clear: () => void
}

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

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    } catch {
      /* quota / private mode */
    }
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
  const value = useMemo(() => ({ entries, log, clear }), [entries, log, clear])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLog(): LogCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLog must be inside LogProvider')
  return v
}
