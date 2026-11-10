import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGES, formatErrorHz, formatHz, formatMhzToHz, planPoints, ppmVerdict, stageProblems,
} from './stages'

describe('frequency accuracy stages', () => {
  it('accepts the defaults', () => {
    expect(stageProblems(DEFAULT_STAGES)).toEqual([])
  })

  it('wants each stage narrower than the one before', () => {
    const s = [DEFAULT_STAGES[0], { ...DEFAULT_STAGES[1], span_hz: 2_000_000 }]
    expect(stageProblems(s)).toEqual(['Stage 2: span must be narrower than stage 1'])
  })

  it('wants RBW inside the span', () => {
    expect(stageProblems([{ span_hz: 1000, rbw_hz: 1000, vbw_hz: 10 }])[0]).toMatch(/RBW/)
  })

  it('formats', () => {
    expect(formatHz(1_000_000)).toBe('1 MHz')
    expect(formatHz(20_000)).toBe('20 kHz')
    expect(formatHz(10)).toBe('10 Hz')
    expect(formatMhzToHz(902_300_171.7)).toBe('902.300 172')
    expect(formatErrorHz(4321.7)).toBe('+4 322')
    expect(formatErrorHz(-12.04)).toBe('−12')
    expect(formatErrorHz(-0.4)).toBe('0')
  })
})

describe('frequency accuracy plan', () => {
  it('expands each row across its bands', () => {
    const pts = planPoints([
      { freq: '868.1, 868.3', power: '14', paMode: 0 },
      { freq: '902.3-902.7:0.2', power: '20', paMode: 1 },
      { freq: 'x', power: '14', paMode: 0 },
    ])
    expect(pts.map((p) => p.freqMhz)).toEqual([868.1, 868.3, 902.3, 902.5, 902.7])
    expect(pts[2]).toMatchObject({ power: 20, paMode: 1 })
  })

  it('judges the error against the ppm limit', () => {
    expect(ppmVerdict(-9.9, 10)).toBe('pass')
    expect(ppmVerdict(10.1, 10)).toBe('fail')
    expect(ppmVerdict(3, null)).toBeNull()
  })
})
