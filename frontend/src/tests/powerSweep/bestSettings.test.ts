/**
 * Ranking behind the "best settings" view.
 *
 * The sweep exists to find which combination holds a power for the least
 * current, so getting the winner wrong is the one failure that makes the whole
 * screen misleading rather than merely ugly.
 */
import { describe, expect, it } from 'vitest'
import { buildLevels } from './bestSettings'
import type { ResultRow } from '../../types/models'

let seq = 0

function row(over: Partial<ResultRow> = {}): ResultRow {
  return {
    idx: seq++,
    freq_hz: 902_300_000,
    power_dbm_setting: 14,
    pa_duty_cycle: 1,
    hp_max: 1,
    tx_power_dbm: 14,
    current_a: 0.02,
    voltage_v: 3.6,
    tx_hex: '',
    rx_hex: '',
    ok: true,
    status: 0,
    t_ms: 1,
    ...over,
  }
}

describe('buildLevels', () => {
  it('picks the lowest-current combination at each power', () => {
    const levels = buildLevels([
      row({ tx_power_dbm: 19.1, current_a: 0.080, hp_max: 1 }),
      row({ tx_power_dbm: 18.9, current_a: 0.021, hp_max: 2 }),
      row({ tx_power_dbm: 19.4, current_a: 0.055, hp_max: 3 }),
    ])

    expect(levels).toHaveLength(1)          // all round to 19
    expect(levels[0].power).toBe(19)
    expect(levels[0].best?.hp_max).toBe(2)  // 21 mA is cheapest
    expect(levels[0].bestMa).toBeCloseTo(21)
  })

  it('orders each level cheapest first', () => {
    const levels = buildLevels([
      row({ tx_power_dbm: 10, current_a: 0.05 }),
      row({ tx_power_dbm: 10, current_a: 0.01 }),
      row({ tx_power_dbm: 10, current_a: 0.03 }),
    ])

    expect(levels[0].rows.map((r) => r.current_a)).toEqual([0.01, 0.03, 0.05])
  })

  it('lists strongest power first', () => {
    const levels = buildLevels([
      row({ tx_power_dbm: -3 }),
      row({ tx_power_dbm: 19 }),
      row({ tx_power_dbm: 7 }),
    ])

    expect(levels.map((l) => l.power)).toEqual([19, 7, -3])
  })

  it('drops under-range readings, as the workbook does', () => {
    const levels = buildLevels([
      row({ tx_power_dbm: -997.5 }),
      row({ tx_power_dbm: 12 }),
    ])

    expect(levels.map((l) => l.power)).toEqual([12])
  })

  it('drops rows the sensor never measured', () => {
    expect(buildLevels([row({ tx_power_dbm: null })])).toEqual([])
  })

  it('never crowns a row with no current reading', () => {
    // A missing current is not a low one — sorting it first would recommend
    // the combination we know least about.
    const levels = buildLevels([
      row({ tx_power_dbm: 14, current_a: null }),
      row({ tx_power_dbm: 14, current_a: 0.04 }),
    ])

    expect(levels[0].best?.current_a).toBe(0.04)
    expect(levels[0].rows[0].current_a).toBe(0.04)
  })

  it('reports no winner when nothing at that power measured current', () => {
    const levels = buildLevels([row({ tx_power_dbm: 14, current_a: null })])

    expect(levels[0].best).toBeNull()
    expect(levels[0].bestMa).toBeNull()
  })

  it('handles a full sweep the shape of the real one', () => {
    // 33 power levels as seen on the bench, several combinations each.
    const rows: ResultRow[] = []
    for (let pwr = 19; pwr >= -13; pwr--) {
      for (let i = 0; i < 5; i++) {
        rows.push(row({
          tx_power_dbm: pwr + 0.2,
          // Deliberately not in order: the cheapest is the last one added.
          current_a: (5 - i) * 0.01,
          hp_max: i + 1,
        }))
      }
    }
    const levels = buildLevels(rows)

    expect(levels).toHaveLength(33)
    expect(levels[0].power).toBe(19)
    for (const l of levels) {
      expect(l.best?.hp_max).toBe(5)
      expect(l.bestMa).toBeCloseTo(10)
    }
  })
})
