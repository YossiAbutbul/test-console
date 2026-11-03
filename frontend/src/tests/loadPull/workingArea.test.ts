import { describe, it, expect } from 'vitest'
import {
  delaunay, rasterise, workingArea, gammaCell, cellGamma, impedance, NO_LIMITS, type Sample,
  isoLines, measuredBoundary, convexHull,
} from './workingArea'

// A square of four corners and its centre: Pout rises left to right.
const square: Sample[] = [
  { gr: -0.5, gi: -0.5, pout: 20, icc: 400, eff: 30 },
  { gr: 0.5, gi: -0.5, pout: 30, icc: 400, eff: 50 },
  { gr: 0.5, gi: 0.5, pout: 30, icc: 600, eff: 50 },
  { gr: -0.5, gi: 0.5, pout: 20, icc: 600, eff: 30 },
  { gr: 0, gi: 0, pout: 25, icc: 500, eff: 40 },
]

describe('delaunay', () => {
  it('splits a square with a centre into four triangles', () => {
    const t = delaunay(square.map((s) => s.gr), square.map((s) => s.gi))
    expect(t.length / 3).toBe(4)
  })
  it('needs three points', () => {
    expect(delaunay([0, 1], [0, 1])).toEqual([])
  })
})

describe('rasterise', () => {
  const n = 40
  const g = rasterise(square, n)
  it('interpolates linearly inside the hull', () => {
    const at = (gr: number, gi: number) => g.pout[gammaCell(n, gr, gi)]
    expect(at(0.01, 0.01)).toBeCloseTo(25, 0)
    expect(at(-0.24, 0.01)).toBeCloseTo(22.6, 0)
    expect(at(0.24, -0.3)).toBeCloseTo(27.4, 0)
  })
  it('leaves outside the hull empty', () => {
    expect(Number.isNaN(g.eff[gammaCell(n, 0.8, 0)])).toBe(true)
    expect(Number.isNaN(g.eff[gammaCell(n, 0, 0.9)])).toBe(true)
  })
  it('averages points measured on one spot', () => {
    const g2 = rasterise([...square, { gr: 0, gi: 0, pout: 35, icc: 500, eff: 40 }], n)
    expect(g2.pout[gammaCell(n, 0.01, 0.01)]).toBeCloseTo(30, 0)
  })
})

describe('workingArea', () => {
  const n = 40
  const g = rasterise(square, n)
  it('is the whole hull with no limits', () => {
    const a = workingArea([g], NO_LIMITS)!
    expect(a.okCells).toBe(a.measuredCells)
    expect(a.measuredCells).toBeGreaterThan(0)
  })
  it('keeps only where every limit holds, and finds the best efficiency in it', () => {
    const a = workingArea([g], { pout: [24, 28], icc: [null, 550], eff: [null, null] })!
    expect(a.okCells).toBeGreaterThan(0)
    expect(a.okCells).toBeLessThan(a.measuredCells)
    for (let i = 0; i < a.ok.length; i++) {
      if (!a.ok[i]) continue
      expect(a.pout[i]).toBeGreaterThanOrEqual(24)
      expect(a.pout[i]).toBeLessThanOrEqual(28)
      expect(a.icc[i]).toBeLessThanOrEqual(550)
    }
    // Efficiency follows Pout here, so the best is at the Pout ceiling.
    expect(a.best!.pout).toBeCloseTo(28, 0)
  })
  it('checks each frequency on its own and reports the worst', () => {
    const hot = rasterise(square.map((s) => ({ ...s, pout: s.pout + 3 })), n)
    const a = workingArea([g, hot], { pout: [null, 28], icc: [null, null], eff: [null, null] })!
    // The hotter field breaks the ceiling 3 dB sooner, so the area is its.
    for (let i = 0; i < a.ok.length; i++) if (a.ok[i]) expect(hot.pout[i]).toBeLessThanOrEqual(28)
    const i = gammaCell(n, 0.01, 0.01)
    expect(a.pout[i]).toBeCloseTo(25, 0)
  })
  it('is empty when nothing meets the limits', () => {
    const a = workingArea([g], { pout: [40, null], icc: [null, null], eff: [null, null] })!
    expect(a.okCells).toBe(0)
    expect(a.best).toBeNull()
  })
})

describe('impedance', () => {
  it('maps Γ back to Z', () => {
    expect(impedance(0, 0).r).toBeCloseTo(50)
    const z = impedance(1 / 3, 0)
    expect(z.r).toBeCloseTo(100)
    expect(z.x).toBeCloseTo(0)
  })
  it('round-trips a cell centre', () => {
    const { gr, gi } = cellGamma(40, 830)
    expect(gammaCell(40, gr, gi)).toBe(830)
  })
})

describe('contours and boundary', () => {
  const g = rasterise(square, 40)
  it('traces Pout = 25 as one straight line through the centre', () => {
    const lines = isoLines(g.pts, g.tri, 'pout', 25)
    expect(lines).toHaveLength(1)
    for (const p of lines[0]) expect(p.gr).toBeCloseTo(0)
    expect(lines[0].length).toBeGreaterThanOrEqual(3)
  })
  it('finds nothing at a level the field never reaches', () => {
    expect(isoLines(g.pts, g.tri, 'pout', 40)).toEqual([])
  })
  it('bounds the measured area by the overlap of every field', () => {
    const shifted = rasterise(square.map((s) => ({ ...s, gr: s.gr + 0.5 })), 40)
    const b = measuredBoundary([g, shifted])
    const xs = b.map((p) => p.gr)
    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.max(...xs)).toBeCloseTo(0.5)
    expect(convexHull(square)).toHaveLength(4)
  })
})

describe('contours of any quantity', () => {
  it('traces Icc at its limits and keeps a range per quantity', async () => {
    const { computeArea, buildFields } = await import('./areaCompute')
    const r = computeArea(buildFields([square]), { pout: [null, null], icc: [450, 550], eff: [null, null] }, 'icc')
    expect(r.contourKey).toBe('icc')
    // min, middle and max of the Icc limits: three levels, each a line.
    expect(r.contours[0]).toHaveLength(3)
    for (const lines of r.contours[0]) expect(lines.length).toBeGreaterThan(0)
    expect(r.area!.iccRange!.min).toBeGreaterThanOrEqual(450)
    expect(r.area!.iccRange!.max).toBeLessThanOrEqual(550)
    expect(r.area!.poutRange).not.toBeNull()
  })
})

describe('samplesKey', () => {
  it('matches equal content in different arrays and tells changed content apart', async () => {
    const { samplesKey } = await import('./useWorkingArea')
    const a = [square.map((s) => ({ ...s }))]
    const b = [square.map((s) => ({ ...s }))]
    expect(samplesKey(a)).toBe(samplesKey(b))
    const c = [square.map((s, i) => (i === 2 ? { ...s, pout: s.pout + 0.1 } : { ...s }))]
    expect(samplesKey(c)).not.toBe(samplesKey(a))
  })
})
