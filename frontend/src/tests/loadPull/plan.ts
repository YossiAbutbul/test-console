/**
 * Pure trombone sweep planner — list of motor positions (pulses) from the
 * captured zero to the captured end, stepping by `deltaPulses`. Direction is
 * inferred from zero vs end. No React; unit-testable.
 */
export function planPositions(
  zeroPulses: number | null,
  endPulses: number | null,
  deltaPulses: number,
): number[] {
  if (zeroPulses == null || endPulses == null || deltaPulses <= 0) return []
  const a = zeroPulses, b = endPulses
  if (a === b) return [a]
  const out: number[] = []
  const step = a < b ? deltaPulses : -deltaPulses
  for (let p = a; (step > 0 ? p <= b + 1e-9 : p >= b - 1e-9); p += step) {
    out.push(Math.round(p))
    if (out.length > 5000) break // safety
  }
  return out
}
