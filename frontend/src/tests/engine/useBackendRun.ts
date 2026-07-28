/**
 * Lifecycle reporting for tests whose loop runs on the backend.
 *
 * The browser only polls `/test/status`, so there is no local loop to hang
 * announcements off. This watches the polled run state and fires the same
 * `RunReporter` calls that `runSequence` fires for in-browser sweeps.
 */
import { useEffect, useRef } from 'react'
import type { RunState } from '../../types/models'
import type { RunReporter } from './useRunReporter'

interface BackendRunArgs {
  /** Latest polled state. `undefined` while the first poll is in flight. */
  state: RunState | undefined
  completed: number
  total: number
  /** Backend error message, read when `state` is `'error'`. */
  error?: string | null
  reporter: RunReporter
}

/**
 * Announce backend run transitions exactly once each.
 *
 * Terminal states are only reported for a run this hook watched start, so
 * mounting the page while a finished run is still in the backend's status
 * does not pop a stale completion modal.
 */
export function useBackendRun({
  state, completed, total, error, reporter,
}: BackendRunArgs): void {
  const prev = useRef<RunState | undefined>(undefined)

  useEffect(() => {
    const from = prev.current
    if (state === from) return
    prev.current = state
    if (!state) return

    if (state === 'running') {
      reporter.started(total || undefined)
      return
    }
    if (from !== 'running') return

    const summary = { completed, total }
    if (state === 'done') reporter.finished(summary)
    else if (state === 'cancelled') reporter.stopped(summary)
    else if (state === 'error') reporter.failed(error || 'Unknown error')
  }, [state, completed, total, error, reporter])
}
