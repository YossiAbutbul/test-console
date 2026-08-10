/**
 * Settle delay — how long the PA is left keyed before anything is read.
 *
 * 400 ms was found on the bench: below it the power sensor's averaged reading
 * still carries energy from the previous point, so a low-power point inherits
 * the previous high-power figure and reads as though it transmitted far more
 * than it did. Currents stay correct, which makes the mismatch look like a
 * measurement fault rather than a timing one.
 *
 * Mirrors MIN_SETTLE_MS / DEFAULT_SETTLE_MS in backend/sweep/models.py, which
 * rejects anything lower before a sweep starts.
 */

/** Nothing below this measures reliably, so the UI will not hand it over. */
export const MIN_SETTLE_MS = 400

export const DEFAULT_SETTLE_MS = 400

/**
 * Raise a value to the floor. Applied on blur and again where a run reads the
 * field — never on every keystroke, which would rewrite "4" to "400" mid-type
 * and make the field impossible to fill in.
 */
export const clampSettleMs = (ms: number): number =>
  Number.isFinite(ms) ? Math.max(MIN_SETTLE_MS, Math.round(ms)) : DEFAULT_SETTLE_MS
