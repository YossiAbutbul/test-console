import { describe, expect, it } from 'vitest'
import { computeEta, estimateRunMs } from './eta'

describe('estimateRunMs', () => {
  it('is steps times the per-step time plus any fixed cost', () => {
    expect(estimateRunMs(10, 700)).toBe(7000)
    expect(estimateRunMs(10, 700, 10_000)).toBe(17_000)
  })

  it('is zero for an empty plan, whatever the fixed cost', () => {
    expect(estimateRunMs(0, 700, 10_000)).toBe(0)
    expect(estimateRunMs(-3, 700)).toBe(0)
  })
})

describe('computeEta', () => {
  it('uses the plan alone before any step has finished', () => {
    const e = computeEta({ completed: 0, total: 10, elapsedMs: 0, plannedTotalMs: 10_000 })
    expect(e.remainingMs).toBe(10_000)
    expect(e.perStepMs).toBe(1000)
  })

  it('has nothing to say with no plan and no finished step', () => {
    expect(computeEta({ completed: 0, total: 10, elapsedMs: 5000 }).remainingMs).toBeNull()
  })

  it('uses the measured rate alone when there is no plan', () => {
    const e = computeEta({ completed: 5, total: 10, elapsedMs: 10_000 })
    expect(e.perStepMs).toBe(2000)
    expect(e.remainingMs).toBe(10_000)
  })

  it('leans towards the measured rate as steps accumulate', () => {
    // Planned 1 s/step, actually taking 2 s/step.
    const early = computeEta({ completed: 1, total: 100, elapsedMs: 2000, plannedTotalMs: 100_000 })
    const late = computeEta({ completed: 50, total: 100, elapsedMs: 100_000, plannedTotalMs: 100_000 })
    expect(early.perStepMs!).toBeGreaterThan(1000)
    expect(early.perStepMs!).toBeLessThan(1500)
    expect(late.perStepMs!).toBeGreaterThan(1900)
    expect(late.perStepMs!).toBeLessThan(2000)
  })

  it('counts down within a step rather than jumping once per step', () => {
    const base = { completed: 5, total: 10, elapsedMs: 5000 }
    const atStep = computeEta({ ...base, sinceStepMs: 0 })
    const mid = computeEta({ ...base, elapsedMs: 5500, sinceStepMs: 500 })
    expect(atStep.remainingMs).toBe(5000)
    expect(mid.remainingMs).toBe(4500)
  })

  it('holds at the next step boundary when a step overruns', () => {
    // 1 s per step so far, now 3 s into the current one.
    const e = computeEta({ completed: 5, total: 10, elapsedMs: 8000, sinceStepMs: 3000 })
    expect(e.remainingMs).toBe(4000)
  })

  it('is zero once every step is done', () => {
    expect(computeEta({ completed: 10, total: 10, elapsedMs: 9000 }).remainingMs).toBe(0)
  })

  it('never reports negative elapsed time', () => {
    expect(computeEta({ completed: 0, total: 10, elapsedMs: -50 }).elapsedMs).toBe(0)
  })
})
