import { describe, expect, it } from 'vitest'
import { decimateMinMax } from './decimate'

const y = (v: number) => v

describe('decimateMinMax', () => {
  it('leaves a short trace alone', () => {
    const pts = [1, 2, 3]
    expect(decimateMinMax(pts, 10, y)).toBe(pts)
  })

  it('keeps a one-point spur a plain sample would skip', () => {
    const pts = new Array(10_000).fill(-90)
    pts[4_321] = -20
    const out = decimateMinMax(pts, 200, y)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(Math.max(...out)).toBe(-20)
  })

  it('keeps a notch as well as a peak', () => {
    const pts = new Array(10_000).fill(-50)
    pts[100] = -10
    pts[9_000] = -110
    const out = decimateMinMax(pts, 100, y)
    expect(Math.max(...out)).toBe(-10)
    expect(Math.min(...out)).toBe(-110)
  })

  it('keeps the points in trace order', () => {
    const pts = Array.from({ length: 5_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) }))
    const out = decimateMinMax(pts, 500, (p) => p.y)
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x)
  })
})
