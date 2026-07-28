/** Raised when an operation exceeded its time budget. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'TimeoutError'
  }
}

/**
 * Resolve after `ms`, or as soon as `signal` aborts.
 *
 * Settle delays are the longest thing a sweep does between abort checks — a
 * plain `setTimeout` promise made Stop look broken, because the run could not
 * notice the abort until the delay had fully elapsed.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return }

    const finish = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * The underlying work is not cancelled — pass a signal to the request itself
 * for that. This exists so a hung instrument surfaces as one failed point
 * rather than stalling the whole run indefinitely.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: number | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new TimeoutError(what, ms)), ms)
    }),
  ]).finally(() => window.clearTimeout(timer)) as Promise<T>
}

/** Format a duration for the UI: "45s", "2m 30s", "1h 05m". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
