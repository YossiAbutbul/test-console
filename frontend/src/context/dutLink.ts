import { createContext, useContext } from 'react'
import type { ScannedDevice } from '../types/models'

/**
 * The DUT scan and connect state, shared by every place that shows the DUT
 * controls.
 *
 * It used to live inside the one ConnectionPanel at the top of the shell. The
 * controls now sit in each test page's DUT step and in the top bar's DUT
 * popover, and every page stays mounted, so the state has to live above all of
 * them: kept per instance, switching pages mid-scan would throw away the
 * devices found so far -- and Connect only works for a unit in the current
 * scan.
 */
export interface DutLink {
  duration: number
  setDuration: (n: number) => void
  nameFilter: string
  setNameFilter: (v: string) => void
  devices: ScannedDevice[]
  /** `devices` narrowed to the chosen device type. */
  filteredDevices: ScannedDevice[]
  scanning: boolean
  /** Starts a scan, or stops the one in progress. */
  toggleScan: () => void
  isConnected: boolean
  busy: boolean
  isKnownDevice: boolean
  canConnect: boolean
  /** Connect the selected unit, or disconnect the connected one. */
  toggleConnect: () => void
}

export const DutLinkCtx = createContext<DutLink | null>(null)

export function useDutLink(): DutLink {
  const v = useContext(DutLinkCtx)
  if (!v) throw new Error('useDutLink must be inside DutLinkProvider')
  return v
}
