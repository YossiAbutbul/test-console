import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  })

  // After page refresh, sync selectedAddr from backend's reported address so
  // the MAC field stays populated for the still-active connection.
  useEffect(() => {
    if (data?.connected && data.address && !selectedAddr) {
      setSelectedAddr(data.address)
    }
  }, [data?.connected, data?.address, selectedAddr])
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
