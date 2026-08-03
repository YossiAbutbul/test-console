import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { instrumentsApi, type DiscoverCandidate, type InstrumentKind } from '../api/instruments'
import { servo } from '../api/servo'
import { motor } from '../api/motor'
import {
  ConnectTimeout, describeConnectError, type ConnectFailure,
} from '../lib/instrumentError'

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
  /** Set when `status === 'error'`. Classified, not raw driver text. */
  failure?: ConnectFailure
  /** Not yet wired to backend — UI placeholder. */
  placeholder?: boolean
}

interface State {
  open: boolean
  required: InstrumentId[]
  instruments: Record<InstrumentId, InstrumentState>
}

/** How a connect attempt ended. */
export interface ConnectOutcome {
  ok: boolean
  /** Classified failure, ready to show. Absent when `ok`. */
  failure?: ConnectFailure
}

/**
 * How long to wait for one instrument before giving up on it.
 *
 * A dead VISA/serial resource can otherwise block for the OS-level timeout —
 * tens of seconds — with no feedback at all.
 */
export const CONNECT_TIMEOUT_MS = 15000

/**
 * Substring identifying each instrument in a discovered IDN.
 *
 * Several VISA devices answer one scan, so "the first candidate" is not good
 * enough — it is how the network analyzer picker ends up offering the DC
 * analyzer. Shared with the Instruments panel so the address a scan pre-fills
 * and the one an auto-connect resolves are chosen the same way.
 */
export const EXPECTED_MODEL: Partial<Record<InstrumentId, string>> = {
  'dc-analyzer': 'N6705',
  'network-analyzer': 'E5061',
  spectrum: 'FSW',
}

/** The candidate that best matches `id`, or null when the scan found nothing. */
export function pickCandidate(
  id: InstrumentId,
  list: DiscoverCandidate[],
): DiscoverCandidate | null {
  if (list.length === 0) return null
  const want = EXPECTED_MODEL[id]
  if (want) {
    const m = list.find((c) => c.idn?.toLowerCase().includes(want.toLowerCase()))
    if (m) return m
  }
  return list[0]
}

/**
 * Hard cap on a single discover/scan. The backend already bounds VISA
 * enumeration and returns a 504 on a wedged instrument, but a scan must never
 * be able to spin the row's progress bar forever if a request hangs below that
 * (proxy stall, lost socket). Kept above the backend's own scan timeout so the
 * server's 504 is what normally surfaces.
 */
export const DISCOVER_TIMEOUT_MS = 20000

interface Actions {
  setOpen: (b: boolean) => void
  notifyMissing: (ids: InstrumentId[]) => void
  setAddress: (id: InstrumentId, address: string) => void
  setChannel: (id: InstrumentId, channel: number) => void
  /**
   * Connect one instrument, bounded by `timeoutMs`. Used by the Instruments
   * panel and by the pre-run preflight, so both behave the same and both get
   * the same classified failure back.
   */
  connect: (id: InstrumentId, timeoutMs?: number) => Promise<ConnectOutcome>
  disconnect: (id: InstrumentId) => Promise<void>
  discover: (id: InstrumentId) => Promise<DiscoverCandidate[]>
  /** Pull connection state from the backend now, instead of waiting for the poll. */
  refreshStatus: () => Promise<void>
}

// Split state (changes on every poll) from actions (stable refs). Components
// that only need callbacks subscribe to ActionsCtx and never re-render on
// poll. Components that care about a single instrument can read from
// StateCtx but use React.memo + per-row props to skip sibling re-renders.
const StateCtx = createContext<State | null>(null)
const ActionsCtx = createContext<Actions | null>(null)

