import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { STORAGE_KEYS, usePersistedState } from '../store'

interface Ctx {
  pathLossDb: number
  setPathLossDb: (n: number) => void
}

const PathLossCtx = createContext<Ctx | null>(null)

export function PathLossProvider({ children }: { children: ReactNode }) {
  const [pathLossDb, setPathLossDb] = usePersistedState<number>(STORAGE_KEYS.pathLossDb, 0)
  const value = useMemo<Ctx>(() => ({ pathLossDb, setPathLossDb }), [pathLossDb, setPathLossDb])
  return <PathLossCtx.Provider value={value}>{children}</PathLossCtx.Provider>
}

export function usePathLoss(): Ctx {
  const v = useContext(PathLossCtx)
  if (!v) throw new Error('usePathLoss must be inside PathLossProvider')
  return v
}
