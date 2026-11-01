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

/**
 * Every mounted hook per key, so a change made through one reaches the rest.
 *
 * Pages stay mounted, so two of them reading one setting each held a copy
 * read at mount: switching the LTE channel unit on the CW page left the other
 * LTE pages reading their fields in the old unit until a reload.
 */
const peers = new Map<StorageKey, Set<(v: unknown) => void>>()

export function usePersistedState<T>(
  key: StorageKey,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => storage.get<T>(key, initial))
  const firstRun = useRef(true)

  useEffect(() => {
    const set = peers.get(key) ?? new Set()
    peers.set(key, set)
    const peer = (v: unknown) => setValue(v as T)
    set.add(peer)
    return () => { set.delete(peer) }
  }, [key])

  useEffect(() => {
    // Skip the first effect: state already initialised from storage.
    if (firstRun.current) { firstRun.current = false; return }
    storage.set(key, value)
    // The same reference goes to every peer, so the echo each one sends back
    // is a no-op state update rather than a loop.
    peers.get(key)?.forEach((p) => p(value))
  }, [key, value])

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next))
  }, [])

  return [value, update]
}
