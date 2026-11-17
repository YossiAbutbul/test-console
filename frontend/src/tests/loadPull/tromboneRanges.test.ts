import { describe, it, expect } from 'vitest'
import { planPositions } from './plan'
import { findRange, planTrombone, rangeAt, withRange, type FreqRange } from './tromboneRanges'

const r = (freqMhz: number, startPulses: number | null, stopPulses: number | null): FreqRange =>
  ({ freqMhz, startPulses, stopPulses })

describe('rangeAt', () => {
  it('uses a frequency\'s own range when both ends are captured', () => {
    expect(rangeAt([r(915, 100, 900)], 0, 4000, 915)).toEqual({ startPulses: 100, stopPulses: 900, own: true })
  })
  it('falls back to Zero/End when a range is missing or half-captured', () => {
    expect(rangeAt([], 0, 4000, 915)).toEqual({ startPulses: 0, stopPulses: 4000, own: false })
    expect(rangeAt([r(915, 100, null)], 0, 4000, 915)?.own).toBe(false)
  })
  it('null with neither', () => {
    expect(rangeAt([], null, 4000, 915)).toBeNull()
  })
  it('matches a frequency arrived at through arithmetic', () => {
    expect(findRange([r(902.3, 1, 2)], 902_300_000 / 1e6)).toBeDefined()
  })
})

describe('planTrombone', () => {
  it('is planPositions over Zero/End when no frequency has its own range', () => {
    const p = planTrombone([902.3, 915], [], 0, 1200, 400)
    expect(p.positions).toEqual(planPositions(0, 1200, 400))
    expect(p.at.get(400)).toEqual([0, 1])
  })
  it('measures each frequency only over its own range', () => {
    const p = planTrombone([902.3, 915], [r(902.3, 0, 400), r(915, 400, 800)], null, null, 400)
    expect(p.positions).toEqual([0, 400, 800])
    expect(p.at.get(0)).toEqual([0])
    expect(p.at.get(400)).toEqual([0, 1])
    expect(p.at.get(800)).toEqual([1])
  })
  it('steps every frequency on one grid, anchored on Zero when it is in use', () => {
    const p = planTrombone([902.3, 915], [r(915, 100, 500)], 0, 800, 400)
    expect(p.positions).toEqual([0, 400, 800])
    expect(p.at.get(400)).toEqual([0, 1])
    expect(p.ranges[0]?.own).toBe(false)
    expect(p.ranges[1]?.own).toBe(true)
  })
  it('shares positions between unaligned per-frequency ranges', () => {
    // Starts captured by hand never line up; on their own grids these two
    // would visit 0, 130, 400, 530, 800 -- on the shared one, three points.
    const p = planTrombone([902.3, 915], [r(902.3, 0, 800), r(915, 130, 930)], null, null, 400)
    expect(p.positions).toEqual([0, 400, 800])
    expect(p.at.get(0)).toEqual([0])
    expect(p.at.get(400)).toEqual([0, 1])
    expect(p.at.get(800)).toEqual([0, 1])
  })
  it('gives a range narrower than a step its nearest grid point', () => {
    const p = planTrombone([902.3, 915], [r(902.3, 0, 800), r(915, 450, 550)], null, null, 400)
    expect(p.at.get(400)).toEqual([0, 1])
  })
  it('leaves out a frequency with no range at all', () => {
    const p = planTrombone([902.3, 915], [r(915, 0, 400)], null, null, 400)
    expect(p.ranges[0]).toBeNull()
    expect([...p.at.values()].flat()).not.toContain(0)
  })
  it('runs in the Zero to End direction', () => {
    expect(planTrombone([915], [r(915, 0, 800)], 4000, 0, 400).positions).toEqual([800, 400, 0])
  })
  it('a descending Zero/End measures the same points as before the grid', () => {
    expect(planTrombone([915], [], 1000, 0, 400).positions).toEqual(planPositions(1000, 0, 400))
  })
})

describe('withRange', () => {
  it('adds, updates and drops a fully cleared entry', () => {
    let rs = withRange([], 915, { startPulses: 10 })
    expect(rs).toEqual([r(915, 10, null)])
    rs = withRange(rs, 915, { stopPulses: 20 })
    expect(rs).toEqual([r(915, 10, 20)])
    rs = withRange(rs, 915, { startPulses: null, stopPulses: null })
    expect(rs).toEqual([])
  })
})
