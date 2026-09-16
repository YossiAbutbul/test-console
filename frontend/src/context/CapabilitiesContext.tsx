/**
 * What the backend this UI is talking to can actually drive.
 *
 * The same bundle is served by two very different backends: the rig, with
 * every instrument wrapper installed, and the DUT-only desktop build handed to
 * someone who has no rig at all. The pages that exist only to drive an
 * instrument are dead weight in the second case, and the first sign of that
 * used to be a 501 after the operator had already set a test up.
 *
 * Asked once at startup rather than polled: what is installed cannot change
 * without restarting the process that answers this.
 */
import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'

import { getCapabilities, type Capabilities } from '../api/capabilities'

interface CapabilitiesCtx extends Capabilities {
  /** False until the first answer lands. */
  known: boolean
}

/**
 * Optimistic default: instruments available.
 *
 * The pessimistic default would grey every rig page out for the moment before
 * the answer arrives, which on the rig -- where this is nearly always wrong --
 * is a visible flicker on every reload. Being briefly wrong in this direction
 * costs nothing: the preflight still refuses, exactly as it did before any of
 * this existed.
 */
const FALLBACK: CapabilitiesCtx = { instruments: true, missing: [], known: false }

const Ctx = createContext<CapabilitiesCtx>(FALLBACK)

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CapabilitiesCtx>(FALLBACK)

  useEffect(() => {
    let cancelled = false
    getCapabilities()
      .then((c) => {
        if (!cancelled) setState({ ...c, known: true })
      })
      .catch(() => {
        // An older backend has no such route. Leaving the fallback in place
        // means the UI behaves exactly as it did before this was added, which
        // is the right answer for a backend that predates it.
      })
    return () => { cancelled = true }
  }, [])

  const value = useMemo(() => state, [state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCapabilities(): CapabilitiesCtx {
  return useContext(Ctx)
}

/** Why a rig page is unavailable, or null when it is not. */
export function useInstrumentsUnavailableReason(): string | null {
  const { instruments, missing } = useCapabilities()
  if (instruments) return null
  return missing.length
    ? `This build has no instrument support (${missing.join(', ')} not installed).`
    : 'This build has no instrument support.'
}
