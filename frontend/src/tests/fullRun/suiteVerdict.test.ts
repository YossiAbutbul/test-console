import { describe, expect, it } from 'vitest'
import type { SetupId } from '../engine/sweepTest'
import { recablePoints, stepVerdict, type SuiteStep } from './suiteVerdict'

interface Step extends SuiteStep { name: string }

const step = (uid: string, setup: SetupId): Step => ({ uid, setup, name: uid })

describe('plan helpers', () => {
  const steps = [step('a', 'main'), step('b', 'ble'), step('c', 'main'), step('d', 'ble')]

  it('finds where the setup changes', () => {
    expect(recablePoints(steps, 'main')).toEqual([1, 2, 3])
    expect(recablePoints(steps, null)).toEqual([0, 1, 2, 3])
  })

  it('leads the verdict with FAIL', () => {
    expect(stepVerdict({ pass: 3, fail: 1, errors: 1, measured: 5 })).toBe('fail')
    expect(stepVerdict({ pass: 3, fail: 0, errors: 1, measured: 5 })).toBe('error')
    expect(stepVerdict({ pass: 3, fail: 0, errors: 0, measured: 3 })).toBe('pass')
    expect(stepVerdict({ pass: 0, fail: 0, errors: 0, measured: 3 })).toBe('na')
  })
})
