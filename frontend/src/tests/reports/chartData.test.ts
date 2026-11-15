import { describe, expect, it } from 'vitest'
import type { ReportEntry } from '../../api/reports'
import { chartData, defaultAxes, niceTicks, numericColumns } from './chartData'

const cw = {
  columns: ['Freq [MHz]', 'Set [dBm]', 'PA mode', 'Measured [dBm]', 'Raw [dBm]', 'Verdict'],
  rows: [[915, 14, 'Auto', '14.1', '13.3', 'pass'], [902.3, 14, 'Auto', 13.8, 13, 'pass'], [927.5, 14, 'Auto', 12.6, '', 'fail']],
} as unknown as ReportEntry

describe('report charts', () => {
  it('finds the number columns, words excluded', () => {
    expect(numericColumns(cw)).toEqual([0, 1, 3, 4])
  })

  it('starts from frequency across and the measured value up', () => {
    expect(defaultAxes(cw)).toEqual({ x: 0, ys: [3] })
  })

  it('sorts the points along a numeric X', () => {
    const d = chartData(cw, 0, [3, 4])
    expect(d.xs).toEqual([902.3, 915, 927.5])
    expect(d.ys).toEqual([[13.8, 14.1, 12.6], [13, 13.3, null]])
    expect(d.names).toEqual(['Measured [dBm]', 'Raw [dBm]'])
  })

  it('keeps the rows in order across a word column', () => {
    const d = chartData(cw, 2, [3])
    expect(d.numericX).toBe(false)
    expect(d.xs).toEqual(['Auto', 'Auto', 'Auto'])
  })

  it('makes round ticks', () => {
    expect(niceTicks(12.6, 14.1)).toEqual([12.5, 13, 13.5, 14, 14.5])
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100])
  })
})
