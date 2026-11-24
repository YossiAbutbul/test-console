/**
 * The tests a sequence can chain: the five sweeps and frequency accuracy
 * (LoRa, LTE), each a step type of the backend's sequence runner
 * (backend/sequence/steps.py). In the order the sidebar lists them under each
 * protocol. Load Pull and Mode Sweep are not steps yet.
 */
import type { AnySweepTest } from '../engine/sweepTest'
import type { Protocol } from '../types'
import { bleCwTest } from '../bleCw/sweepTest'
import { lteCwTest } from '../lteCw/sweepTest'
import { lteModulatedTest } from '../lteModulated/sweepTest'
import { modulatedTest } from '../modulated/sweepTest'
import { loraCwTest } from '../power/sweepTest'
import { loraFreqAccuracyTest, lteFreqAccuracyTest } from '../freqAccuracy/sweepTest'

export const SUITE_TESTS: AnySweepTest[] = [
  loraCwTest, modulatedTest, loraFreqAccuracyTest,
  lteCwTest, lteModulatedTest, lteFreqAccuracyTest,
  bleCwTest,
]

export function suiteTest(id: string): AnySweepTest | undefined {
  return SUITE_TESTS.find((t) => t.id === id)
}

/** The protocols, in the sidebar's order. */
export const PROTOCOLS: Protocol[] = ['LoRa', 'LTE', 'BLE']

/** Each protocol's colour in a sequence -- its heading and its steps'
 *  numbers -- from the chart series, so it holds in both themes. */
export function protocolColor(p: Protocol, series: readonly string[]): string {
  return p === 'LoRa' ? series[0] : p === 'LTE' ? series[3] : series[2]
}

/** A test's label without its protocol ("LoRa CW" → "CW"), for a place that
 *  already says the protocol: a library heading, a step's tag. */
export function shortLabel(label: string, protocol: string): string {
  const rest = label.startsWith(`${protocol} `) ? label.slice(protocol.length + 1) : label
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/** The drag payload's type: a test id dragged from the library. */
export const LIBRARY_MIME = 'application/x-test-sequence-test'

/**
 * A second type naming the test's protocol. A drag's data can only be read
 * on drop, but its types can be read while it is over the list, which is
 * when the list has to show where the test will land: in its protocol.
 */
export const protocolMime = (p: string) => `application/x-test-sequence-protocol-${p.toLowerCase()}`
