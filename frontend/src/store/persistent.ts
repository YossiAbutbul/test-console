/**
 * Typed localStorage wrapper + a React hook for persisted state.
 *
 * Usage:
 *   const [value, setValue] = usePersistedState(STORAGE_KEYS.nicknames, {})
 *   storage.set(STORAGE_KEYS.themePref, 'dark')
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StorageKey } from './keys'

export const storage = {
  get<T>(key: StorageKey, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
  set<T>(key: StorageKey, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota / private mode */
    }
  },
  remove(key: StorageKey): void {
    try { localStorage.removeItem(key) } catch {}
  },
}

export function usePersistedState<T>(
  key: StorageKey,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => storage.get<T>(key, initial))
  const firstRun = useRef(true)

  useEffect(() => {
    // Skip the first effect: state already initialised from storage.
    if (firstRun.current) { firstRun.current = false; return }
    storage.set(key, value)
  }, [key, value])

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next))
  }, [])

  return [value, update]
}
