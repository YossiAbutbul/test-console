/**
 * Run lifecycle reporting.
 *
 * Every test announces itself the same way, whichever side owns the loop:
 *
 *   start      → log line + "started" toast
 *   finish     → log line + completion modal (success, or warning if rows failed)
 *   stop       → log line + completion modal (warning)
 *   failure    → log line + completion modal (error)
 *
 * Pages used to invent their own wording per test ("Sweep complete" vs
 * "Load Pull done"), and half of them reported nothing at all at start. This
 * is the single vocabulary.
 */
import { useMemo, useRef } from 'react'
import { useLog, type LogSource } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { formatDuration, plural } from '../../lib/format'

export interface RunSummary {
  /** Points actually measured. */
  completed: number
  /** Points planned. */
  total: number
  /** Rows that recorded an error. */
  errors?: number
}

export interface RunReporter {
  /** Announce the start. `total` is the planned point count, when known. */
  started: (total?: number) => void
  /** The run reached the end of its plan. */
  finished: (summary: RunSummary) => void
  /** The user stopped the run part-way. */
  stopped: (summary: RunSummary) => void
  /** The run aborted on an error. */
  failed: (message: string) => void
  /** Free-form progress line, for anything test-specific. */
  note: (message: string, level?: 'info' | 'warn' | 'error') => void
}

/**
 * Build a reporter bound to one test.
 *
 * @param name   Display name used in modal titles ("Mode Sweep").
 * @param source Log channel the test writes to.
 * @param unit   Plural noun for one measurement ("points", "steps").
 */
export function useRunReporter(
  name: string,
  source: LogSource,
  unit = 'points',
): RunReporter {
  const { log } = useLog()
  const notify = useNotify()
  // Wall time of the run in progress. A ref rather than state: nothing renders
  // from it until the run ends, and re-rendering every page on every start
  // would be a change for no visible reason.
  //
  // Null once consumed, so a completion that arrives without a matching start —
  // mounting a page while an old run is still terminal in the backend's status,
  // or a failure raised before the run began — reports no duration rather than
  // timing from an unrelated moment.
  const startedAt = useRef<number | null>(null)

  return useMemo<RunReporter>(() => {
    const count = (n: number) => `${n} ${plural(n, unit)}`
    const progress = (s: RunSummary) => `${s.completed}/${s.total} ${unit}`

    /** `hh:mm:ss` for the run just ended, or null if we never saw it start. */
    const elapsed = (): string | null => {
      const t0 = startedAt.current
      startedAt.current = null
      return t0 == null ? null : formatDuration(Date.now() - t0)
    }

    /** " · Took 00:12:34", or nothing when the run was not timed. */
    const suffix = (label: string, took: string | null) =>
      took == null ? '' : ` ${label} ${took}`

    return {
      started: (total) => {
        startedAt.current = Date.now()
        log(source, total == null ? 'Started' : `Started — ${count(total)}`)
        notify.info(total == null ? 'Running…' : `Running ${count(total)}…`, { title: name })
      },

      finished: (summary) => {
        const errors = summary.errors ?? 0
        const took = elapsed()
        log(
          source,
          `Finished — ${progress(summary)}`
          + (errors ? `, ${count(errors).replace(unit, plural(errors, 'errors'))}` : '')
          + suffix('in', took),
          errors ? 'warn' : 'info',
        )
        notify.complete(
          errors
            ? {
                severity: 'warning',
                title: `${name} finished with errors`,
                message: `${errors} of ${summary.completed} ${unit} failed.`
                  + suffix('· Took', took),
              }
            : {
                severity: 'success',
                title: `${name} complete`,
                message: `${count(summary.completed)} measured.` + suffix('· Took', took),
              },
        )
      },

      stopped: (summary) => {
        const took = elapsed()
        log(source, `Stopped by user — ${progress(summary)}${suffix('after', took)}`, 'warn')
        notify.complete({
          severity: 'warning',
          title: `${name} stopped`,
          message: `Stopped after ${summary.completed} of ${summary.total} ${unit}.`
            + suffix('· Ran for', took),
        })
      },

      failed: (message) => {
        const took = elapsed()
        log(source, `Failed — ${message}${suffix('after', took)}`, 'error')
        notify.complete({
          severity: 'error',
          title: `${name} failed`,
          message: took == null ? message : `${message} · Failed after ${took}`,
        })
      },

      note: (message, level) => log(source, message, level),
    }
  }, [log, notify, name, source, unit])
}

export interface ActionReporter {
  /** The operation was dispatched to the hardware. */
  started: (detail?: string) => void
  /** It completed. `detail` is appended to the modal body. */
  succeeded: (detail?: string) => void
  /** It failed. */
  failed: (message: string) => void
}

/**
 * Reporter for a single long physical operation — a motor move, a servo
 * repositioning, a VNA sweep — rather than a multi-point sweep.
 *
 * Same shape of feedback as `useRunReporter` (toast on start, modal at the
 * end) so instrument pages behave like test pages.
 */
export function useActionReporter(name: string, source: LogSource): ActionReporter {
  const { log } = useLog()
  const notify = useNotify()

  return useMemo<ActionReporter>(() => ({
    started: (detail) => {
      log(source, detail ? `${name} — ${detail}` : `${name} started`)
      notify.info(detail ?? 'Running…', { title: name })
    },
    succeeded: (detail) => {
      log(source, detail ? `${name} ok — ${detail}` : `${name} ok`)
      notify.complete({
        severity: 'success',
        title: `${name} complete`,
        message: detail ?? 'Finished successfully.',
      })
    },
    failed: (message) => {
      log(source, `${name} failed: ${message}`, 'error')
      notify.complete({ severity: 'error', title: `${name} failed`, message })
    },
  }), [log, notify, name, source])
}
