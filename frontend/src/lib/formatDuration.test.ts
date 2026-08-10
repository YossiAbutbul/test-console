import { describe, expect, it } from 'vitest'
import { formatDuration } from './format'

describe('formatDuration', () => {
  it('pads every part so runs of different length line up', () => {
    expect(formatDuration(0)).toBe('00:00:00')
    expect(formatDuration(5_000)).toBe('00:00:05')
    expect(formatDuration(65_000)).toBe('00:01:05')
  })

  it('keeps hours rather than rolling over', () => {
    expect(formatDuration(3_600_000)).toBe('01:00:00')
    expect(formatDuration(2 * 3_600_000 + 3 * 60_000 + 4_000)).toBe('02:03:04')
    // A 600-point sweep at 400 ms settle runs well past a day's worth of
    // minutes; hours must keep counting instead of wrapping.
    expect(formatDuration(30 * 3_600_000)).toBe('30:00:00')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(1_600)).toBe('00:00:02')
    expect(formatDuration(1_400)).toBe('00:00:01')
  })

  it('never renders a negative clock', () => {
    expect(formatDuration(-5_000)).toBe('00:00:00')
  })
})
