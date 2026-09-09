import { describe, expect, it } from 'vitest'
import {
  blockSteps, describeProblem, newBlock, range, spanLabel, toWire, totalSteps,
  type BlockDraft, type Bounds,
} from './blocks'

const BOUNDS: Bounds = {
  power: { min: 1, max: 22 },
  duty: { min: 1, max: 4 },
  hp: { min: 1, max: 7 },
}

const block = (over: Partial<BlockDraft> = {}): BlockDraft => ({
  id: 'x', powerLo: 1, powerHi: 1, dutyLo: 1, dutyHi: 1, hpLo: 1, hpHi: 1, ...over,
})

describe('range', () => {
  it('is inclusive', () => {
    expect(range(2, 5)).toEqual([2, 3, 4, 5])
    expect(range(3, 3)).toEqual([3])
  })

  it('tolerates a span given backwards', () => {
    // The from/to fields are free text, so 12→1 is typed sooner or later.
    expect(range(5, 2)).toEqual([2, 3, 4, 5])
  })
})

describe('blockSteps', () => {
  it('is the product of the three spans', () => {
    // The user's example: power 1-12, duty 2-4, hp 1-1.
    expect(blockSteps(block({ powerLo: 1, powerHi: 12, dutyLo: 2, dutyHi: 4 }))).toBe(12 * 3 * 1)
  })
})

describe('totalSteps', () => {
  it('sums the blocks rather than multiplying them', () => {
    const rows = [
      block({ powerLo: 1, powerHi: 12, dutyLo: 2, dutyHi: 4 }),
      block({ powerLo: 13, powerHi: 22, hpLo: 1, hpHi: 2 }),
    ]
    expect(totalSteps(rows)).toBe(12 * 3 * 1 + 10 * 1 * 2)
  })

  it('is zero for an empty plan', () => {
    expect(totalSteps([])).toBe(0)
  })
})

describe('toWire', () => {
  it('expands spans into the value lists the backend takes', () => {
    expect(toWire(block({ powerLo: 1, powerHi: 3, dutyLo: 2, dutyHi: 2, hpLo: 4, hpHi: 5 })))
      .toEqual({ power_values: [1, 2, 3], duty_values: [2], hp_values: [4, 5] })
  })
})

describe('describeProblem', () => {
  it('passes a valid plan', () => {
    expect(describeProblem([block()], BOUNDS)).toBeNull()
  })

  it('rejects an empty plan', () => {
    expect(describeProblem([], BOUNDS)).toMatch(/at least one row/i)
  })

  it('names the offending row and axis', () => {
    // The backend refuses the whole run over one bad value, so the message has
    // to point at which of several rows to fix.
    const rows = [block(), block({ dutyHi: 9 })]
    expect(describeProblem(rows, BOUNDS)).toBe('Row 2: PA Duty Cycle must be within 1–4.')
  })

  it('catches a value below the floor', () => {
    // Zero is the dangerous one: the DUT hangs on it rather than refusing it.
    expect(describeProblem([block({ powerLo: 0 })], BOUNDS)).toMatch(/Power must be within/)
  })

  it('catches a non-numeric field', () => {
    expect(describeProblem([block({ hpHi: NaN })], BOUNDS)).toMatch(/HP Max needs two numbers/)
  })
})

describe('newBlock', () => {
  it('defaults to the full span of every axis', () => {
    const b = newBlock(BOUNDS)
    expect([b.powerLo, b.powerHi]).toEqual([1, 22])
    expect([b.dutyLo, b.dutyHi]).toEqual([1, 4])
    expect([b.hpLo, b.hpHi]).toEqual([1, 7])
  })

  it('copies a row but not its id', () => {
    // Duplicated rows must not share a React key with their source.
    const src = block({ powerLo: 3, powerHi: 9 })
    const copy = newBlock(BOUNDS, src)
    expect(copy.powerLo).toBe(3)
    expect(copy.powerHi).toBe(9)
    expect(copy.id).not.toBe(src.id)
  })

  it('gives every block a distinct id', () => {
    const ids = [newBlock(BOUNDS).id, newBlock(BOUNDS).id, newBlock(BOUNDS).id]
    expect(new Set(ids).size).toBe(3)
  })
})

describe('spanLabel', () => {
  it('collapses a single value', () => {
    expect(spanLabel(1, 1)).toBe('1')
    expect(spanLabel(1, 12)).toBe('1–12')
  })
})
