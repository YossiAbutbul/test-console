import { createContext, useContext } from 'react'

/**
 * Whether the page this control sits on is waiting for the DUT.
 *
 * The shell wraps each DUT page in this (see PageGate in App.tsx). Send and
 * Run read it so they can say *why* they will not go, instead of the whole
 * page fading out and leaving the operator to guess.
 */
export const DutGateContext = createContext(false)

export function useDutGated(): boolean {
  return useContext(DutGateContext)
}
