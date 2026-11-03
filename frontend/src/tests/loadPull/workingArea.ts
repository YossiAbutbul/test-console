/**
 * The load-pull working area: where on the chart every limit holds.
 *
 * The measured points are scattered -- one arc of trombone positions per
 * attenuator setting -- so each quantity is spread over the plane by linear
 * interpolation on a Delaunay triangulation of the points, which is what
 * scipy's `griddata(method='linear')` and matplotlib's `tricontourf` do.
 * Outside the points' convex hull nothing was measured, so nothing is claimed
 * there.
 *
 * Pure: no React, no DOM.
 */
export { impedance } from './smith'

/** One measured point, in the chart's Γ plane. Icc in mA, efficiency in %. */
export interface Sample {
  gr: number
  gi: number
  pout: number
  icc: number
  eff: number
}

/** [min, max]; null is no bound on that side. */
export type Bound = [number | null, number | null]

/** Pout in dBm, Icc in mA, efficiency in %. */
export interface Limits {
  pout: Bound
  icc: Bound
  eff: Bound
}

export const NO_LIMITS: Limits = { pout: [null, null], icc: [null, null], eff: [null, null] }

/**
 * Delaunay triangulation (Bowyer-Watson), as a flat list of index triples.
 *
 * Quadratic, which is plenty for a run's few hundred points and keeps a
 * geometry library out of the bundle.
 */
export function delaunay(xs: ArrayLike<number>, ys: ArrayLike<number>): number[] {
  const n = xs.length
  if (n < 3) return []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i])
  }
  const d = Math.max(maxX - minX, maxY - minY) || 1
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  const px = Array.from(xs)
  const py = Array.from(ys)
  // A triangle around everything, far enough out that its corners do not
  // decide which edges the hull keeps.
  px.push(mx - 40 * d, mx, mx + 40 * d)
  py.push(my - 40 * d, my + 40 * d, my - 40 * d)

  interface Tri { a: number; b: number; c: number; x: number; y: number; r2: number }
  const make = (a: number, b: number, c: number): Tri => {
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c]
    const den = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    // Three points in a line have no circumcircle; one that takes in every
    // point gets the sliver replaced by the next point in.
    if (Math.abs(den) < 1e-18) return { a, b, c, x: 0, y: 0, r2: Infinity }
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
    const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / den
    const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / den
    return { a, b, c, x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 }
  }

  let tris: Tri[] = [make(n, n + 1, n + 2)]
  for (let i = 0; i < n; i++) {
    const x = px[i], y = py[i]
    const keep: Tri[] = []
    const edges = new Map<string, [number, number]>()
    for (const t of tris) {
      if ((x - t.x) ** 2 + (y - t.y) ** 2 < t.r2) {
        // The hole's rim is the edges only one removed triangle has.
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
          const key = u < v ? `${u},${v}` : `${v},${u}`
          if (edges.has(key)) edges.delete(key)
          else edges.set(key, [u, v])
        }
      } else {
        keep.push(t)
      }
    }
    for (const [u, v] of edges.values()) keep.push(make(u, v, i))
    tris = keep
  }
  const out: number[] = []
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c)
  return out
}

/** One quantity per grid cell; NaN where the cell is outside the measured hull. */
export interface FieldGrid {
  n: number
  pout: Float32Array
  icc: Float32Array
  eff: Float32Array
  /** The points the grid was built from, one per spot, and their
   *  triangulation -- the contours are traced on these, not on the grid. */
  pts: Sample[]
  tri: number[]
}

/** Grid cells span Γ ∈ [-1, 1] on both axes; row 0 is the top (+jX). */
export const cellGamma = (n: number, i: number): { gr: number; gi: number } => {
  const h = 2 / n
  return { gr: -1 + ((i % n) + 0.5) * h, gi: 1 - (Math.floor(i / n) + 0.5) * h }
}

/** The cell holding a Γ, or -1 off the grid. */
export const gammaCell = (n: number, gr: number, gi: number): number => {
  const c = Math.floor((gr + 1) / (2 / n))
  const r = Math.floor((1 - gi) / (2 / n))
  return c < 0 || r < 0 || c >= n || r >= n ? -1 : r * n + c
}

/**
 * Interpolate the samples onto an n × n grid.
 *
 * Points that land on one spot (a remeasure, or two settings meeting) are
 * averaged into one: a triangulation cannot hold two values at one vertex.
 */
