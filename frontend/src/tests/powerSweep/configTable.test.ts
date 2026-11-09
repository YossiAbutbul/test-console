import { describe, it, expect } from 'vitest'
import { configTableBlocks, parseConfigTable } from './configTable'
import { toWire } from './blocks'

const B = { power: { min: -9, max: 22 }, duty: { min: 1, max: 4 }, hp: { min: 1, max: 7 } }

const FULL = [
  'Target [dBm]\tPA mode\tPower (Set)\tPA DC\tHP Max\tP FAA9F9 [dBm]\tP mean [dBm]\tMax error vs target [dB]\tI mean [mA]\tStatus',
  '0\tOff\t16\t3\t1\t-0.36\t-0.41\t0.44\t26.9\tOK',
  '19\tOff\t22\t3\t7\t18.61\t18.63\t0.42\t94.5\tOK',
  '20\tOn\t1\t4\t1\t19.74\t19.66\t0.47\t178.6\tOK',
].join('\n')

describe('parseConfigTable', () => {
  it('reads the settings and PA mode out of the full analysis table', () => {
    const { rows, errors } = parseConfigTable(FULL, B)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { target: 0, paMode: 0, power: 16, duty: 3, hp: 1 },
      { target: 19, paMode: 0, power: 22, duty: 3, hp: 7 },
      { target: 20, paMode: 1, power: 1, duty: 4, hp: 1 },
    ])
  })

  it('reads the table with only the configuration columns', () => {
    const t = 'Target [dBm]\tPA mode\tPower (Set)\tPA DC\tHP Max\n28\tOn\t22\t1\t1\r\n'
    expect(parseConfigTable(t, B).rows).toEqual([{ target: 28, paMode: 1, power: 22, duty: 1, hp: 1 }])
  })

  it('finds columns by header, whatever their order', () => {
    const t = 'HP Max,Set [dBm],PA DC\n2,12,1'
    expect(parseConfigTable(t, B).rows).toEqual([{ target: null, paMode: null, power: 12, duty: 1, hp: 2 }])
  })

  it('takes the user layout when there is no header', () => {
    expect(parseConfigTable('5\tOff\t19\t1\t2', B).rows[0]).toMatchObject({ paMode: 0, power: 19, duty: 1, hp: 2 })
    expect(parseConfigTable('19 1 2', B).rows[0]).toMatchObject({ paMode: null, power: 19, duty: 1, hp: 2 })
  })

  it('says which rows are wrong', () => {
    const t = 'PA mode\tPower (Set)\tPA DC\tHP Max\nOn\t23\t1\t1\nMaybe\t5\t9\t1'
    const { rows, errors } = parseConfigTable(t, B)
    expect(rows).toEqual([])
    expect(errors).toEqual([
      'Row 1: Power 23 is outside -9 to 22.',
      'Row 2: PA DC 9 is outside 1 to 4.',
      'Row 2: PA mode "Maybe" is not Off, On or Auto.',
    ])
  })

  it('needs the three settings in a header', () => {
    expect(parseConfigTable('Target\tPA mode\n1\tOn', B).errors[0]).toMatch(/Power \(Set\), PA DC, HP Max/)
  })
})

describe('configTableBlocks', () => {
  it('makes one single-step range per row, carrying its PA mode', () => {
    const { rows } = parseConfigTable(FULL, B)
    expect(configTableBlocks(rows, B).map(toWire)).toEqual([
      { power_values: [16], duty_values: [3], hp_values: [1], pa_mode: 0 },
      { power_values: [22], duty_values: [3], hp_values: [7], pa_mode: 0 },
      { power_values: [1], duty_values: [4], hp_values: [1], pa_mode: 1 },
    ])
  })
})
