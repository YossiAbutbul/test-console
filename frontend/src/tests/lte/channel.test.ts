import { describe, it, expect } from 'vitest'
import { convertChannelSpec } from './channel'

describe('convertChannelSpec', () => {
  it('rewrites EARFCNs as their uplink MHz and back', () => {
    const mhz = convertChannelSpec('18900', 'earfcn', 'mhz', [2])
    expect(mhz).toBe('1880')
    expect(convertChannelSpec(mhz, 'mhz', 'earfcn', [2])).toBe('18900')
  })
  it('leaves a spec it cannot fully resolve as typed', () => {
    expect(convertChannelSpec('18900, 999999', 'earfcn', 'mhz', [2])).toBe('18900, 999999')
  })
  it('is a no-op for the same unit or an empty spec', () => {
    expect(convertChannelSpec('1880', 'mhz', 'mhz', [2])).toBe('1880')
    expect(convertChannelSpec('', 'mhz', 'earfcn', [2])).toBe('')
  })
})
