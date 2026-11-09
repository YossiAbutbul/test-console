import { describe, it, expect } from 'vitest'
import { isVisaAddress, spectrumModelLine, spectrumModelName } from './spectrumModel'

describe('spectrumModel', () => {
  it('tells a GPIB address from a LAN one', () => {
    expect(isVisaAddress('GPIB0::20::INSTR')).toBe(true)
    expect(isVisaAddress('172.16.10.1:5555')).toBe(false)
    expect(isVisaAddress('')).toBe(false)
  })

  it('names the model from the IDN, else from the address', () => {
    expect(spectrumModelName('Rohde&Schwarz,FSV3004,1330.5000K04/101234,1.80', 'GPIB0::20::INSTR')).toBe('R&S FSV3004')
    expect(spectrumModelName(null, 'GPIB0::20::INSTR')).toBe('R&S FSV3004')
    expect(spectrumModelName(null, '')).toBe('R&S FSC3')
    expect(spectrumModelLine(null, 'GPIB0::20::INSTR')).toBe('R&S FSV3004 · GPIB SCPI')
    expect(spectrumModelLine('Rohde&Schwarz,FSC3,x,V2.22', '172.16.10.1:5555')).toBe('R&S FSC3 · LAN SCPI')
  })
})
