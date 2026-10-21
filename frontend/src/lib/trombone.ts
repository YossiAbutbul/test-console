/**
 * Trombone (MT986A on the Arcus DMX-J-SA) position units.
 *
 * The motor is commanded in pulses; people think about the line in mm. Both
 * the Trombone page and Load Pull convert at the boundary with these, so a
 * position typed on one page is the same place on the other.
 *
 * Backend counterpart: backend/loadpull/export.py formats positions with a
 * literal `pulses / 400` -- change both together.
 */
export const PULSES_PER_MM = 400

/** Pulses → mm. Exact for display: 1 pulse is 0.0025 mm. */
export const pulsesToMm = (pulses: number): number => pulses / PULSES_PER_MM

/**
 * mm → the nearest whole pulse.
 *
 * The controller only takes integers, so a typed mm value is rounded here --
 * once, at the boundary -- and the page shows the pulse count it will
 * actually send.
 */
export const mmToPulses = (mm: number): number => Math.round(mm * PULSES_PER_MM)

/** "12.34 mm" -- two decimals, matching the Load Pull results table. */
export const fmtMm = (pulses: number): string => `${pulsesToMm(pulses).toFixed(2)} mm`

/** Jog speeds, in pulses/s, for the press-and-hold jog on the Load Pull and
 *  Trombone pages. The segmented control speaks strings. */
export const JOG_SPEEDS = [
  { value: '400', label: 'Slow' },
  { value: '800', label: 'Medium' },
  { value: '1500', label: 'Fast' },
]
