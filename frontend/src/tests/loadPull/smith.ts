/**
 * Pure impedance / efficiency helpers for the Load Pull Smith chart.
 * No React, no DOM — unit-testable.
 */
import type { LoadPullResultRow } from '../../store/loadPullPageStore'

export const Z0 = 50
export const VCC = 3.6 // supply voltage used for the efficiency denominator

/** z = (R + jX)/Z0  →  Γ = (z - 1)/(z + 1). Chart coords: unit circle r = 1. */
export function reflection(rOhm: number, xOhm: number): { gr: number; gi: number } {
  const zr = rOhm / Z0
  const zi = xOhm / Z0
  const ar = zr - 1, ai = zi
  const br = zr + 1, bi = zi
  const den = br * br + bi * bi || 1e-12
  return { gr: (ar * br + ai * bi) / den, gi: (ai * br - ar * bi) / den }
}

/** dBm → Watts. */
export const dbmToW = (dbm: number): number => Math.pow(10, (dbm - 30) / 10)

/** Drain efficiency = P_out(W) / (Vcc · Icc). null if current/power missing. */
export function efficiency(row: LoadPullResultRow): number | null {
  if (row.power_dbm == null || row.current_a == null || row.current_a <= 0) return null
  const e = dbmToW(row.power_dbm) / (VCC * row.current_a)
  return Number.isFinite(e) ? e : null
}

// Turbo-ish blue→cyan→green→yellow→red ramp (low → high).
export const RAMP = ['#2563eb', '#06b6d4', '#22c55e', '#eab308', '#dc2626']

function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Map t∈[0,1] onto the RAMP. */
export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1)
  const i = Math.floor(x)
  if (i >= RAMP.length - 1) return RAMP[RAMP.length - 1]
  return hexLerp(RAMP[i], RAMP[i + 1], x - i)
}

/**
 * |Γ| for a row, from whichever measurement it carries.
 *
 * The VNA marker reports |S11| in dB and the impedance behind it, both derived
 * from the same complex Γ, so either yields the same magnitude. The dB figure
 * is preferred because it is what the instrument reports directly; R and X are
 * a conversion further away from it.
 */
export function gammaMag(row: LoadPullResultRow): number | null {
  if (row.s11_db != null && Number.isFinite(row.s11_db)) {
    return Math.pow(10, row.s11_db / 20)
  }
  if (row.r_ohm == null || row.x_ohm == null) return null
  const { gr, gi } = reflection(row.r_ohm, row.x_ohm)
  const m = Math.hypot(gr, gi)
  return Number.isFinite(m) ? m : null
}

/**
 * VSWR = (1 + |Γ|) / (1 - |Γ|).
 *
 * Computed from the row rather than stored on it, which is what lets a file
 * exported before this column existed still show one — everything the ratio
 * needs was already being recorded per point.
 *
 * |Γ| ≥ 1 is a total reflection, or in practice a stale calibration reporting
 * marginally more coming back than went out. The ratio is unbounded there, so
 * it comes back as `Infinity`; the arithmetic left alone would turn the sign
 * over and hand back a small, entirely plausible-looking number.
 */
export function vswr(row: LoadPullResultRow): number | null {
  const g = gammaMag(row)
  if (g == null) return null
  return g >= 1 ? Infinity : (1 + g) / (1 - g)
}

/** VSWR as text: `—` when unmeasured, `∞` at or past total reflection. */
export function vswrLabel(row: LoadPullResultRow): string {
  const v = vswr(row)
  if (v == null) return '—'
  return Number.isFinite(v) ? v.toFixed(2) : '∞'
}
