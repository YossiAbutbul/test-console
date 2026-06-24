/**
 * Factory for per-page snapshot stores.
 *
 * Pattern: hold ephemeral per-page state outside the React tree so navigating
 * away and back doesn't reset what the user typed. The snapshot is a single
 * stable object that components mutate in place; after each change they call
 * `persist()` (debounced) to push it to localStorage. Survives a soft reload,
 * cleared on hard refresh (fresh JS bundle).
 */
import { storage } from './persistent'
import type { StorageKey } from './keys'

export interface PageStore<T extends object> {
  /** Stable snapshot object — mutate fields directly, then call persist(). */
  snapshot: T
  /** Debounced write to storage (coalesces bursts of changes). */
  persist: () => void
  /** Force an immediate write (e.g. before navigation away). */
  flush: () => void
}

const FLUSH_MS = 300

export function makePageStore<T extends object>(key: StorageKey, initial: T): PageStore<T> {
  const snapshot = storage.get<T>(key, initial)
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    storage.set(key, snapshot)
  }
  const persist = (): void => {
    if (timer) return // already scheduled
    timer = setTimeout(flush, FLUSH_MS)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
  }

  return { snapshot, persist, flush }
}
