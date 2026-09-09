/**
 * How much to trust a power reading, from where it sits in the sensor's range.
 *
 * The meter loses accuracy towards both ends of its span, so a reading near an
 * edge is worth flagging even though nothing about it looks wrong. Judged on
 * the **raw** sensor reading, never the path-loss-corrected figure: the
 * correction moves the number by tens of dB without moving where the sensor
 * actually was, so a corrected value says nothing about its own uncertainty.
 *
 * Bands, as measured on the bench:
 *
 *   >= +16 dBm   poor       compression at the top of the range
 *   +10..+16     marginal
 *   -20..-25     marginal   approaching the noise floor
 *   <= -25 dBm   poor
 *
 * Outside the stated spans -- above +20 or below -30 -- the reading is further
 * into the same trouble, not out of it, so those stay `poor` rather than
 * wrapping back round to trusted.
 */
export type PowerConfidence = 'ok' | 'marginal' | 'poor'

export const POOR_HIGH_DBM = 16
export const MARGINAL_HIGH_DBM = 10
export const MARGINAL_LOW_DBM = -20
export const POOR_LOW_DBM = -25

export function powerConfidence(rawDbm: number | null | undefined): PowerConfidence {
  if (rawDbm == null || !Number.isFinite(rawDbm)) return 'ok'
  // Severity first, so the value shared by both bands (-25) reads as the worse
  // of the two rather than depending on which test ran first.
  if (rawDbm >= POOR_HIGH_DBM || rawDbm <= POOR_LOW_DBM) return 'poor'
  if (rawDbm >= MARGINAL_HIGH_DBM || rawDbm <= MARGINAL_LOW_DBM) return 'marginal'
  return 'ok'
}

/** Palette key for a confidence, or undefined to leave the text unstyled. */
export function confidenceColor(c: PowerConfidence): string | undefined {
  if (c === 'poor') return 'error.main'
  if (c === 'marginal') return 'warning.main'
  return undefined
}
