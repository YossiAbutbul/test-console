import { describe, expect, it } from 'vitest'
import { powerConfidence } from './powerConfidence'
import { outsideSensorRange, validSensorRange } from '../../lib/sensorRange'

describe('powerConfidence', () => {
  it('trusts the whole of the default -30 to +20 dBm range, ends included', () => {
    for (const dbm of [-30, -25, -10, 0, 14.56, 15, 20]) {
      expect(powerConfidence(dbm)).toBe('ok')
    }
  })

  it('flags readings outside it', () => {
    expect(powerConfidence(20.01)).toBe('poor')
    expect(powerConfidence(-30.01)).toBe('poor')
  })

  it('keeps going past the ends of the range', () => {
    // Further out is further into the same trouble, not out of it.
    expect(powerConfidence(28)).toBe('poor')
    expect(powerConfidence(-60)).toBe('poor')
    // The sensor's under-range sentinel is emphatically not a good reading.
    expect(powerConfidence(-997.5)).toBe('poor')
  })

  it('follows a configured range', () => {
    const r = { minDbm: -25, maxDbm: 15 }
    expect(powerConfidence(16, r)).toBe('poor')
    expect(powerConfidence(14, r)).toBe('ok')
  })

  it('leaves a missing reading unstyled', () => {
    expect(powerConfidence(null)).toBe('ok')
    expect(powerConfidence(undefined)).toBe('ok')
  })
})

describe('sensor range', () => {
  it('says which side a reading fell off', () => {
    expect(outsideSensorRange(-31, { minDbm: -30, maxDbm: 20 })).toBe('under')
    expect(outsideSensorRange(21, { minDbm: -30, maxDbm: 20 })).toBe('over')
    expect(outsideSensorRange(0, { minDbm: -30, maxDbm: 20 })).toBeNull()
  })
  it('falls back to the default for an unusable stored range', () => {
    expect(validSensorRange({ minDbm: 10, maxDbm: 5 })).toEqual({ minDbm: -30, maxDbm: 20 })
    expect(validSensorRange({ minDbm: -40, maxDbm: 23 })).toEqual({ minDbm: -40, maxDbm: 23 })
  })
})
