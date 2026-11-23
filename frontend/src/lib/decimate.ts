/**
 * Thin a long trace for drawing, keeping its peaks.
 *
 * A spectrum analyzer can return tens of thousands of points, and the chart
 * drew every one as an SVG path vertex: with a live trace re-read every
 * second or so, that is the page's slowest work, for a plot a few hundred
 * pixels wide that cannot show more than one or two values per column anyway.
 *
 * Plain every-Nth sampling would be faster still, but on a spectrum it is
 * wrong: a narrow spur falls between the samples and vanishes from the plot.
 * So each bucket keeps both its minimum and its maximum, in the order they
 * occur, and the drawn line still reaches every peak and every notch.
 *
 * Only for drawing: readouts and markers come from the full trace.
 */
export function decimateMinMax<T>(points: T[], maxPoints: number, y: (p: T) => number): T[] {
  // Two points per bucket, so the bucket count is half the budget.
  const buckets = Math.floor(maxPoints / 2)
  if (buckets < 1 || points.length <= maxPoints) return points
  const out: T[] = []
  const size = points.length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size)
    const end = Math.min(points.length, Math.floor((b + 1) * size))
    if (end <= start) continue
    let lo = start
    let hi = start
    for (let i = start + 1; i < end; i++) {
      const v = y(points[i])
      if (v < y(points[lo])) lo = i
      if (v > y(points[hi])) hi = i
    }
    if (lo === hi) out.push(points[lo])
    else if (lo < hi) out.push(points[lo], points[hi])
    else out.push(points[hi], points[lo])
  }
  return out
}
