import { createContext, useContext } from 'react'

/**
 * Whether the page this control sits on is waiting for the DUT.
 *
 * The shell wraps each DUT page in this (see TestArea in App.tsx). It is the
 * only DUT lock on a page: Send, Run and their Stop read it, disable and say
 * "Needs DUT", and everything else stays usable. A control that writes to the
 * DUT as it changes must read it too.
 */
export const DutGateContext = createContext(false)

export function useDutGated(): boolean {
  return useContext(DutGateContext)
}
