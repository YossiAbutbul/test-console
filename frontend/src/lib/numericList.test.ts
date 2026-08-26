import { describe, expect, it } from 'vitest'
import { parseRangeSpec, range } from './numericList'

describe('range', () => {
  it('is inclusive', () => {
    expect(range(1, 4)).toEqual([1, 2, 3, 4])
  })
  it('normalises reversed bounds', () => {
    expect(range(4, 1)).toEqual([1, 2, 3, 4])
  })
  it('handles a single value', () => {
    expect(range(3, 3)).toEqual([3])
  })
})

describe('parseRangeSpec', () => {
  it('parses a single value', () => {
    expect(parseRangeSpec('5')).toEqual([5])
  })
  it('parses a comma list', () => {
    expect(parseRangeSpec('0,5,10,14')).toEqual([0, 5, 10, 14])
  })
  it('parses a range', () => {
    expect(parseRangeSpec('0-4')).toEqual([0, 1, 2, 3, 4])
  })
  it('parses a range with a step', () => {
    expect(parseRangeSpec('0-14:2')).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
  })
  it('walks descending ranges backwards', () => {
    expect(parseRangeSpec('4-0:2')).toEqual([4, 2, 0])
  })
  it('keeps fractional steps exact', () => {
    expect(parseRangeSpec('902.3-902.6:0.1')).toEqual([902.3, 902.4, 902.5, 902.6])
  })
  it('normalises en-dash to hyphen', () => {
    expect(parseRangeSpec('0–3')).toEqual([0, 1, 2, 3])
  })
  it('uses the fallback for empty input', () => {
    expect(parseRangeSpec('', 14)).toEqual([14])
    expect(parseRangeSpec('   ', 14)).toEqual([14])
  })
  it('returns empty for empty input with no fallback', () => {
    expect(parseRangeSpec('')).toEqual([])
  })
  it('returns empty on a zero step rather than looping forever', () => {
    expect(parseRangeSpec('0-10:0')).toEqual([])
  })
  it('drops non-numeric tokens', () => {
    expect(parseRangeSpec('1,abc,3')).toEqual([1, 3])
  })

  /**
   * A list being typed is a list with a trailing separator for as long as it
   * takes to type the next value. `Number('')` is 0 rather than NaN, so the
   * empty segment used to survive as a real data point — and in a power spec
   * that is a transmission at 0 dBm nobody asked for.
   */
  it('ignores a trailing separator instead of reading it as 0', () => {
    expect(parseRangeSpec('1880,')).toEqual([1880])
    expect(parseRangeSpec('14,')).toEqual([14])
    expect(parseRangeSpec('1880, ')).toEqual([1880])
    expect(parseRangeSpec('1,,3')).toEqual([1, 3])
    expect(parseRangeSpec(',1880')).toEqual([1880])
  })

  it('still reads a real zero', () => {
    expect(parseRangeSpec('0')).toEqual([0])
    expect(parseRangeSpec('0,10,23')).toEqual([0, 10, 23])
  })
})
