import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { instrumentsApi } from '../api/instruments'

export type InstrumentId = 'power-sensor' | 'dc-analyzer' | 'spectrum'
export type InstrumentStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface InstrumentState {
  id: InstrumentId
  label: string
  /** Address / serial / VISA resource string. */
  address: string
  /** Optional secondary field (e.g., DC channel). */
  channel?: number
  status: InstrumentStatus
  idn?: string
  error?: string
}

interface Ctx {
  open: boolean
  setOpen: (b: boolean) => void
  /** Open the modal and flag these instruments as required for the current intent. */
  notifyMissing: (ids: InstrumentId[]) => void
  /** Ids that must be connected; cleared when modal closes. */
  required: InstrumentId[]
  instruments: Record<InstrumentId, InstrumentState>
  setAddress: (id: InstrumentId, address: string) => void
  setChannel: (id: InstrumentId, channel: number) => void
  connect: (id: InstrumentId) => Promise<void>
  disconnect: (id: InstrumentId) => Promise<void>
  discover: (id: InstrumentId) => Promise<string[]>
}

const InstrumentsCtx = createContext<Ctx | null>(null)

const INITIAL: Record<InstrumentId, InstrumentState> = {
  'power-sensor': {
    id: 'power-sensor',
    label: 'Power sensor',
    address: '',
    status: 'disconnected',
  },
  'dc-analyzer': {
    id: 'dc-analyzer',
    label: 'DC analyzer',
    address: '',
    channel: 3,
    status: 'disconnected',
  },
  spectrum: {
    id: 'spectrum',
    label: 'Spectrum analyzer',
    address: '',
    status: 'disconnected',
  },
}

export function InstrumentsProvider({ children }: { children: ReactNode }) {
  const [openState, setOpenState] = useState(false)
  const [required, setRequired] = useState<InstrumentId[]>([])
  const [instruments, setInstruments] = useState(INITIAL)
  const instrumentsRef = useRef(instruments)
  useEffect(() => { instrumentsRef.current = instruments }, [instruments])

  const setOpen = useCallback((b: boolean) => {
    setOpenState(b)
    if (!b) setRequired([])
  }, [])

  const notifyMissing = useCallback((ids: InstrumentId[]) => {
    setRequired(ids)
    setOpenState(true)
  }, [])

  const patch = useCallback((id: InstrumentId, p: Partial<InstrumentState>) => {
    setInstruments((s) => ({ ...s, [id]: { ...s[id], ...p } }))
  }, [])

  const setAddress = useCallback((id: InstrumentId, address: string) => {
    patch(id, { address })
  }, [patch])

  const setChannel = useCallback((id: InstrumentId, channel: number) => {
    patch(id, { channel })
  }, [patch])

  const connect = useCallback(async (id: InstrumentId) => {
    const cur = instrumentsRef.current[id]
    patch(id, { status: 'connecting', error: undefined })
    try {
      const res = await instrumentsApi.connect(id, cur.address.trim(), cur.channel)
      patch(id, { status: 'connected', idn: res.idn ?? undefined })
    } catch (e) {
      patch(id, { status: 'error', error: (e as Error).message })
    }
  }, [patch])

  const disconnect = useCallback(async (id: InstrumentId) => {
    try {
      await instrumentsApi.disconnect(id)
    } catch {
      /* still flip local state */
    }
    patch(id, { status: 'disconnected', idn: undefined, error: undefined })
  }, [patch])

  const discover = useCallback(async (id: InstrumentId): Promise<string[]> => {
    try {
      const res = await instrumentsApi.discover(id)
      return res.candidates
    } catch (e) {
      patch(id, { error: (e as Error).message })
      return []
    }
  }, [patch])

  const value = useMemo<Ctx>(() => ({
    open: openState, setOpen, notifyMissing, required,
    instruments, setAddress, setChannel, connect, disconnect, discover,
  }), [openState, setOpen, notifyMissing, required, instruments, setAddress, setChannel, connect, disconnect, discover])

  return <InstrumentsCtx.Provider value={value}>{children}</InstrumentsCtx.Provider>
}

export function useInstruments(): Ctx {
  const v = useContext(InstrumentsCtx)
  if (!v) throw new Error('useInstruments must be inside InstrumentsProvider')
  return v
}
