import { describe, it, expect } from 'vitest'
import { configsInTabs, remeasureBlocks, roundHalfEven, tabCounts, tabOf } from './remeasure'

const row = (tx: number | null, power: number, duty = 1, hp = 1) => ({
  tx_power_dbm: tx, power_dbm_setting: power, pa_duty_cycle: duty, hp_max: hp,
})

describe('remeasure', () => {
  it('rounds half to even, as the export’s tabs do', () => {
    expect(roundHalfEven(10.5)).toBe(10)
    expect(roundHalfEven(11.5)).toBe(12)
    expect(roundHalfEven(10.2)).toBe(10)
    expect(roundHalfEven(10.51)).toBe(11)
    expect(roundHalfEven(-0.5)).toBe(0)
    expect(roundHalfEven(-1.5)).toBe(-2)
  })

  it('puts nothing on a tab that measured nothing usable', () => {
    expect(tabOf({ tx_power_dbm: null })).toBeNull()
    expect(tabOf({ tx_power_dbm: -97 })).toBeNull()
    expect(tabOf({ tx_power_dbm: 4.4 })).toBe(4)
  })

  it('counts rows per tab, lowest first', () => {
    expect(tabCounts([row(3.2, 1), row(2.8, 2), row(10.4, 9), row(null, 4)]))
      .toEqual([{ tab: 3, count: 2 }, { tab: 10, count: 1 }])
  })

  it('takes every row on the chosen tabs, 10.2 included for "to 10"', () => {
    const rows = [row(-0.3, 1), row(5, 4), row(10.2, 8), row(10.6, 9), row(12, 10)]
    expect(configsInTabs(rows, 0, 10).map((c) => c.power)).toEqual([1, 4, 8])
    // Either order of the bounds.
    expect(configsInTabs(rows, 10, 0).map((c) => c.power)).toEqual([1, 4, 8])
  })

  it('takes a configuration once, keeping the run’s order', () => {
    const rows = [row(4, 3, 2, 1), row(6, 5, 1, 1), row(4.2, 3, 2, 1)]
    expect(configsInTabs(rows, 0, 10)).toEqual([
      { power: 3, duty: 2, hp: 1 }, { power: 5, duty: 1, hp: 1 },
    ])
  })

  it('runs each configuration as one single-step block', () => {
    expect(remeasureBlocks([{ power: 3, duty: 2, hp: 7 }])).toEqual([
      { power_values: [3], duty_values: [2], hp_values: [7] },
    ])
  })
})
