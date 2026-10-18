import { describe, it, expect } from 'vitest'
import { PULSES_PER_MM, fmtMm, mmToPulses, pulsesToMm } from './trombone'

describe('trombone units', () => {
  it('uses the Load Pull scale of 400 pulses per mm', () => {
    expect(PULSES_PER_MM).toBe(400)
    expect(pulsesToMm(400)).toBe(1)
    expect(pulsesToMm(3200)).toBe(8)
    expect(pulsesToMm(-1)).toBe(-0.0025)
    expect(mmToPulses(8)).toBe(3200)
    expect(mmToPulses(-2.5)).toBe(-1000)
  })

  it('round-trips every whole pulse exactly', () => {
    for (let p = -200_000; p <= 200_000; p += 7) {
      expect(mmToPulses(pulsesToMm(p))).toBe(p)
    }
  })

  it('rounds a typed mm value to the nearest pulse', () => {
    expect(mmToPulses(0.0012)).toBe(0)
    expect(mmToPulses(0.0013)).toBe(1)
    expect(mmToPulses(12.3456)).toBe(4938)
    // Decimal inputs that are not exact in binary still land on the pulse.
    expect(mmToPulses(0.1)).toBe(40)
    expect(mmToPulses(1.005)).toBe(402)
  })

  it('formats to two decimals', () => {
    expect(fmtMm(4938)).toBe('12.35 mm')
    expect(fmtMm(0)).toBe('0.00 mm')
  })
})
