import type { SweepBlock } from '../../types/models'

/**
 * Multi-range sweep planning.
 *
 * A sweep is normally one cross-product of three spans. That cannot express
 * "power 1–12 while duty is 2–4, then power 13–22 while duty is 1" — which had
 * to be two runs with their exports stitched together. A block list is the
 * same thing in one run: each block is still a plain cross-product, and the
 * run is their concatenation.
 *
 * Kept apart from the page so the arithmetic — which is what decides how long
 * a run takes and whether it is even valid — can be tested without rendering.
 */

/** One row of the advanced editor: a span on each axis. */
export interface BlockDraft {
  /** Stable across re-orders and deletions, so React keys do not shuffle. */
  id: string
  powerLo: number
  powerHi: number
  dutyLo: number
  dutyHi: number
  hpLo: number
  hpHi: number
}

export interface AxisBounds {
  min: number
  max: number
}

export interface Bounds {
  power: AxisBounds
  duty: AxisBounds
  hp: AxisBounds
}

/** Inclusive, and tolerant of a span given the wrong way round. */
export function range(lo: number, hi: number): number[] {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const out: number[] = []
  for (let v = a; v <= b; v++) out.push(v)
  return out
}

export function blockSteps(b: BlockDraft): number {
  return range(b.powerLo, b.powerHi).length
    * range(b.dutyLo, b.dutyHi).length
    * range(b.hpLo, b.hpHi).length
}

export function totalSteps(blocks: BlockDraft[]): number {
  return blocks.reduce((n, b) => n + blockSteps(b), 0)
}

export function toWire(b: BlockDraft): SweepBlock {
  return {
    power_values: range(b.powerLo, b.powerHi),
    duty_values: range(b.dutyLo, b.dutyHi),
    hp_values: range(b.hpLo, b.hpHi),
  }
}

let seq = 0
export function newBlock(bounds: Bounds, from?: BlockDraft): BlockDraft {
  seq += 1
  if (from) return { ...from, id: `b${seq}` }
  return {
    id: `b${seq}`,
    powerLo: bounds.power.min, powerHi: bounds.power.max,
    dutyLo: bounds.duty.min, dutyHi: bounds.duty.max,
    hpLo: bounds.hp.min, hpHi: bounds.hp.max,
  }
}

/**
 * Why a plan cannot run, or null.
 *
 * The backend range-checks every block and refuses the whole run, so catching
 * it here is only about saying so before the operator waits for a rejection.
 */
export function describeProblem(blocks: BlockDraft[], bounds: Bounds): string | null {
  if (blocks.length === 0) return 'Add at least one row.'
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const axes: Array<[string, number, number, AxisBounds]> = [
      ['Power', b.powerLo, b.powerHi, bounds.power],
      ['PA Duty Cycle', b.dutyLo, b.dutyHi, bounds.duty],
      ['HP Max', b.hpLo, b.hpHi, bounds.hp],
    ]
    for (const [name, lo, hi, ax] of axes) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        return `Row ${i + 1}: ${name} needs two numbers.`
      }
      if (Math.min(lo, hi) < ax.min || Math.max(lo, hi) > ax.max) {
        return `Row ${i + 1}: ${name} must be within ${ax.min}–${ax.max}.`
      }
    }
  }
  return null
}

/** A short, readable span: "1–12", or "5" when it is a single value. */
export function spanLabel(lo: number, hi: number): string {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  return a === b ? String(a) : `${a}–${b}`
}

export function blockLabel(b: BlockDraft): string {
  return `Power ${spanLabel(b.powerLo, b.powerHi)}`
    + ` · PA DC ${spanLabel(b.dutyLo, b.dutyHi)}`
    + ` · HP ${spanLabel(b.hpLo, b.hpHi)}`
}
