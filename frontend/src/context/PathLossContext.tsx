import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { STORAGE_KEYS, usePersistedState } from '../store'
import { findLoss, type PathLossAt, type PathLossPoint } from '../lib/pathLoss'

interface Ctx {
  /** Used when a frequency has no entry in the table. */
  defaultDb: number
  setDefaultDb: (n: number) => void
  points: PathLossPoint[]
  setPoints: (p: PathLossPoint[]) => void
  /** Loss to add to a sensor reading at `freqMhz`, and whether it was measured. */
  lossAt: (freqMhz: number | null | undefined) => PathLossAt
  /**
   * The default, under its old name.
   *
   * Kept so the places that only display "the" path-loss figure — the
   * Connection panel field, the chips — did not all have to change at once.
   * Anything *correcting a reading* should use `lossAt` instead.
   */
  pathLossDb: number
  setPathLossDb: (n: number) => void
}

const PathLossCtx = createContext<Ctx | null>(null)

export function PathLossProvider({ children }: { children: ReactNode }) {
  const [defaultDb, setDefaultDb] = usePersistedState<number>(STORAGE_KEYS.pathLossDb, 0)
  const [points, setPoints] = usePersistedState<PathLossPoint[]>(
    STORAGE_KEYS.pathLossTable, [],
  )

  const lossAt = useCallback(
    (freqMhz: number | null | undefined) => findLoss(points, defaultDb, freqMhz),
    [points, defaultDb],
  )

  const value = useMemo<Ctx>(
    () => ({
      defaultDb,
      setDefaultDb,
      points,
      setPoints,
      lossAt,
      pathLossDb: defaultDb,
      setPathLossDb: setDefaultDb,
    }),
    [defaultDb, setDefaultDb, points, setPoints, lossAt],
  )
  return <PathLossCtx.Provider value={value}>{children}</PathLossCtx.Provider>
}

export function usePathLoss(): Ctx {
  const v = useContext(PathLossCtx)
  if (!v) throw new Error('usePathLoss must be inside PathLossProvider')
  return v
}
