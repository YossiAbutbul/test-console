import { describe, expect, it } from 'vitest'
import { MEASURE_ALL, measuresAnything, requiredInstruments } from './measure'

describe('requiredInstruments', () => {
  it('asks for both by default', () => {
    expect(requiredInstruments(MEASURE_ALL)).toEqual(['power-sensor', 'dc-analyzer'])
  })

  it('asks only for the sensor when current is off', () => {
    expect(requiredInstruments({ power: true, current: false })).toEqual(['power-sensor'])
  })

  it('asks only for the DC analyzer when power is off', () => {
    expect(requiredInstruments({ power: false, current: true })).toEqual(['dc-analyzer'])
  })

  it('asks for nothing when neither is wanted', () => {
    // The point of the feature: a send that only transmits opens no VISA
    // session, so preflight has nothing to do and the caller skips it.
    expect(requiredInstruments({ power: false, current: false })).toEqual([])
  })
})

describe('measuresAnything', () => {
  it('is false only when both are off', () => {
    expect(measuresAnything({ power: false, current: false })).toBe(false)
    expect(measuresAnything({ power: true, current: false })).toBe(true)
    expect(measuresAnything({ power: false, current: true })).toBe(true)
    expect(measuresAnything(MEASURE_ALL)).toBe(true)
  })

  it('agrees with requiredInstruments', () => {
    // The two decide the same thing from opposite ends -- one gates the
    // preflight, the other gates the measurement strip -- so they must not
    // disagree about whether a send measures.
    for (const power of [true, false]) {
      for (const current of [true, false]) {
        const sel = { power, current }
        expect(measuresAnything(sel)).toBe(requiredInstruments(sel).length > 0)
      }
    }
  })
})

describe('MEASURE_ALL', () => {
  it('keeps the pre-existing behaviour as the default', () => {
    // Every caller that does not pass a selection must still read both, which
    // is what MeasurementCard falls back to.
    expect(MEASURE_ALL).toEqual({ power: true, current: true })
  })
})
