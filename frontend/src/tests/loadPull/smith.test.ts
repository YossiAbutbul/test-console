import { describe, it, expect } from 'vitest'
import { reflection, dbmToW, efficiency, rampColor, RAMP } from './smith'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'

const row = (p: Partial<LoadPullResultRow>): LoadPullResultRow => ({
  pos_pulses: 0, pos_mm: 0, power_dbm: null, current_a: null,
  r_ohm: null, x_ohm: null, s11_db: null, error: null, ...p,
})

describe('reflection (Γ)', () => {
  it('matched 50Ω load → centre (0,0)', () => {
    const g = reflection(50, 0)
    expect(g.gr).toBeCloseTo(0, 6)
    expect(g.gi).toBeCloseTo(0, 6)
  })
  it('short (0Ω) → Γ = -1', () => {
    const g = reflection(0, 0)
    expect(g.gr).toBeCloseTo(-1, 6)
    expect(g.gi).toBeCloseTo(0, 6)
  })
  it('open (huge R) → Γ ≈ +1', () => {
    const g = reflection(1e9, 0)
    expect(g.gr).toBeCloseTo(1, 4)
  })
  it('purely reactive load stays on the unit circle (|Γ|=1)', () => {
    const g = reflection(0, 50)
    expect(Math.hypot(g.gr, g.gi)).toBeCloseTo(1, 6)
  })
})

describe('dbmToW', () => {
  it('30 dBm = 1 W', () => expect(dbmToW(30)).toBeCloseTo(1, 9))
  it('0 dBm = 1 mW', () => expect(dbmToW(0)).toBeCloseTo(1e-3, 12))
  it('+3 dBm ≈ 2 mW', () => expect(dbmToW(3)).toBeCloseTo(1.995e-3, 6))
})

describe('efficiency', () => {
  it('null when power or current missing', () => {
    expect(efficiency(row({ power_dbm: 20 }))).toBeNull()
    expect(efficiency(row({ current_a: 0.1 }))).toBeNull()
  })
  it('null when current is zero/negative', () => {
    expect(efficiency(row({ power_dbm: 20, current_a: 0 }))).toBeNull()
  })
  it('30 dBm @ 3.6V·1A = 1W/3.6W ≈ 0.2778', () => {
    expect(efficiency(row({ power_dbm: 30, current_a: 1 }))).toBeCloseTo(1 / 3.6, 6)
  })
})

describe('rampColor', () => {
  it('clamps endpoints to the ramp ends', () => {
    expect(rampColor(-5)).toBe(RAMP[0])
    expect(rampColor(2)).toBe(RAMP[RAMP.length - 1])
  })
  it('returns a hex colour', () => {
    expect(rampColor(0.5)).toMatch(/^#[0-9a-f]{6}$/)
  })
})
