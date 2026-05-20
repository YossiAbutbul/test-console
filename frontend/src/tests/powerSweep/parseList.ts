// Parse range syntax like "1-22", "0-3,5,7" into a sorted unique number list.
export function parseList(input: string): number[] {
  const out = new Set<number>()
  for (const part of input.split(',')) {
    const tok = part.trim()
    if (!tok) continue
    const m = tok.match(/^(-?\d+)\s*-\s*(-?\d+)$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) out.add(i)
    } else if (/^-?\d+$/.test(tok)) {
      out.add(Number(tok))
    } else {
      throw new Error(`Invalid token: "${tok}"`)
    }
  }
  return [...out].sort((a, b) => a - b)
}
