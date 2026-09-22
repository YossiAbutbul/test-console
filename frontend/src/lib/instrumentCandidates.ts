import type { DiscoverCandidate } from '../api/instruments'
import { EXPECTED_MODEL, type InstrumentId } from '../context/InstrumentsContext'

/** Drop candidates that clearly belong to a *different* known instrument.
 *  Keeps the model-matched device plus any with no IDN (still unidentified),
 *  so the network-analyzer picker won't list the DC analyzer (N6705) etc. */
export function filterCandidates(id: InstrumentId, list: DiscoverCandidate[]): DiscoverCandidate[] {
  const want = EXPECTED_MODEL[id]?.toLowerCase()
  if (!want) return list
  const others = Object.entries(EXPECTED_MODEL)
    .filter(([k]) => k !== id)
    .map(([, v]) => v.toLowerCase())
  return list.filter((c) => {
    const idn = c.idn?.toLowerCase()
    if (!idn) return true // unidentified — keep selectable
    if (idn.includes(want)) return true
    return !others.some((o) => idn.includes(o)) // exclude known-other models
  })
}
