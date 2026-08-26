import { describe, expect, it } from 'vitest'
import {
  isBadLimit, parseLimit, tallyVerdicts, verdictOf, verdictWithinMargin,
} from './verdict'

describe('parseLimit', () => {
  it('reads a number', () => {
    expect(parseLimit('14')).toBe(14)
    expect(parseLimit('14.5')).toBe(14.5)
    expect(parseLimit('-3')).toBe(-3)
    expect(parseLimit('  20  ')).toBe(20)
  })

  /** Blank is "no bound". `Number('')` is 0, which would be a limit that
   *  rejects almost everything, so this must not go through Number() alone. */
  it('treats blank as no bound rather than zero', () => {
    expect(parseLimit('')).toBeNull()
    expect(parseLimit('   ')).toBeNull()
    expect(parseLimit('0')).toBe(0)
  })

  it('rejects anything unparseable', () => {
    expect(parseLimit('abc')).toBeNull()
    expect(parseLimit('1-')).toBeNull()
    expect(parseLimit('--')).toBeNull()
  })
})

describe('isBadLimit', () => {
  it('is false for blank and for numbers, true for junk', () => {
    expect(isBadLimit('')).toBe(false)
    expect(isBadLimit('14')).toBe(false)
    expect(isBadLimit('abc')).toBe(true)
  })
})

describe('verdictOf', () => {
  it('passes inside the band and fails outside it', () => {
    expect(verdictOf(14, 12, 16)).toBe('pass')
    expect(verdictOf(11.9, 12, 16)).toBe('fail')
    expect(verdictOf(16.1, 12, 16)).toBe('fail')
  })

  it('treats the bounds as inclusive', () => {
    expect(verdictOf(12, 12, 16)).toBe('pass')
    expect(verdictOf(16, 12, 16)).toBe('pass')
  })

  it('accepts a one-sided limit', () => {
    // A maximum alone is the regulatory case.
    expect(verdictOf(30, null, 20)).toBe('fail')
    expect(verdictOf(19, null, 20)).toBe('pass')
    // A minimum alone is the "is the PA actually keying" case.
    expect(verdictOf(2, 10, null)).toBe('fail')
    expect(verdictOf(11, 10, null)).toBe('pass')
  })

  it('has no verdict when no limits are set', () => {
    expect(verdictOf(14, null, null)).toBeNull()
  })

  /**
   * The important one. A point with no reading has not passed anything, and
   * calling it a pass is how a dead sensor turns into a page of green.
   */
  it('has no verdict without a reading', () => {
    expect(verdictOf(null, 12, 16)).toBeNull()
    expect(verdictOf(undefined, 12, 16)).toBeNull()
    expect(verdictOf(NaN, 12, 16)).toBeNull()
  })

  it('handles negative limits', () => {
    expect(verdictOf(-5, -10, -1)).toBe('pass')
    expect(verdictOf(-12, -10, -1)).toBe('fail')
  })

  it('fails an inverted band rather than passing everything', () => {
    // min above max is an operator error; nothing can satisfy it, and silently
    // passing would be the worst possible reading of it.
    expect(verdictOf(14, 16, 12)).toBe('fail')
  })
})

describe('tallyVerdicts', () => {
  it('counts only judged points', () => {
    expect(tallyVerdicts([
      { verdict: 'pass' }, { verdict: 'fail' }, { verdict: null }, { verdict: 'pass' },
    ])).toEqual({ pass: 2, fail: 1, total: 3 })
  })

  it('is empty for an empty run', () => {
    expect(tallyVerdicts([])).toEqual({ pass: 0, fail: 0, total: 0 })
  })
})

describe('verdictWithinMargin', () => {
  it('passes inside the tolerance and fails outside it', () => {
    expect(verdictWithinMargin(14, 14, 1)).toBe('pass')
    expect(verdictWithinMargin(14.9, 14, 1)).toBe('pass')
    expect(verdictWithinMargin(15.1, 14, 1)).toBe('fail')
    expect(verdictWithinMargin(12.9, 14, 1)).toBe('fail')
  })

  it('treats the tolerance as inclusive', () => {
    expect(verdictWithinMargin(15, 14, 1)).toBe('pass')
    expect(verdictWithinMargin(13, 14, 1)).toBe('pass')
  })

  /** The reason this exists: one row can sweep several powers, and the band
   *  has to move with each of them. */
  it('tracks the set power across a sweep', () => {
    for (const target of [10, 14, 20]) {
      expect(verdictWithinMargin(target + 0.5, target, 1)).toBe('pass')
      expect(verdictWithinMargin(target + 2, target, 1)).toBe('fail')
    }
  })

  it('has no verdict when the check is off or the margin is unusable', () => {
    expect(verdictWithinMargin(14, 14, null)).toBeNull()
    expect(verdictWithinMargin(14, 14, NaN)).toBeNull()
    // Not clamped to zero: a negative margin is a typo, and inventing a limit
    // would turn a fail into a pass.
    expect(verdictWithinMargin(99, 14, -1)).toBeNull()
  })

  it('has no verdict without a reading', () => {
    expect(verdictWithinMargin(null, 14, 1)).toBeNull()
  })

  it('accepts a zero margin as an exact match', () => {
    expect(verdictWithinMargin(14, 14, 0)).toBe('pass')
    expect(verdictWithinMargin(14.1, 14, 0)).toBe('fail')
  })
})
