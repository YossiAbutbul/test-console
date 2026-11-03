import { describe, expect, it } from 'vitest'
import { powerConfidence } from './powerConfidence'

describe('powerConfidence', () => {
  it('trusts the whole of the sensor range, ends included', () => {
    for (const dbm of [-25, -20, -10, 0, 10, 14.56, 15]) {
      expect(powerConfidence(dbm)).toBe('ok')
    }
  })

  it('flags readings above +15 dBm', () => {
    expect(powerConfidence(15.01)).toBe('poor')
    expect(powerConfidence(20)).toBe('poor')
  })

  it('flags readings below -25 dBm', () => {
    expect(powerConfidence(-25.01)).toBe('poor')
    expect(powerConfidence(-30)).toBe('poor')
  })

  it('keeps going past the ends of the range', () => {
    // Further out is further into the same trouble, not out of it.
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
})
