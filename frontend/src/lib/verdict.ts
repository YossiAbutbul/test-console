/**
 * Pass/fail against a measured value.
 *
 * Lives here rather than in the panel that shows it because it is the answer a
 * test exists to produce — the one number a report is read for — and it needs
 * to be checkable without rendering anything.
 */

export type Verdict = 'pass' | 'fail'

/**
 * A limit field as the operator typed it.
 *
 * Blank means "no bound", which is not the same as zero: an empty maximum
 * lets any power through, a maximum of 0 dBm fails almost everything. Anything
 * unparseable is also null, so a half-typed "1-" cannot silently become a
 * limit that rejects good parts.
 */
export function parseLimit(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/** True when a field holds something that is neither blank nor a number. */
export function isBadLimit(raw: string): boolean {
  return raw.trim() !== '' && parseLimit(raw) == null
}

/**
 * Judge one reading against its limits.
 *
 * Either bound may be absent, so a one-sided limit works: a maximum on its own
 * is the usual regulatory case, a minimum on its own the usual "is the PA
 * actually keying" case.
 *
 * Null when there is nothing to judge — no limits, or no reading. That is
 * deliberately not `'pass'`: a point with no measurement has not passed
 * anything, and reporting it as a pass is how a broken sensor turns into a
 * page of green.
 */
export function verdictOf(
  measured: number | null | undefined,
  min: number | null,
  max: number | null,
): Verdict | null {
  if (measured == null || !Number.isFinite(measured)) return null
  if (min == null && max == null) return null
  if (min != null && measured < min) return 'fail'
  if (max != null && measured > max) return 'fail'
  return 'pass'
}

/**
 * Judge a reading against a tolerance around what was asked for.
 *
 * The form most limits actually take: "within ±1 dB of the set power". Unlike
 * a fixed min/max it survives a sweep that varies the set power in one run —
 * an absolute band would be right for one point of it and wrong for the rest.
 *
 * Null when the check is off or the margin is unusable, which is the same
 * "nothing to judge" as `verdictOf`. A negative margin is not clamped to zero:
 * it means the operator typed something they did not intend, and inventing a
 * limit for them is how a fail becomes a pass.
 */
export function verdictWithinMargin(
  measured: number | null | undefined,
  target: number,
  marginDb: number | null,
): Verdict | null {
  if (marginDb == null || !Number.isFinite(marginDb) || marginDb < 0) return null
  if (!Number.isFinite(target)) return null
  return verdictOf(measured, target - marginDb, target + marginDb)
}

/** Verdict tally for an end-of-run summary. `total` counts only judged points. */
export function tallyVerdicts(
  rows: Array<{ verdict: Verdict | null }>,
): { pass: number; fail: number; total: number } {
  let pass = 0
  let fail = 0
  for (const r of rows) {
    if (r.verdict === 'pass') pass++
    else if (r.verdict === 'fail') fail++
  }
  return { pass, fail, total: pass + fail }
}
