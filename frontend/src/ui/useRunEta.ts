import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../lib/async'
import { computeEta, type Eta } from '../lib/eta'

/**
 * How often the clock re-reads the time while a run is going.
 *
 * Half a second rather than one: step completions are only noticed on a tick,
 * and at 1 s the "time into this step" could be off by a whole second, which
 * shows as the countdown stuttering on short steps.
 */
const TICK_MS = 500

interface Clock {
  startedAt: number
  stepAt: number
  now: number
}

export interface RunEtaOptions {
  running: boolean
  completed: number
  total: number
  /** The pre-run estimate for the whole run, if the page has one. */
  plannedTotalMs?: number | null
  /**
   * When the run started (epoch ms), if something outside the page knows
   * better than the moment `running` went true -- the Mode Sweep's backend
   * does, and it survives a reload part-way through.
   */
  startedAt?: number | null
}

/**
 * Elapsed and remaining time for a run, or null while nothing is running.
 *
 * The clock lives in an interval rather than in render: reading the time while
 * rendering is impure, and a step completing is only an input to the next
 * tick, not a reason to re-render on its own.
 */
export function useRunEta({
  running, completed, total, plannedTotalMs = null, startedAt = null,
}: RunEtaOptions): Eta | null {
  const [clock, setClock] = useState<Clock | null>(null)
  // Latest step count, for the interval to compare against. Written in an
  // effect so the interval closure does not have to be torn down per step.
  const completedRef = useRef(completed)
  useEffect(() => { completedRef.current = completed }, [completed])

  useEffect(() => {
    if (!running) return
    const t0 = startedAt ?? Date.now()
    let seen = completedRef.current
    let stepAt = t0
    const tick = () => {
      const now = Date.now()
      if (completedRef.current !== seen) {
        seen = completedRef.current
        stepAt = now
      }
      setClock({ startedAt: t0, stepAt, now })
    }
    // First reading on the next turn rather than synchronously, so starting a
    // run is not a state update inside the effect that noticed it.
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, TICK_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
      // So the next run cannot show this one's clock for the moment before
      // its own first tick.
      setClock(null)
    }
  }, [running, startedAt])

  if (!running || !clock) return null
  return computeEta({
    completed,
    total,
    elapsedMs: clock.now - clock.startedAt,
    sinceStepMs: clock.now - clock.stepAt,
    plannedTotalMs,
  })
}

/** "1m 05s elapsed · ~3m 20s left" -- the shared wording for a run's timing. */
export function formatRunTiming(eta: Eta): string {
  const elapsed = `${formatDuration(eta.elapsedMs)} elapsed`
  if (eta.remainingMs == null) return elapsed
  return `${elapsed} · ~${formatDuration(eta.remainingMs)} left`
}
