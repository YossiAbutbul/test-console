/**
 * The BLE CW automation's plan: which points, in which order, and how long.
 *
 * Kept out of the panel so the parts that decide what reaches the DUT can be
 * tested without rendering it.
 *
 * The order is the point of this file. A power change is a save-and-reset --
 * a reboot and a reconnect, several seconds -- where a channel change is
 * free, so points are grouped by power: each power costs one reset however
 * many rows ask for it. Within a power, channels keep the order they were
 * typed in.
 */
import { parseRangeSpec } from '../../lib/numericList'
import { isBadLimit, parseLimit } from '../../lib/verdict'
import type { BleAutomationRow, BleChannelUnit } from '../../store/bleCwPageStore'
import {
  RELINK_TIMEOUT_S, TONE_END_GRACE_MS, channelFromMhz, channelMhz, isChannel, isPowerParam,
} from '../ble/radio'

export interface PlanPoint {
  channel: number
  freqMhz: number
  power: number
  minDbm: number | null
  maxDbm: number | null
}

/** Channels a spec names. Values that are not a BLE channel are dropped --
 *  `rowIssues` reports them, rather than this quietly running fewer. */
export function specChannels(spec: string, unit: BleChannelUnit): number[] {
  return parseRangeSpec(spec).flatMap((v) => {
    const ch = unit === 'channel' ? v : channelFromMhz(v)
    return ch != null && isChannel(ch) ? [ch] : []
  })
}

export function specPowers(spec: string): number[] {
  return parseRangeSpec(spec).filter(isPowerParam)
}

export interface RowIssues {
  channel: string | null
  power: string | null
  limits: string | null
}

/**
 * What is wrong with a row, field by field, in words short enough for the
 * field's validation bubble. A blank row is not wrong -- it is just empty --
 * and contributes no points.
 */
export function rowIssues(r: BleAutomationRow, unit: BleChannelUnit): RowIssues {
  const channels = parseRangeSpec(r.channel)
  const goodCh = specChannels(r.channel, unit)
  const powers = parseRangeSpec(r.power)
  const goodPow = specPowers(r.power)
  const min = parseLimit(r.minDbm)
  const max = parseLimit(r.maxDbm)
  return {
    channel: r.channel.trim() === ''
      ? null
      : channels.length === 0
        ? 'Not a number, range or list'
        : goodCh.length < channels.length
          ? (unit === 'channel' ? 'Channels are 0–39' : 'Not a channel: 2402–2480 MHz, even')
          : null,
    power: r.power.trim() === ''
      ? 'Enter a value'
      : powers.length === 0
        ? 'Not a number, range or list'
        : goodPow.length < powers.length ? 'Power params are 6–31, whole' : null,
    limits: isBadLimit(r.minDbm) || isBadLimit(r.maxDbm)
      ? 'A level in dBm, or blank'
      : min != null && max != null && min > max ? 'Min is above Max' : null,
  }
}

export const rowValid = (r: BleAutomationRow, unit: BleChannelUnit): boolean => {
  const i = rowIssues(r, unit)
  return !i.channel && !i.power && !i.limits
}

/** The points one row expands to, before ordering. */
export function rowPoints(r: BleAutomationRow, unit: BleChannelUnit): PlanPoint[] {
  if (!rowValid(r, unit)) return []
  const minDbm = parseLimit(r.minDbm)
  const maxDbm = parseLimit(r.maxDbm)
  const out: PlanPoint[] = []
  for (const power of specPowers(r.power)) {
    for (const channel of specChannels(r.channel, unit)) {
      out.push({ channel, freqMhz: channelMhz(channel), power, minDbm, maxDbm })
    }
  }
  return out
}

/** Every row's points, grouped by power in the order each power first
 *  appears. Stable within a power, so channels run as typed. */
export function buildPlan(rows: BleAutomationRow[], unit: BleChannelUnit): PlanPoint[] {
  const groups = new Map<number, PlanPoint[]>()
  for (const p of rows.flatMap((r) => rowPoints(r, unit))) {
    const g = groups.get(p.power)
    if (g) g.push(p)
    else groups.set(p.power, [p])
  }
  return [...groups.values()].flat()
}

/** How many save-and-resets a plan costs: one per run of points at a power,
 *  counting the first, whose power the DUT is not known to be on. */
export function powerChanges(plan: PlanPoint[]): number {
  let n = 0
  for (let i = 0; i < plan.length; i++) {
    if (i === 0 || plan[i].power !== plan[i - 1].power) n++
  }
  return n
}

