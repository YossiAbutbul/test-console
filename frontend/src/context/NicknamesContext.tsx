import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { STORAGE_KEYS, usePersistedState } from '../store'

interface Ctx {
  get: (mac: string) => string | undefined
  set: (mac: string, name: string) => void
  remove: (mac: string) => void
  all: Record<string, string>
  colorFor: (mac: string) => { bg: string; fg: string }
}

const NicknamesCtx = createContext<Ctx | null>(null)

const COLOR_PAIRS: Array<{ bg: string; fg: string }> = [
  { bg: 'rgba(61,107,196,0.18)', fg: '#3D6BC4' },   // blue
  { bg: 'rgba(91,140,90,0.18)', fg: '#5B8C5A' },    // green
  { bg: 'rgba(217,119,87,0.18)', fg: '#C76238' },   // coral
  { bg: 'rgba(180,121,31,0.18)', fg: '#B4791F' },   // amber
  { bg: 'rgba(159,67,154,0.18)', fg: '#8C4690' },   // magenta
  { bg: 'rgba(74,107,130,0.20)', fg: '#456A82' },   // slate
  { bg: 'rgba(125,93,189,0.18)', fg: '#7A5BC4' },   // violet
  { bg: 'rgba(184,58,53,0.18)', fg: '#B83A35' },    // red
  { bg: 'rgba(38,140,138,0.18)', fg: '#268C8A' },   // teal
]

function hashMac(mac: string): number {
  let h = 0
  for (let i = 0; i < mac.length; i++) h = (h * 31 + mac.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function NicknamesProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = usePersistedState<Record<string, string>>(STORAGE_KEYS.nicknames, {})

  const get = useCallback((mac: string) => all[mac.toUpperCase()], [all])
  const set = useCallback((mac: string, name: string) => {
    const key = mac.toUpperCase()
    setAll((s) => {
      const trimmed = name.trim()
      if (!trimmed) {
        const { [key]: _, ...rest } = s
        return rest
      }
      return { ...s, [key]: trimmed }
    })
  }, [setAll])
  const remove = useCallback((mac: string) => {
    const key = mac.toUpperCase()
    setAll((s) => {
      const { [key]: _, ...rest } = s
      return rest
    })
  }, [setAll])
  const colorFor = useCallback((mac: string) => COLOR_PAIRS[hashMac(mac.toUpperCase()) % COLOR_PAIRS.length], [])

  const value = useMemo<Ctx>(() => ({ get, set, remove, all, colorFor }), [get, set, remove, all, colorFor])

  return <NicknamesCtx.Provider value={value}>{children}</NicknamesCtx.Provider>
}

export function useNicknames(): Ctx {
  const v = useContext(NicknamesCtx)
  if (!v) throw new Error('useNicknames must be inside NicknamesProvider')
  return v
}
