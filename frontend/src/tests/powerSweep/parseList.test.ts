import { describe, it, expect } from 'vitest'
import { parseList } from './parseList'

describe('parseList', () => {
  it('parses a single value', () => {
    expect(parseList('5')).toEqual([5])
  })
  it('parses a range', () => {
    expect(parseList('1-4')).toEqual([1, 2, 3, 4])
  })
  it('parses mixed values and ranges, sorted & unique', () => {
    expect(parseList('0-3,5,7,2')).toEqual([0, 1, 2, 3, 5, 7])
  })
  it('handles reversed ranges', () => {
    expect(parseList('4-1')).toEqual([1, 2, 3, 4])
  })
  it('handles negatives', () => {
    expect(parseList('-2--1,0')).toEqual([-2, -1, 0])
  })
  it('ignores empty tokens / whitespace', () => {
    expect(parseList(' 1 , , 3 ')).toEqual([1, 3])
  })
  it('throws on invalid token', () => {
    expect(() => parseList('1,abc')).toThrow(/Invalid token/)
  })
})