/**
 * Typical costs, for the estimate only -- the run waits on the DUT, not on
 * these. A reset is two frames, a reboot and a relink; a relink after a tone
 * is a scan that finds the DUT on its first advertisements.
 */
export const POWER_CHANGE_EST_MS = 8_000
export const RELINK_EST_MS = 3_000

export function estimateRunMs(plan: PlanPoint[], toneSeconds: number): number {
  const perPoint = toneSeconds * 1000 + TONE_END_GRACE_MS + RELINK_EST_MS
  return powerChanges(plan) * POWER_CHANGE_EST_MS + plan.length * perPoint
}

/**
 * The shortest tone a settle can be measured inside.
 *
 * The reading has to land while the tone is still on air: a tone that ends
 * first measures the noise floor and records it as the DUT's power. The
 * headroom covers the tone start's own round trip and the reading itself.
 */
export const MEASURE_HEADROOM_MS = 2_500

export const minToneSeconds = (settleMs: number): number =>
  Math.ceil((settleMs + MEASURE_HEADROOM_MS) / 1000)

/**
 * Wall time one point may take before the run gives up on it: the tone, the
 * grace after it, a full relink, and the frames either side.
 */
export const stepBudgetMs = (toneSeconds: number): number =>
  toneSeconds * 1000 + TONE_END_GRACE_MS + RELINK_TIMEOUT_S * 1000 + 15_000

const PIECE = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?)?$/

/**
 * Rewrite a channel spec into the other unit, keeping its shape.
 *
 * Channel to MHz is affine (2402 + 2*ch), so a range stays a range and only
 * its step doubles or halves: "0-38:2" is "2402-2478:4", and "0-39" is
 * "2402-2480:2". A list of every
 * channel it names would be exact too, but a wall of forty numbers is not
 * what the operator typed.
 *
 * Returns the spec untouched if any piece does not convert to a real channel:
 * a half-converted spec would be worse than one the operator can see is stale.
 */
export function convertChannelSpec(spec: string, from: BleChannelUnit, to: BleChannelUnit): string {
  if (from === to || spec.trim() === '') return spec
  const value = (v: number): number | null => {
    if (from === 'channel') return isChannel(v) ? channelMhz(v) : null
    return channelFromMhz(v)
  }
  const step = (s: number): number | null => {
    const out = from === 'channel' ? s * 2 : s / 2
    return Number.isInteger(out) && out > 0 ? out : null
  }
  const pieces = spec.replace(/[‐-―−]/g, '-').split(',')
  const out: string[] = []
  for (const raw of pieces) {
    const m = PIECE.exec(raw.trim())
    if (!m) return spec
    const a = value(Number(m[1]))
    if (a == null) return spec
    if (m[2] == null) { out.push(String(a)); continue }
    const b = value(Number(m[2]))
    if (b == null) return spec
    // No step is a step of 1 in the unit it was typed in -- one channel, or
    // one MHz, which is half a channel and so not a channel range at all.
    const s = step(m[3] == null ? 1 : Number(m[3]))
    if (s == null) return spec
    out.push(s === 1 ? `${a}-${b}` : `${a}-${b}:${s}`)
  }
  return out.join(',')
}

/**
 * Auto tone length: as short as the measurement allows.
 *
 * Every second of tone past the reading is a second the run waits with the
 * DUT unreachable, so the tone is sized from what the run has seen: the
 * longest time yet from sending a tone's start to that point's reading
 * finishing (the backend's release of the link, the settle, both reads),
 * with a fifth again and a little more on top. Until a point has been timed
 * there is nothing to size from, and the first gets a generous fixed tone.
 *
 * A reading that still lands after its tone is refused (see `offAirReason`),
 * and its time feeds the next point's size -- so the run corrects itself
 * rather than repeating the miss.
 */
export const AUTO_TONE_FIRST_S = 5
export const AUTO_TONE_MAX_S = 15
const AUTO_TONE_MIN_S = 2
const AUTO_TONE_HEADROOM = 1.2
const AUTO_TONE_PAD_MS = 300

export function autoToneSeconds(slowestWindowMs: number | null): number {
  if (slowestWindowMs == null) return AUTO_TONE_FIRST_S
  const need = slowestWindowMs * AUTO_TONE_HEADROOM + AUTO_TONE_PAD_MS
  return Math.min(AUTO_TONE_MAX_S, Math.max(AUTO_TONE_MIN_S, Math.ceil(need / 1000)))
}

/** What the estimate assumes an auto tone settles at: a ~1.5 s window. */
export const AUTO_TONE_TYPICAL_S = autoToneSeconds(1_800)
