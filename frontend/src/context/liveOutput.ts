import { createContext, useContext, useEffect, useMemo } from 'react'

/**
 * What the rig is putting out right now, for the warning pills in the top bar.
 *
 * Published by the pages that already know, not discovered by polling: the
 * signal generator and DC analyzer are read back by their own pages, the LTE
 * modem's state is held by `useLteModem`, and each run knows it is running.
 * Asking the instruments again from here would put a second caller on a VISA
 * session that is exclusive (see CLAUDE.md, "The rig"), so this context never
 * talks to hardware. Every page stays mounted, so whatever a page last
 * learned is still being published after the operator navigates away.
 *
 * Split into actions and state like InstrumentsContext, so a page that only
 * publishes does not re-render whenever some other page does.
 */

export type LiveKind = 'rf' | 'dc' | 'lte' | 'run'

export interface LiveOutput {
  kind: LiveKind
  /** Pill text: "RF ON", "DC ON", "LTE TX", "Run". */
  label: string
  /** Short qualifier beside the label: "915.000 MHz · -10 dBm". */
  detail?: string
  /** Registry id of the page the pill navigates to. */
  pageId: string
  /** Epoch ms at which the output stops on its own; shown as a countdown,
   *  and the pill disappears once it has passed. */
  untilMs?: number
  /** Tooltip. Says so when the state is a belief rather than a reading. */
  note?: string
}

export type LiveOutputEntry = LiveOutput & { key: string }

export interface Actions {
  /** Set or (with null) clear the entry under `key`. */
  publish: (key: string, value: LiveOutput | null) => void
}

export const ActionsCtx = createContext<Actions | null>(null)
export const StateCtx = createContext<Record<string, LiveOutput>>({})

export const same = (a: LiveOutput | undefined, b: LiveOutput | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b)

export function useLiveOutputActions(): Actions {
  const ctx = useContext(ActionsCtx)
  if (!ctx) throw new Error('useLiveOutputActions must be used within LiveOutputProvider')
  return ctx
}

/** Every live output, in a stable order (by kind, then key). */
export function useLiveOutputs(): LiveOutputEntry[] {
  const entries = useContext(StateCtx)
  return useMemo(() => {
    const order: LiveKind[] = ['rf', 'dc', 'lte', 'run']
    return Object.entries(entries)
      .map(([key, v]) => ({ ...v, key }))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.key.localeCompare(b.key))
  }, [entries])
}

/**
 * Publish `value` under `key` for as long as it is non-null, and clear it when
 * the caller unmounts.
 *
 * Compared by content rather than identity, so a page can build the object
 * inline on every render without republishing each time.
 */
export function usePublishLiveOutput(key: string, value: LiveOutput | null): void {
  const { publish } = useLiveOutputActions()
  const sig = value ? JSON.stringify(value) : null
  useEffect(() => {
    publish(key, sig ? (JSON.parse(sig) as LiveOutput) : null)
  }, [key, sig, publish])
  useEffect(() => () => publish(key, null), [key, publish])
}
