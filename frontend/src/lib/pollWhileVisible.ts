/**
 * `setInterval` for a background poll that has no reason to run while the
 * window is hidden (minimised, another tab in front): each tick is skipped
 * while `document.hidden`, and one runs as soon as the window shows again, so
 * what the operator comes back to is current rather than up to a period old.
 *
 * TanStack Query's `refetchInterval` already behaves this way; this is for
 * the polls written by hand. A run's own status poll should not use it: a run
 * keeps going whether or not anyone is watching.
 *
 * Returns the cleanup for a `useEffect`.
 */
export function pollWhileVisible(fn: () => void, periodMs: number): () => void {
  const hidden = () => typeof document !== 'undefined' && document.hidden
  const timer = setInterval(() => { if (!hidden()) fn() }, periodMs)
  const onVisible = () => { if (!hidden()) fn() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }
}
