import { describe, expect, it } from 'vitest'
import { channelFromMhz, channelMhz, offAirReason } from './radio'

describe('channels', () => {
  it('maps 0-39 to 2402-2480 MHz and back', () => {
    expect(channelMhz(0)).toBe(2402)
    expect(channelMhz(39)).toBe(2480)
    expect(channelFromMhz(2446)).toBe(22)
    expect(channelFromMhz(2403)).toBeNull()
    expect(channelFromMhz(2482)).toBeNull()
  })
})

describe('offAirReason', () => {
  it('accepts a reading that finished while the tone was on air', () => {
    expect(offAirReason(1_000, 5_000, 600)).toBeNull()
    expect(offAirReason(5_000, 5_000, 600)).toBeNull()
  })

  it('refuses one that finished after the tone ended, and says by how much', () => {
    expect(offAirReason(6_200, 5_000, 4_800)).toMatch(/1\.2 s after the tone ended \(read took 4\.8 s\)/)
  })

  it('has nothing to judge without a tone', () => {
    expect(offAirReason(9_000, null, 100)).toBeNull()
  })
})
