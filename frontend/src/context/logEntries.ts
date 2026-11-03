import { createContext, useContext } from 'react'
import type { LogEntry } from './LogContext'

/**
 * The log's entries, apart from its actions (see LogProvider): it changes at
 * every line, so only what shows the lines -- the log panel -- reads it.
 * Its own file so LogContext.tsx keeps to components for fast refresh.
 */
export const LogEntriesContext = createContext<LogEntry[]>([])

/** The log's entries, for the panel that shows them. Re-renders at every line. */
export function useLogEntries(): LogEntry[] {
  return useContext(LogEntriesContext)
}
