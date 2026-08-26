/**
 * How the LTE pages read a channel.
 *
 * Both settings describe the rig rather than a page, so they are stored once
 * and every LTE page reads the same value: switching to MHz on the CW page and
 * finding EARFCNs on Modulated would be a bug, not a feature.
 */

import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { DEFAULT_BANDS } from '../../lib/earfcn'

/** Whether channel inputs are read as EARFCNs or as MHz. */
export type ChannelUnit = 'earfcn' | 'mhz'

export function useLteChannelUnit() {
  return usePersistedState<ChannelUnit>(STORAGE_KEYS.lteChannelUnit, 'earfcn')
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
