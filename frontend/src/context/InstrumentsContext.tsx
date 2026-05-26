import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { instrumentsApi, type DiscoverCandidate, type InstrumentKind } from '../api/instruments'
import { servo } from '../api/servo'
import { motor } from '../api/motor'

export type InstrumentId =
  | 'power-sensor'
  | 'dc-analyzer'
  | 'spectrum'
  | 'network-analyzer'
  | 'rf-switch'
  | 'rf-trombone'
  | 'attenuator'
export type InstrumentStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface InstrumentState {
  id: InstrumentId
  label: string
  model?: string
  /** Address / serial / VISA resource string. */
  address: string
  /** Optional secondary field (e.g., DC channel). */
  channel?: number
  status: InstrumentStatus
  idn?: string
  error?: string
  /** Not yet wired to backend — UI placeholder. */
  placeholder?: boolean
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
  discover: (id: InstrumentId) => Promise<DiscoverCandidate[]>
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
    model: 'N6705B',
    address: '',
    channel: 3,
    status: 'disconnected',
  },
  spectrum: {
    id: 'spectrum',
    label: 'Spectrum analyzer',
    model: 'FSW26',
    address: '',
    status: 'disconnected',
    placeholder: true,
  },
  'network-analyzer': {
    id: 'network-analyzer',
    label: 'Network analyzer',
    model: 'E5061B',
    address: '',
    status: 'disconnected',
  },
  'rf-switch': {
    id: 'rf-switch',
    label: 'RF switch',
    model: 'Servo (Arduino)',
    address: '',
    status: 'disconnected',
  },
  'rf-trombone': {
    id: 'rf-trombone',
    label: 'RF trombone motor',
    model: 'Arcus DMX-J-SA',
    address: '',
    status: 'disconnected',
  },
  attenuator: {
    id: 'attenuator',
    label: 'Configurable attenuator',
    model: '50PA-847',
    address: '',
    status: 'disconnected',
    placeholder: true,
  },
}

export function InstrumentsProvider({ children }: { children: ReactNode }) {
  const [openState, setOpenState] = useState(false)
  const [required, setRequired] = useState<InstrumentId[]>([])
  const [instruments, setInstruments] = useState(INITIAL)
  const instrumentsRef = useRef(instruments)
  useEffect(() => { instrumentsRef.current = instruments }, [instruments])

  // Poll backend status so connections survive page reload AND backend restarts
  // stay reflected in the UI (otherwise we keep a stale 'connected' badge).
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const s = await instrumentsApi.status()
        if (cancelled) return
        const apply = (id: InstrumentId, st: { connected: boolean; idn: string | null }) => {
          setInstruments((prev) => {
            const cur = prev[id]
            if (cur.status === 'connecting') return prev
            if (st.connected) {
              if (cur.status === 'connected' && cur.idn === (st.idn ?? undefined)) return prev
              return { ...prev, [id]: { ...cur, status: 'connected', idn: st.idn ?? undefined } }
            }
            if (cur.status === 'connected') {
              return { ...prev, [id]: { ...cur, status: 'disconnected', idn: undefined } }
            }
            return prev
          })
        }
        apply('power-sensor', s.power_sensor)
        apply('dc-analyzer', s.dc_analyzer)
        apply('spectrum', s.spectrum)
        apply('network-analyzer', s.network_analyzer)
        // rf-switch backed by /servo (separate router).
        try {
          const sv = await servo.status()
          apply('rf-switch', { connected: sv.connected, idn: sv.idn })
        } catch { /* servo offline */ }
        // rf-trombone backed by /motor (Arcus DMX-J-SA).
        try {
          const mo = await motor.status()
          const idn = mo.connected
            ? `device #${mo.device_index ?? 0}${mo.position != null ? ` · pos=${mo.position}` : ''}`
            : null
          apply('rf-trombone', { connected: mo.connected, idn })
        } catch { /* motor offline */ }
      } catch { /* offline */ }
    }
    void sync()
    const id = window.setInterval(sync, 5000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  const setOpen = useCallback((b: boolean) => {
    if (b && typeof document !== 'undefined') {
      // Blur trigger so MUI can apply aria-hidden to the root without warning.
      (document.activeElement as HTMLElement | null)?.blur?.()
    }
    setOpenState(b)
    if (!b) setRequired([])
  }, [])

  const notifyMissing = useCallback((ids: InstrumentId[]) => {
    if (typeof document !== 'undefined') {
      (document.activeElement as HTMLElement | null)?.blur?.()
    }
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
      if (id === 'rf-switch') {
        const r = await servo.connect(cur.address.trim())
        patch(id, { status: 'connected', idn: r.idn ?? undefined })
        // Park the switch on the VNA path right after connect so the user
        // doesn't have to send a goto manually. Failure is non-fatal.
        try { await servo.goto('VNA') } catch { /* ignore — connection ok */ }
        return
      }
      if (id === 'rf-trombone') {
        // address stores the device name (e.g. "jsa00"). Resolve its index by
        // re-listing devices so motor.connect(idx) targets the right one.
        const name = cur.address.trim()
        const list = await motor.discover()
        const idx = Math.max(0, list.candidates.indexOf(name))
        const r = await motor.connect(idx)
        const idn = `${name || `device #${idx}`}${r.position != null ? ` · pos=${r.position}` : ''}`
        patch(id, { status: 'connected', idn })
        return
      }
      if (cur.placeholder) {
        patch(id, { status: 'error', error: 'not wired yet' })
        return
      }
      const res = await instrumentsApi.connect(id as InstrumentKind, cur.address.trim(), cur.channel)
      patch(id, { status: 'connected', idn: res.idn ?? undefined })
    } catch (e) {
      patch(id, { status: 'error', error: (e as Error).message })
    }
  }, [patch])

  const disconnect = useCallback(async (id: InstrumentId) => {
    try {
      if (id === 'rf-switch') {
        await servo.disconnect()
      } else if (id === 'rf-trombone') {
        await motor.disconnect()
      } else {
        await instrumentsApi.disconnect(id as InstrumentKind)
      }
    } catch {
      /* still flip local state */
    }
    patch(id, { status: 'disconnected', idn: undefined, error: undefined })
  }, [patch])

  const discover = useCallback(async (id: InstrumentId): Promise<DiscoverCandidate[]> => {
    try {
      if (id === 'rf-switch') {
        const r = await servo.discover()
        if (r.details && r.details.length) {
          return r.details.map((d) => ({ resource: d.port, idn: d.idn }))
        }
        return r.candidates.map((resource) => ({ resource, idn: null }))
      }
      if (id === 'rf-trombone') {
        const r = await motor.discover()
        // Expose the device name (e.g. "jsa00") as the picked value; the index
        // is resolved at connect time by re-listing devices.
        return r.candidates.map((name, i) => ({
          resource: name,
          idn: `Arcus DMX-J-SA · device #${i}`,
        }))
      }
      const res = await instrumentsApi.discover(id as InstrumentKind)
      if (res.details && res.details.length) return res.details
      return res.candidates.map((resource) => ({ resource, idn: null }))
    } catch {
      // Scan is opportunistic — never surface a discover failure as an
      // instrument error (502/timeout/etc would otherwise paint the row red).
      return []
    }
  }, [])

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