export function rasterise(samples: Sample[], n: number): FieldGrid {
  const merged = new Map<string, Sample & { k: number }>()
  for (const s of samples) {
    const key = `${Math.round(s.gr * 1e6)},${Math.round(s.gi * 1e6)}`
    const m = merged.get(key)
    if (!m) { merged.set(key, { ...s, k: 1 }); continue }
    m.pout += s.pout; m.icc += s.icc; m.eff += s.eff; m.k++
  }
  const pts = [...merged.values()].map((m) => ({
    gr: m.gr, gi: m.gi, pout: m.pout / m.k, icc: m.icc / m.k, eff: m.eff / m.k,
  }))
  const grid: FieldGrid = {
    n,
    pout: new Float32Array(n * n).fill(NaN),
    icc: new Float32Array(n * n).fill(NaN),
    eff: new Float32Array(n * n).fill(NaN),
    pts,
    tri: delaunay(pts.map((p) => p.gr), pts.map((p) => p.gi)),
  }
  const tri = grid.tri
  const h = 2 / n
  for (let t = 0; t < tri.length; t += 3) {
    const A = pts[tri[t]], B = pts[tri[t + 1]], C = pts[tri[t + 2]]
    const det = (B.gi - C.gi) * (A.gr - C.gr) + (C.gr - B.gr) * (A.gi - C.gi)
    if (Math.abs(det) < 1e-15) continue
    const c0 = Math.max(0, Math.floor((Math.min(A.gr, B.gr, C.gr) + 1) / h))
    const c1 = Math.min(n - 1, Math.floor((Math.max(A.gr, B.gr, C.gr) + 1) / h))
    const r0 = Math.max(0, Math.floor((1 - Math.max(A.gi, B.gi, C.gi)) / h))
    const r1 = Math.min(n - 1, Math.floor((1 - Math.min(A.gi, B.gi, C.gi)) / h))
    for (let r = r0; r <= r1; r++) {
      const y = 1 - (r + 0.5) * h
      for (let c = c0; c <= c1; c++) {
        const i = r * n + c
        if (!Number.isNaN(grid.eff[i])) continue
        const x = -1 + (c + 0.5) * h
        const wa = ((B.gi - C.gi) * (x - C.gr) + (C.gr - B.gr) * (y - C.gi)) / det
        const wb = ((C.gi - A.gi) * (x - C.gr) + (A.gr - C.gr) * (y - C.gi)) / det
        const wc = 1 - wa - wb
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue
        grid.pout[i] = wa * A.pout + wb * B.pout + wc * C.pout
        grid.icc[i] = wa * A.icc + wb * B.icc + wc * C.icc
        grid.eff[i] = wa * A.eff + wb * B.eff + wc * C.eff
      }
    }
  }
  return grid
}

const within = (v: number, [lo, hi]: Bound) => (lo == null || v >= lo) && (hi == null || v <= hi)

/** The cell everything is worst at, as a reading. */
export interface AreaPoint {
  cell: number
  gr: number
  gi: number
  pout: number
  icc: number
  eff: number
}

export interface Area {
  n: number
  /** Inside every field's measured hull. */
  measured: Uint8Array
  /** Measured, and every limit holds in every field. */
  ok: Uint8Array
  /** Worst case over the fields: lowest Pout, highest Icc, lowest efficiency. */
  pout: Float32Array
  icc: Float32Array
  eff: Float32Array
  measuredCells: number
  okCells: number
  /** The allowed cell with the best worst-case efficiency. */
  best: AreaPoint | null
  /** Worst-case efficiency over the allowed cells, for the colour ramp. */
  effRange: { min: number; max: number } | null
  /** The same for Pout and Icc, for a figure coloured by either. */
  poutRange: { min: number; max: number } | null
  iccRange: { min: number; max: number } | null
}

/**
 * Where every limit holds in every field.
 *
 * Several fields are several frequencies, which share a load (the trombone is
 * where it is) but not a reading: a load is usable only where it passes at all
 * of them, so each field is checked on its own -- a Pout ceiling tested on the
 * lowest Pout would pass a frequency that breaks it.
 */
export function workingArea(fields: FieldGrid[], limits: Limits): Area | null {
  if (fields.length === 0) return null
  const n = fields[0].n
  const N = n * n
  const area: Area = {
    n,
    measured: new Uint8Array(N),
    ok: new Uint8Array(N),
    pout: new Float32Array(N).fill(NaN),
    icc: new Float32Array(N).fill(NaN),
    eff: new Float32Array(N).fill(NaN),
    measuredCells: 0,
    okCells: 0,
    best: null,
    effRange: null,
    poutRange: null,
    iccRange: null,
  }
  const grow = (r: { min: number; max: number } | null, v: number) =>
    r ? { min: Math.min(r.min, v), max: Math.max(r.max, v) } : { min: v, max: v }
  for (let i = 0; i < N; i++) {
    let pout = Infinity, icc = -Infinity, eff = Infinity, pass = true, inside = true
    for (const f of fields) {
      const p = f.pout[i], c = f.icc[i], e = f.eff[i]
      if (Number.isNaN(e)) { inside = false; break }
      pout = Math.min(pout, p); icc = Math.max(icc, c); eff = Math.min(eff, e)
      if (!within(p, limits.pout) || !within(c, limits.icc) || !within(e, limits.eff)) pass = false
    }
    if (!inside) continue
    area.measured[i] = 1
    area.measuredCells++
    area.pout[i] = pout; area.icc[i] = icc; area.eff[i] = eff
    if (!pass) continue
    area.ok[i] = 1
    area.okCells++
    area.effRange = grow(area.effRange, eff)
    area.poutRange = grow(area.poutRange, pout)
    area.iccRange = grow(area.iccRange, icc)
    if (!area.best || eff > area.best.eff) area.best = { cell: i, ...cellGamma(n, i), pout, icc, eff }
  }
  return area
}

