import { describe, expect, it } from 'vitest'
import { parseBound, yDomain } from './chartOptions'

describe('yDomain', () => {
  it('uses the typed bounds when they are numbers', () => {
    expect(yDomain({ yMin: -10, yMax: 20 })).toEqual([-10, 20])
  })

  it('falls back per bound while a field is blank or half-typed', () => {
    expect(yDomain({ yMin: null, yMax: 5 })).toEqual(['dataMin', 5])
    expect(yDomain({ yMin: parseBound('-'), yMax: null }, [0, 'auto'])).toEqual([0, 'auto'])
  })
})

describe('parseBound', () => {
  it('treats blank as auto', () => {
    expect(parseBound('  ')).toBeNull()
    expect(parseBound('3.5')).toBe(3.5)
  })
})
