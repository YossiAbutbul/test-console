/**
 * How the LTE pages read a channel.
 *
 * Both settings describe the rig rather than a page, so they are stored once
 * and every LTE page reads the same value: switching to MHz on the CW page and
 * finding EARFCNs on Modulated would be a bug, not a feature.
 */

import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { DEFAULT_BANDS, uplinkFromEarfcn, uplinkFromMhz } from '../../lib/earfcn'
import { parseRangeSpec } from '../../lib/numericList'

/** Whether channel inputs are read as EARFCNs or as MHz. */
export type ChannelUnit = 'earfcn' | 'mhz'

export function useLteChannelUnit() {
  return usePersistedState<ChannelUnit>(STORAGE_KEYS.lteChannelUnit, 'mhz')
}

/**
 * Bands a MHz value is allowed to resolve within.
 *
 * This is what makes the MHz direction possible at all: uplink bands overlap,
 * so 1880 MHz is a channel in bands 2, 25 and 39 with a different EARFCN in
 * each. Narrowing to the bands this rig tests leaves one answer.
 */
export function useLteBands() {
  return usePersistedState<number[]>(STORAGE_KEYS.lteBands, DEFAULT_BANDS)
}

/** Past this many channels a spec is left as typed rather than rewritten into
 *  a list. Same figure as the automation panels' MAX_CONVERT. */
const MAX_CONVERT_CHANNELS = 32

/**
 * A channel spec rewritten into the other unit, as the LTE automation panels
 * do on a unit switch (their `convertSpec`): the same channels, as a list.
 *
 * Returned untouched when any value does not resolve -- a half-converted
 * list would be worse than one the operator can see is stale -- or when it
 * would become an unreadable wall of numbers.
 */
export function convertChannelSpec(
  spec: string, from: ChannelUnit, to: ChannelUnit, bands: number[],
): string {
  if (from === to || spec.trim() === '') return spec
  const nums = parseRangeSpec(spec)
  if (nums.length === 0 || nums.length > MAX_CONVERT_CHANNELS) return spec
  const out: number[] = []
  for (const n of nums) {
    if (from === 'earfcn') {
      const ch = uplinkFromEarfcn(n)
      if (!ch) return spec
      out.push(ch.freqHz / 1e6)
    } else {
      const hits = uplinkFromMhz(n, bands)
      if (hits.length !== 1) return spec
      out.push(hits[0].earfcn)
    }
  }
  return out.join(',')
}
