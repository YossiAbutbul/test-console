import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'field-history:'
const MAX_DEFAULT = 5

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, list: string[]) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function useFieldHistory(key: string, max = MAX_DEFAULT) {
  const [history, setHistory] = useState<string[]>(() => read(key))

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + key) setHistory(read(key))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])

  const push = useCallback(
    (val: string | number | null | undefined) => {
      const s = val == null ? '' : String(val).trim()
      if (!s) return
      setHistory((prev) => {
        const next = [s, ...prev.filter((v) => v !== s)].slice(0, max)
        write(key, next)
        return next
      })
    },
    [key, max],
  )

  const clear = useCallback(() => {
    write(key, [])
    setHistory([])
  }, [key])

  return { history, push, clear }
}