type Ctx = State & Actions

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

  /**
   * Pull instrument state from the backend into the UI.
   *
   * The backend is the authority on what is connected: sessions survive a page
   * reload, and can be opened or dropped outside this tab. Callers that are
   * about to act on a connection (the pre-run preflight) refresh first rather
   * than trusting state that can be up to one poll interval stale.
   */
  const refreshStatus = useCallback(async (): Promise<void> => {
    const apply = (id: InstrumentId, st: { connected: boolean; idn: string | null }) => {
      setInstruments((prev) => {
        const cur = prev[id]
        // A connect in flight owns the row until it settles.
        if (cur.status === 'connecting') return prev
        if (st.connected) {
          if (cur.status === 'connected' && cur.idn === (st.idn ?? undefined)) return prev
          return {
            ...prev,
            [id]: { ...cur, status: 'connected', idn: st.idn ?? undefined, failure: undefined },
          }
        }
        if (cur.status === 'connected') {
          return { ...prev, [id]: { ...cur, status: 'disconnected', idn: undefined } }
        }
        return prev
      })
    }

    try {
      const s = await instrumentsApi.status()
      apply('power-sensor', s.power_sensor)
      apply('dc-analyzer', s.dc_analyzer)
      apply('spectrum', s.spectrum)
      apply('network-analyzer', s.network_analyzer)
    } catch { /* backend offline — leave the last known state alone */ }

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
  }, [])

  useEffect(() => {
    void refreshStatus()
    const id = window.setInterval(() => { void refreshStatus() }, 5000)
    return () => window.clearInterval(id)
  }, [refreshStatus])

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

  // `discover` is declared below but only ever called from inside a handler,
  // so route through a ref rather than reordering the two around each other.
  const discoverRef = useRef<(id: InstrumentId) => Promise<DiscoverCandidate[]>>(
    async () => [],
  )

  /** The connect itself. Throws on failure; `connect` classifies it. */
  const openSession = useCallback(async (id: InstrumentId) => {
    const cur = instrumentsRef.current[id]
    if (cur.placeholder) throw new Error('not wired yet')
    // A blank address is legitimate and means "bind whatever is out there":
    // the power-sensor driver falls back to a no-arg connect. Addresses are
    // not persisted, so rejecting a blank one here made every test unrunnable
    // after a reload.

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
    // For the VISA instruments a blank address is *not* a usable default: the
    // driver falls back to a resource string compiled into it, which is some
    // other unit's serial and fails with "not found at that address" even
    // though a scan would have located the instrument immediately. Since
    // addresses are not persisted, that is the state after every reload — so
    // resolve one by scanning before giving up.
    let address = cur.address.trim()
    if (!address && EXPECTED_MODEL[id]) {
      const pick = pickCandidate(id, await discoverRef.current(id))
      if (pick) {
        address = pick.resource
        // Show what it bound to, so the field is not still blank afterwards.
        patch(id, { address })
      }
    }
    const res = await instrumentsApi.connect(id as InstrumentKind, address, cur.channel)
    patch(id, { status: 'connected', idn: res.idn ?? undefined })
  }, [patch])

  const connect = useCallback(async (
    id: InstrumentId,
    timeoutMs = CONNECT_TIMEOUT_MS,
  ): Promise<ConnectOutcome> => {
    const cur = instrumentsRef.current[id]
    if (cur.status === 'connected') return { ok: true }

    patch(id, { status: 'connecting', failure: undefined })
    let timer: number | undefined
    try {
      // The request keeps running after we stop waiting — there is no cancel on
      // the backend side. If it lands late, the status poll picks the
      // connection up, so a merely slow instrument recovers on its own.
      await Promise.race([
        openSession(id),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new ConnectTimeout(Math.round(timeoutMs / 1000))),
            timeoutMs,
          )
        }),
      ])
      return { ok: true }
    } catch (e) {
      const failure = describeConnectError(e, cur.address)
      patch(id, { status: 'error', failure })
      return { ok: false, failure }
    } finally {
      if (timer != null) window.clearTimeout(timer)
    }
  }, [patch, openSession])

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
    patch(id, { status: 'disconnected', idn: undefined, failure: undefined })
  }, [patch])

  const discover = useCallback(async (id: InstrumentId): Promise<DiscoverCandidate[]> => {
    let timer: number | undefined
    try {
      const scan = (async (): Promise<DiscoverCandidate[]> => {
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
      })()
      // The request keeps running if it loses the race; the caller just stops
      // waiting so the scan indicator can't spin indefinitely.
      return await Promise.race([
        scan,
        new Promise<DiscoverCandidate[]>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error('discover timed out')),
            DISCOVER_TIMEOUT_MS,
          )
        }),
      ])
    } catch {
      // Scan is opportunistic — never surface a discover failure as an
      // instrument error (502/timeout/etc would otherwise paint the row red).
      return []
    } finally {
      if (timer != null) window.clearTimeout(timer)
    }
  }, [])
  discoverRef.current = discover

  const state = useMemo<State>(
    () => ({ open: openState, required, instruments }),
    [openState, required, instruments],
  )
  const actions = useMemo<Actions>(
    () => ({
      setOpen, notifyMissing, setAddress, setChannel,
      connect, disconnect, discover, refreshStatus,
    }),
    [setOpen, notifyMissing, setAddress, setChannel, connect, disconnect, discover, refreshStatus],
  )

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={state}>
        {children}
      </StateCtx.Provider>
    </ActionsCtx.Provider>
  )
}

export function useInstrumentsState(): State {
  const v = useContext(StateCtx)
  if (!v) throw new Error('useInstrumentsState must be inside InstrumentsProvider')
  return v
}

export function useInstrumentsActions(): Actions {
  const v = useContext(ActionsCtx)
  if (!v) throw new Error('useInstrumentsActions must be inside InstrumentsProvider')
  return v
}

/** Legacy combined hook — re-renders on every state change. New code should
 *  prefer the granular hooks below. */
export function useInstruments(): Ctx {
  return { ...useInstrumentsState(), ...useInstrumentsActions() }
}

/** Returns only one instrument's record. Re-renders only when THIS id changes
 *  because our `apply` keeps unchanged rows referentially stable. */
export function useInstrumentValue(id: InstrumentId): InstrumentState {
  const { instruments } = useInstrumentsState()
  return instruments[id]
}

/** Modal-only state — open, required, setOpen. Doesn't track instruments,
 *  so it ignores poll-induced map changes. */
export function useInstrumentsModal() {
  const { open, required } = useInstrumentsState()
  const { setOpen, notifyMissing } = useInstrumentsActions()
  return { open, required, setOpen, notifyMissing }
}