/** A point in the Γ plane. */
export interface G {
  gr: number
  gi: number
}

/** Convex hull, anticlockwise (Andrew's monotone chain). */
export function convexHull(pts: G[]): G[] {
  const p = [...pts].sort((a, b) => a.gr - b.gr || a.gi - b.gi)
  if (p.length < 3) return p
  const cross = (o: G, a: G, b: G) => (a.gr - o.gr) * (b.gi - o.gi) - (a.gi - o.gi) * (b.gr - o.gr)
  const lower: G[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: G[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** `subject` cut to inside the convex, anticlockwise `clip` (Sutherland-Hodgman). */
export function clipConvex(subject: G[], clip: G[]): G[] {
  let out = subject
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length]
    const side = (p: G) => (b.gr - a.gr) * (p.gi - a.gi) - (b.gi - a.gi) * (p.gr - a.gr)
    const cut = (p: G, q: G): G => {
      const t = side(p) / (side(p) - side(q))
      return { gr: p.gr + t * (q.gr - p.gr), gi: p.gi + t * (q.gi - p.gi) }
    }
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length]
      const pin = side(p) >= 0, qin = side(q) >= 0
      if (pin) out.push(p)
      if (pin !== qin) out.push(cut(p, q))
    }
  }
  return out
}

/**
 * Where the measured area of every field overlaps: the intersection of their
 * hulls. With one field it is that field's hull.
 */
export function measuredBoundary(fields: FieldGrid[]): G[] {
  let out: G[] | null = null
  for (const f of fields) {
    const h = convexHull(f.pts)
    if (h.length < 3) return []
    out = out ? clipConvex(out, h) : h
  }
  return out ?? []
}

/**
 * The lines where a quantity crosses `level`, traced on the triangulation.
 *
 * The interpolation is linear in each triangle, so inside one the contour is
 * a straight segment between the two edges it crosses -- exact, where tracing
 * it on the grid would be only as fine as the cells. Segments meet on shared
 * edges and are chained into lines, so a dash pattern runs along a whole
 * line rather than restarting on every segment.
 */
export function isoLines(pts: Sample[], tri: number[], key: 'pout' | 'icc' | 'eff', level: number): G[][] {
  const at = new Map<string, G>()
  const adj = new Map<string, string[]>()
  const node = (u: number, v: number): string => {
    const k = u < v ? `${u},${v}` : `${v},${u}`
    if (!at.has(k)) {
      const a = pts[u], b = pts[v]
      const t = (level - a[key]) / (b[key] - a[key])
      at.set(k, { gr: a.gr + t * (b.gr - a.gr), gi: a.gi + t * (b.gi - a.gi) })
      adj.set(k, [])
    }
    return k
  }
  for (let t = 0; t < tri.length; t += 3) {
    const ids = [tri[t], tri[t + 1], tri[t + 2]]
    const cross: string[] = []
    for (let e = 0; e < 3; e++) {
      const u = ids[e], v = ids[(e + 1) % 3]
      // ">=" on one side only, so a vertex exactly on the level counts once.
      if ((pts[u][key] >= level) !== (pts[v][key] >= level)) cross.push(node(u, v))
    }
    if (cross.length === 2) {
      adj.get(cross[0])!.push(cross[1])
      adj.get(cross[1])!.push(cross[0])
    }
  }
  const used = new Set<string>()
  const seg = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const walk = (start: string): G[] => {
    const line = [at.get(start)!]
    let cur = start
    for (;;) {
      const next = adj.get(cur)!.find((n) => !used.has(seg(cur, n)))
      if (next == null) break
      used.add(seg(cur, next))
      line.push(at.get(next)!)
      cur = next
    }
    return line
  }
  const lines: G[][] = []
  // Open lines from their ends first, then whatever is left is closed loops.
  for (const [k, ns] of adj) if (ns.length === 1 && ns.some((n) => !used.has(seg(k, n)))) lines.push(walk(k))
  for (const [k, ns] of adj) if (ns.some((n) => !used.has(seg(k, n)))) lines.push(walk(k))
  return lines.filter((l) => l.length > 1)
}
