import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ble } from '../api/ble'
import type { ConnectionStatus } from '../types/models'

interface ConnectionCtx {
  status: ConnectionStatus | undefined
  isLoading: boolean
  selectedAddr: string | null
  setSelectedAddr: (a: string | null) => void
  refetch: () => void
}

const Ctx = createContext<ConnectionCtx | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ble-status'],
    queryFn: ble.status,
    refetchInterval: 2000,
  })
  const value = useMemo<ConnectionCtx>(
    () => ({ status: data, isLoading, selectedAddr, setSelectedAddr, refetch: () => void refetch() }),
    [data, isLoading, selectedAddr, refetch],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConnection(): ConnectionCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConnection must be inside ConnectionProvider')
  return v
}
