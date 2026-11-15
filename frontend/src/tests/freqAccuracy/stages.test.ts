import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGES, formatErrorHz, formatHz, formatMhzToHz, planPoints, pointVerdict, ppmVerdict, stageProblems, stageTols,
} from './stages'
import { convertSpec } from './radio'

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
      { freq: '868.1, 868.3', power: '14', paMode: 0, tolPpm: '' },
      { freq: '902.3-902.7:0.2', power: '20', paMode: 1, tolPpm: '5' },
      { freq: 'x', power: '14', paMode: 0, tolPpm: '20' },
    ])
    expect(pts.map((p) => p.freqMhz)).toEqual([868.1, 868.3, 902.3, 902.5, 902.7])
    expect(pts[0].limitPpm).toBeNull()
    expect(pts[2]).toMatchObject({ power: 20, paMode: 1, limitPpm: 5 })
  })

  it('measures each frequency at each of its row\'s powers', () => {
    const pts = planPoints([{ freq: '902.3,915', power: '0,16', paMode: 2, tolPpm: '20' }])
    expect(pts.map((p) => [p.freqMhz, p.power])).toEqual([[902.3, 0], [902.3, 16], [915, 0], [915, 16]])
    expect(planPoints([{ freq: '915', power: '14.5', paMode: 2, tolPpm: '20' }])).toEqual([])
  })

  it('reads LTE channels as EARFCNs or as MHz in the selected bands', () => {
    const row = { freq: '18900', power: '22.5', paMode: 0, tolPpm: '30' }
    const pts = planPoints([row], { id: 'LTE', unit: 'earfcn', bands: [2] })
    expect(pts).toMatchObject([{ freqMhz: 1880, earfcn: 18900, power: 22.5 }])
    expect(planPoints([{ ...row, freq: '1880' }], { id: 'LTE', unit: 'mhz', bands: [2] })[0].earfcn).toBe(18900)
    // In two selected bands: not picked for the operator.
    expect(planPoints([{ ...row, freq: '1880' }], { id: 'LTE', unit: 'mhz', bands: [2, 25] })).toEqual([])
    // Past the modem's 23 dBm.
    expect(planPoints([{ ...row, power: '24' }], { id: 'LTE', unit: 'earfcn', bands: [2] })).toEqual([])
    expect(convertSpec('1860,1880', 'mhz', 'earfcn', [2])).toBe('18700,18900')
  })

  it('judges a point by its own tolerance and each stage\'s', () => {
    expect(pointVerdict(1, 5, [30, 2], [null, 5])).toBe('pass')
    expect(pointVerdict(1, 5, [30, 2], [20, null])).toBe('fail')
    expect(pointVerdict(1, null, [30], [null])).toBeNull()
    expect(pointVerdict(null, 5, [], [])).toBeNull()
    expect(stageTols(undefined, 2)).toEqual(['30', '30'])
  })

  it('judges the error against the ppm limit', () => {
    expect(ppmVerdict(-9.9, 10)).toBe('pass')
    expect(ppmVerdict(10.1, 10)).toBe('fail')
    expect(ppmVerdict(3, null)).toBeNull()
  })
})
