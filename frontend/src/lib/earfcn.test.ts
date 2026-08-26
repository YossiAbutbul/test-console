import { describe, expect, it } from 'vitest'
import {
  KNOWN_BANDS, bandRangeMhz, describeEarfcn, uplinkFromEarfcn, uplinkFromMhz,
} from './earfcn'

describe('uplinkFromEarfcn', () => {
  // The two EARFCNs from the captured LTE CW frames — the only values we have
  // independent confirmation for, so they anchor the whole table.
  it('resolves the captured channels', () => {
    expect(uplinkFromEarfcn(18900)).toEqual({ band: 2, freqHz: 1_880_000_000 })
    expect(uplinkFromEarfcn(20175)).toEqual({ band: 4, freqHz: 1_732_500_000 })
  })

  it('returns the band low edge at the offset channel', () => {
    expect(uplinkFromEarfcn(18000)?.freqHz).toBe(1_920_000_000) // B1
    expect(uplinkFromEarfcn(20400)?.freqHz).toBe(824_000_000)   // B5
    expect(uplinkFromEarfcn(23010)?.freqHz).toBe(699_000_000)   // B12
  })

  it('steps 100 kHz per channel', () => {
    const a = uplinkFromEarfcn(18000)!.freqHz
    const b = uplinkFromEarfcn(18001)!.freqHz
    expect(b - a).toBe(100_000)
  })

  it('keeps fractional band edges exact', () => {
    // B11 starts at 1427.9 MHz and B31 at 452.5 — held in Hz so no float drift.
    expect(uplinkFromEarfcn(22750)?.freqHz).toBe(1_427_900_000)
    expect(uplinkFromEarfcn(27760)?.freqHz).toBe(452_500_000)
    expect(uplinkFromEarfcn(24450)?.freqHz).toBe(1_447_900_000)
  })

  it('covers the last channel of a band but not the next number', () => {
    expect(uplinkFromEarfcn(18599)?.band).toBe(1)
    expect(uplinkFromEarfcn(18600)?.band).toBe(2)
  })

  it('returns null in the gap between bands', () => {
    // 22950..23009 sits between B11 and B12 and belongs to neither.
    expect(uplinkFromEarfcn(22975)).toBeNull()
  })

  it('returns null for unknown, negative and non-integer input', () => {
    expect(uplinkFromEarfcn(999_999)).toBeNull()
    expect(uplinkFromEarfcn(-1)).toBeNull()
    expect(uplinkFromEarfcn(18900.5)).toBeNull()
    expect(uplinkFromEarfcn(NaN)).toBeNull()
  })

  it('never overlaps: an EARFCN resolves to at most one band', () => {
    // Guards against a mistyped range silently shadowing a neighbour.
    const seen = new Map<number, number>()
    for (let n = 17_000; n < 42_000; n++) {
      const ch = uplinkFromEarfcn(n)
      if (ch) {
        expect(seen.has(n)).toBe(false)
        seen.set(n, ch.band)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe('describeEarfcn', () => {
  it('formats frequency and band', () => {
    expect(describeEarfcn(18900)).toBe('1880.0 MHz · Band 2')
    expect(describeEarfcn(20175)).toBe('1732.5 MHz · Band 4')
  })

  it('is null when the band is unknown', () => {
    expect(describeEarfcn(999_999)).toBeNull()
  })
})

/**
 * The operator's working channels: low, middle and top of bands 12, 4 and 2.
 * These are the pairs the lab actually uses, so they are the contract — if the
 * table ever drifts, it fails here rather than on the bench.
 */
const OPERATOR_CHANNELS: Array<[mhz: number, earfcn: number, band: number]> = [
  [699, 23010, 12],
  [707.5, 23095, 12],
  [715.9, 23179, 12],
  [1710, 19950, 4],
  [1732.5, 20175, 4],
  [1754.9, 20399, 4],
  [1850, 18600, 2],
  [1880, 18900, 2],
  [1909.9, 19199, 2],
]

/** The bands in use by default. */
const BANDS_IN_USE = [2, 4, 12]

describe('uplinkFromMhz', () => {
  it.each(OPERATOR_CHANNELS)(
    '%f MHz resolves to EARFCN %i in band %i, scoped to the bands in use',
    (mhz, earfcn, band) => {
      const hits = uplinkFromMhz(mhz, BANDS_IN_USE)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toEqual({ band, earfcn, freqHz: Math.round(mhz * 1e6) })
    },
  )

  it('is ambiguous without a band filter', () => {
    // The reason the band setting exists: 1880 MHz is a real channel in three
    // separate bands, and nothing about the frequency says which was meant.
    const hits = uplinkFromMhz(1880)
    expect(hits.length).toBeGreaterThan(1)
    expect(hits.map((h) => h.earfcn)).toContain(18900)
  })

  it('round-trips against uplinkFromEarfcn', () => {
    for (const [, earfcn] of OPERATOR_CHANNELS) {
      const ch = uplinkFromEarfcn(earfcn)!
      const back = uplinkFromMhz(ch.freqHz / 1e6, BANDS_IN_USE)
      expect(back).toHaveLength(1)
      expect(back[0].earfcn).toBe(earfcn)
    }
  })

  it('snaps to the nearest channel centre and reports where it landed', () => {
    // 30 kHz off a centre: the caller shows freqHz, so the snap is visible.
    const [hit] = uplinkFromMhz(1880.03, BANDS_IN_USE)
    expect(hit.earfcn).toBe(18900)
    expect(hit.freqHz).toBe(1_880_000_000)
  })

  it('returns nothing outside the selected bands', () => {
    // 2500 MHz is band 7, which is not in use here.
    expect(uplinkFromMhz(2500, BANDS_IN_USE)).toEqual([])
  })

  it('returns nothing for a frequency in no band at all', () => {
    expect(uplinkFromMhz(1000)).toEqual([])
    expect(uplinkFromMhz(NaN)).toEqual([])
  })

  it('respects band edges', () => {
    // One channel below B2's first and one above its last.
    expect(uplinkFromMhz(1849.9, [2])).toEqual([])
    expect(uplinkFromMhz(1910.0, [2])).toEqual([])
    expect(uplinkFromMhz(1850, [2])[0].earfcn).toBe(18600)
    expect(uplinkFromMhz(1909.9, [2])[0].earfcn).toBe(19199)
  })
})

describe('band metadata', () => {
  it('lists bands ascending', () => {
    expect(KNOWN_BANDS[0]).toBe(1)
    expect([...KNOWN_BANDS].sort((a, b) => a - b)).toEqual(KNOWN_BANDS)
    expect(KNOWN_BANDS).toEqual(expect.arrayContaining(BANDS_IN_USE))
  })

  it('reports the uplink span of a band', () => {
    expect(bandRangeMhz(2)).toEqual({ lo: 1850, hi: 1909.9 })
    expect(bandRangeMhz(12)).toEqual({ lo: 699, hi: 715.9 })
    expect(bandRangeMhz(999)).toBeNull()
  })
})
