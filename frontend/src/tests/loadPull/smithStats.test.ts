import { describe, it, expect } from 'vitest'
import { pointStats } from './smithStats'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'

const row = (p: Partial<LoadPullResultRow>): LoadPullResultRow => ({
  pos_pulses: 0, pos_mm: 0, power_dbm: null, current_a: null,
  r_ohm: null, x_ohm: null, s11_db: null, error: null, ...p,
})

describe('pointStats', () => {
  it('finds min, max and the mean, keeping where each extreme was', () => {
    const rows = [
      row({ power_dbm: 12, current_a: 0.1 }),
      row({ power_dbm: 15, current_a: 0.2 }),
      row({ power_dbm: 9, current_a: 0.15 }),
    ].map((r, i) => ({ row: r, idx: i + 10 }))
    const s = pointStats(rows)
    expect(s.pout).toEqual({ min: { v: 9, idx: 12 }, max: { v: 15, idx: 11 }, avg: 12, n: 3 })
    expect(s.cc?.max.idx).toBe(11)
    expect(s.eff?.n).toBe(3)
  })
  it('leaves out failed rows and readings that are missing', () => {
    const rows = [
      row({ power_dbm: 30, current_a: 0.1, error: 'timed out' }),
      row({ power_dbm: 10 }),
      row({}),
    ].map((r, i) => ({ row: r, idx: i }))
    const s = pointStats(rows)
    expect(s.pout).toEqual({ min: { v: 10, idx: 1 }, max: { v: 10, idx: 1 }, avg: 10, n: 1 })
    expect(s.cc).toBeNull()
    expect(s.eff).toBeNull()
  })
})
