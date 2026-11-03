/**
 * How much to trust a power reading, from where it sits in the sensor's range.
 *
 * Judged on the **raw** sensor reading, never the path-loss-corrected figure:
 * the correction moves the number by tens of dB without moving where the
 * sensor actually was, so a corrected value says nothing about its own
 * uncertainty.
 *
 * The sensor's dynamic range is -25 to +15 dBm at its input. Inside it a
 * reading is trusted; outside it is `poor`. There used to be a `marginal`
 * band from +10 to +16 as well, which flagged readings of +14 that sit well
 * inside the range -- most of a Load Pull run at full power came out orange.
 *
 * Far outside the range -- the sensor's under-range sentinel, -997.5 -- is
 * further into the same trouble, not out of it, so it stays `poor` rather
 * than wrapping back round to trusted.
 */
export type PowerConfidence = 'ok' | 'poor'

/** The sensor's dynamic range at its input, dBm. Both ends are inside it. */
export const SENSOR_MIN_DBM = -25
export const SENSOR_MAX_DBM = 15

export function powerConfidence(rawDbm: number | null | undefined): PowerConfidence {
  if (rawDbm == null || !Number.isFinite(rawDbm)) return 'ok'
  return rawDbm < SENSOR_MIN_DBM || rawDbm > SENSOR_MAX_DBM ? 'poor' : 'ok'
}

/** Palette key for a confidence, or undefined to leave the text unstyled. */
export function confidenceColor(c: PowerConfidence): string | undefined {
  return c === 'poor' ? 'error.main' : undefined
}
