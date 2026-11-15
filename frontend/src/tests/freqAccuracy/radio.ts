/**
 * What differs between the LoRa and LTE frequency accuracy pages: how a
 * channel is typed and resolved, and what power the radio takes. Everything
 * else -- the zoom, the stages, the tolerances, the tables -- is one page.
 */
import { parseRangeSpec } from '../../lib/numericList'
import { channelIssues, shortChannelIssue, uplinkFromEarfcn, uplinkFromMhz } from '../../lib/earfcn'
import type { ChannelUnit } from '../lte/channel'

export type RadioId = 'LoRa' | 'LTE'

/** LTE carries how its channels are read: EARFCNs, or MHz narrowed to the
 *  selected bands (lte/channel.ts, shared by every LTE page). */
export type Radio = { id: 'LoRa' } | { id: 'LTE'; unit: ChannelUnit; bands: number[] }

export const LORA: Radio = { id: 'LoRa' }

/** The modem's ceiling; MAX_TX_POWER_DBM on the backend. */
export const LTE_MAX_POWER_DBM = 23

/** A channel to key: the tone's nominal frequency, and for LTE its EARFCN. */
export interface Channel {
  freqMhz: number
  earfcn?: number
}

/**
 * The channels a spec names ("1880", "1860-1900:20", "18900,19100"), or null
 * when any value does not resolve to exactly one. Blank is no channels. A MHz
 * value in several selected bands is not resolved for the operator: picking a
 * band would put the DUT on a channel they never asked for.
 */
export function resolveSpec(spec: string, radio: Radio): Channel[] | null {
  if (spec.trim() === '') return []
  const nums = parseRangeSpec(spec)
  if (radio.id === 'LoRa') {
    const f = nums.filter((x) => x > 0)
    return f.length && f.length === nums.length ? f.map((freqMhz) => ({ freqMhz })) : null
  }
  if (nums.length === 0) return null
  const out: Channel[] = []
  for (const n of nums) {
    if (radio.unit === 'earfcn') {
      const ch = Number.isInteger(n) && n >= 0 ? uplinkFromEarfcn(n) : null
      if (!ch) return null
      out.push({ freqMhz: ch.freqHz / 1e6, earfcn: n })
    } else {
      const hits = uplinkFromMhz(n, radio.bands)
      if (hits.length !== 1) return null
      out.push({ freqMhz: hits[0].freqHz / 1e6, earfcn: hits[0].earfcn })
    }
  }
  return out
}

/** A spec rewritten in the other unit, so switching keeps the channels the
 *  operator picked. Untouched when any value cannot be resolved: a
 *  half-converted list would be worse than one they can see is stale. */
export function convertSpec(spec: string, from: ChannelUnit, to: ChannelUnit, bands: number[]): string {
  if (from === to || spec.trim() === '') return spec
  const ch = resolveSpec(spec, { id: 'LTE', unit: from, bands })
  if (!ch || ch.length > 200) return spec
  return ch.map((c) => (to === 'mhz' ? String(c.freqMhz) : String(c.earfcn))).join(',')
}

/** A power spec's values, or null unless every one is one the radio takes:
 *  LoRa a whole dBm 0..255, LTE 0..23 dBm. */
export function powersOf(raw: string, radio: Radio): number[] | null {
  if (raw.trim() === '') return null
  const p = parseRangeSpec(raw)
  if (!p.length) return null
  const ok = radio.id === 'LoRa'
    ? p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
    : p.every((x) => Number.isFinite(x) && x >= 0 && x <= LTE_MAX_POWER_DBM)
  return ok ? p : null
}

/** The one channel a Manual tab keys, or why it does not resolve: LoRa's is
 *  its frequency; LTE's must name exactly one channel. */
export function manualChannel(
  v: { freqMhz: number; channel?: string }, radio: Radio,
): { channel: Channel | null; issue: string | null } {
  if (radio.id !== 'LTE') return { channel: { freqMhz: v.freqMhz }, issue: null }
  const raw = v.channel ?? ''
  const ch = resolveSpec(raw, radio)
  if (ch && ch.length === 1) return { channel: ch[0], issue: null }
  const byEarfcn = radio.unit === 'earfcn'
  const issue = raw.trim() === '' ? 'Enter a value'
    : shortChannelIssue(channelIssues(parseRangeSpec(raw), byEarfcn, radio.bands))
      || (byEarfcn ? 'Outside the known bands' : 'Not in the selected bands')
  return { channel: null, issue }
}
