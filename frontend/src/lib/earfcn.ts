/**
 * E-UTRA uplink channel number to frequency.
 *
 *     F_UL = F_UL_low + 0.1 * (N_UL - N_Offs-UL)   MHz
 *
 * A TX test transmits on the *uplink*, so only the uplink table is here. The
 * power sensor needs a calibration frequency and the path-loss table is keyed
 * by frequency, and both are wrong in a way nobody notices if this is wrong —
 * so an EARFCN outside every known band returns null rather than a guess, and
 * the caller shows "unknown band" instead of measuring against a made-up
 * number.
 *
 * Band edges are 3GPP TS 36.101 Table 5.7.3-1. Bands are added here as they
 * are needed; a missing band reads as unknown, which is recoverable, while a
 * mistyped one silently measures the wrong channel.
 */

interface Band {
  band: number
  /** F_UL_low in Hz. Held in Hz, not MHz, because three bands have a .5 or .9
   *  MHz edge and integer arithmetic keeps the result exact. */
  lowHz: number
  /** N_Offs-UL, which is also the first channel number of the band. */
  offset: number
  /** Last channel number of the band. */
  max: number
}

/** 100 kHz per channel number — the 0.1 MHz in the formula. */
const STEP_HZ = 100_000

const BANDS: Band[] = [
  // FDD
  { band: 1, lowHz: 1_920_000_000, offset: 18000, max: 18599 },
  { band: 2, lowHz: 1_850_000_000, offset: 18600, max: 19199 },
  { band: 3, lowHz: 1_710_000_000, offset: 19200, max: 19949 },
  { band: 4, lowHz: 1_710_000_000, offset: 19950, max: 20399 },
  { band: 5, lowHz: 824_000_000, offset: 20400, max: 20649 },
  { band: 7, lowHz: 2_500_000_000, offset: 20750, max: 21449 },
  { band: 8, lowHz: 880_000_000, offset: 21450, max: 21799 },
  { band: 11, lowHz: 1_427_900_000, offset: 22750, max: 22949 },
  { band: 12, lowHz: 699_000_000, offset: 23010, max: 23179 },
  { band: 13, lowHz: 777_000_000, offset: 23180, max: 23279 },
  { band: 14, lowHz: 788_000_000, offset: 23280, max: 23379 },
  { band: 17, lowHz: 704_000_000, offset: 23730, max: 23849 },
  { band: 18, lowHz: 815_000_000, offset: 23850, max: 23999 },
  { band: 19, lowHz: 830_000_000, offset: 24000, max: 24149 },
  { band: 20, lowHz: 832_000_000, offset: 24150, max: 24449 },
  { band: 21, lowHz: 1_447_900_000, offset: 24450, max: 24599 },
  { band: 25, lowHz: 1_850_000_000, offset: 26040, max: 26689 },
  { band: 26, lowHz: 814_000_000, offset: 26690, max: 27039 },
  { band: 28, lowHz: 703_000_000, offset: 27210, max: 27659 },
  { band: 31, lowHz: 452_500_000, offset: 27760, max: 27809 },
  { band: 65, lowHz: 1_920_000_000, offset: 131072, max: 131971 },
  { band: 66, lowHz: 1_710_000_000, offset: 131972, max: 132671 },
  { band: 71, lowHz: 663_000_000, offset: 133122, max: 133471 },
  // TDD — uplink and downlink share the channel, so F_UL == F_DL.
  { band: 38, lowHz: 2_570_000_000, offset: 37750, max: 38249 },
  { band: 39, lowHz: 1_880_000_000, offset: 38250, max: 38649 },
  { band: 40, lowHz: 2_300_000_000, offset: 38650, max: 39649 },
  { band: 41, lowHz: 2_496_000_000, offset: 39650, max: 41589 },
]

export interface UplinkChannel {
  band: number
  freqHz: number
}

/** Uplink frequency for an EARFCN, or null if it is in no band we know. */
export function uplinkFromEarfcn(earfcn: number): UplinkChannel | null {
  if (!Number.isInteger(earfcn)) return null
  const b = BANDS.find((x) => earfcn >= x.offset && earfcn <= x.max)
  if (!b) return null
  return { band: b.band, freqHz: b.lowHz + (earfcn - b.offset) * STEP_HZ }
}

/**
 * Bands this rig tests unless told otherwise.
 *
 * A local default, not a standard one — it is what narrows an ambiguous MHz
 * value to a single channel, and 2 / 4 / 12 is what this lab works in. Lives
 * beside the band table so the two cannot drift apart.
 */
export const DEFAULT_BANDS = [2, 4, 12]

/** Every band number the table knows, ascending. */
export const KNOWN_BANDS: number[] = BANDS.map((b) => b.band).sort((a, b) => a - b)

/** Inclusive uplink span of a band, in MHz — for labelling a band picker. */
export function bandRangeMhz(band: number): { lo: number; hi: number } | null {
  const b = BANDS.find((x) => x.band === band)
  if (!b) return null
  return {
    lo: b.lowHz / 1e6,
    hi: (b.lowHz + (b.max - b.offset) * STEP_HZ) / 1e6,
  }
}

export interface UplinkMatch extends UplinkChannel {
  earfcn: number
}

/**
 * EARFCNs that transmit at `mhz`, one per band containing it.
 *
 * Going this direction is *not* one-to-one, which is the whole reason this
 * returns a list. Uplink bands overlap in frequency — 1880 MHz is EARFCN 18900
 * in band 2, 26340 in band 25 and 38250 in band 39 — so a frequency on its own
 * does not name a channel. Callers narrow with `bands`; with none given, more
 * than one result means the operator has to say which band they meant, and
 * picking for them would put the DUT on a channel they never asked for.
 *
 * The frequency is snapped to the nearest 100 kHz channel centre, and the
 * result carries the snapped `freqHz` so callers can show what was actually
 * resolved rather than what was typed.
 */
export function uplinkFromMhz(mhz: number, bands?: number[]): UplinkMatch[] {
  if (!Number.isFinite(mhz)) return []
  const hz = Math.round(mhz * 1e6)
  const out: UplinkMatch[] = []
  for (const b of BANDS) {
    if (bands && !bands.includes(b.band)) continue
    const hiHz = b.lowHz + (b.max - b.offset) * STEP_HZ
    if (hz < b.lowHz || hz > hiHz) continue
    const steps = Math.round((hz - b.lowHz) / STEP_HZ)
    out.push({
      band: b.band,
      earfcn: b.offset + steps,
      freqHz: b.lowHz + steps * STEP_HZ,
    })
  }
  return out
}

/** "1880.0 MHz · Band 2", or null when the EARFCN is unknown. */
export function describeEarfcn(earfcn: number): string | null {
  const ch = uplinkFromEarfcn(earfcn)
  if (!ch) return null
  return `${(ch.freqHz / 1e6).toFixed(1)} MHz · Band ${ch.band}`
}
