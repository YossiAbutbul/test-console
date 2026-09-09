import { describe, expect, it } from 'vitest'
import { powerConfidence } from './powerConfidence'

describe('powerConfidence', () => {
  it('trusts the middle of the range', () => {
    for (const dbm of [-19.9, -10, 0, 5, 9.9]) {
      expect(powerConfidence(dbm)).toBe('ok')
    }
  })

  it('flags 10 to 16 dBm as marginal', () => {
    expect(powerConfidence(10)).toBe('marginal')
    expect(powerConfidence(12)).toBe('marginal')
    expect(powerConfidence(15.9)).toBe('marginal')
  })

  it('flags 16 dBm and above as poor', () => {
    expect(powerConfidence(16)).toBe('poor')
    expect(powerConfidence(20)).toBe('poor')
  })

  it('flags -20 down to -25 as marginal', () => {
    expect(powerConfidence(-20)).toBe('marginal')
    expect(powerConfidence(-24.9)).toBe('marginal')
  })

  it('flags -25 and below as poor', () => {
    expect(powerConfidence(-25)).toBe('poor')
    expect(powerConfidence(-30)).toBe('poor')
  })

  it('keeps going past the ends of the stated bands', () => {
    // Above +20 or below -30 is further into the same trouble, not out of it.
    expect(powerConfidence(28)).toBe('poor')
    expect(powerConfidence(-60)).toBe('poor')
    // The sensor's under-range sentinel is emphatically not a good reading.
    expect(powerConfidence(-997.5)).toBe('poor')
  })

  it('leaves a missing reading unstyled', () => {
    expect(powerConfidence(null)).toBe('ok')
    expect(powerConfidence(undefined)).toBe('ok')
    expect(powerConfidence(NaN)).toBe('ok')
  })

  it('takes the worse band where they meet', () => {
    // -25 is the boundary named in both bands; the more severe one wins.
    expect(powerConfidence(-25)).toBe('poor')
  })
})
