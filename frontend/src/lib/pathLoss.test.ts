import { describe, expect, it } from 'vitest'
import { findLoss, type PathLossPoint } from './pathLoss'

const TABLE: PathLossPoint[] = [
  { freqMhz: 902.3, db: 20.5 },
  { freqMhz: 915, db: 21.1 },
  { freqMhz: 927.5, db: 21.8 },
]

describe('findLoss', () => {
  it('uses the calibrated figure for a listed frequency', () => {
    expect(findLoss(TABLE, 0, 915)).toEqual({ db: 21.1, calibrated: true })
  })

  it('matches a frequency that arrived via Hz rounding', () => {
    // 902.3 MHz -> 902300000 Hz -> /1e6 is not bit-identical to the typed value.
    const viaHz = Math.round(902.3 * 1e6) / 1e6
    expect(findLoss(TABLE, 0, viaHz).calibrated).toBe(true)
  })

  it('falls back to the default and says so for an unlisted frequency', () => {
    expect(findLoss(TABLE, 12.5, 868)).toEqual({ db: 12.5, calibrated: false })
  })

  it('does not interpolate between calibrated points', () => {
    // Midway between 902.3 and 915. Guessing here would hide the very gap this
    // flag exists to expose.
    expect(findLoss(TABLE, 12.5, 908.65)).toEqual({ db: 12.5, calibrated: false })
  })

  it('treats a missing or unusable frequency as uncalibrated', () => {
    expect(findLoss(TABLE, 7, null)).toEqual({ db: 7, calibrated: false })
    expect(findLoss(TABLE, 7, undefined)).toEqual({ db: 7, calibrated: false })
    expect(findLoss(TABLE, 7, NaN)).toEqual({ db: 7, calibrated: false })
  })

  it('falls back when the table is empty', () => {
    expect(findLoss([], 3, 915)).toEqual({ db: 3, calibrated: false })
  })

  it('accepts a negative loss, which is a gain in the path', () => {
    expect(findLoss([{ freqMhz: 915, db: -1.5 }], 0, 915))
      .toEqual({ db: -1.5, calibrated: true })
  })

  it('ignores a row with a broken frequency rather than matching it', () => {
    const broken: PathLossPoint[] = [{ freqMhz: NaN, db: 9 }, { freqMhz: 915, db: 21.1 }]
    expect(findLoss(broken, 0, 915)).toEqual({ db: 21.1, calibrated: true })
  })
})
