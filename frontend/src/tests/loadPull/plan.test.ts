import { describe, it, expect } from 'vitest'
import { planPositions } from './plan'

describe('planPositions', () => {
  it('empty when an endpoint is unset', () => {
    expect(planPositions(null, 100, 10)).toEqual([])
    expect(planPositions(0, null, 10)).toEqual([])
  })
  it('empty when step is non-positive', () => {
    expect(planPositions(0, 100, 0)).toEqual([])
    expect(planPositions(0, 100, -5)).toEqual([])
  })
  it('single point when zero === end', () => {
    expect(planPositions(42, 42, 10)).toEqual([42])
  })
  it('ascending sweep includes both ends', () => {
    expect(planPositions(0, 30, 10)).toEqual([0, 10, 20, 30])
  })
  it('descending sweep steps negative', () => {
    expect(planPositions(30, 0, 10)).toEqual([30, 20, 10, 0])
  })
  it('stops before overshooting the end', () => {
    expect(planPositions(0, 25, 10)).toEqual([0, 10, 20])
  })
  it('caps runaway plans at the safety limit', () => {
    expect(planPositions(0, 1_000_000, 1).length).toBeLessThanOrEqual(5001)
  })
})
