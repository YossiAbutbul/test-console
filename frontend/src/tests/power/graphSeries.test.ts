/**
 * Series grouping behind the TX automation results graph.
 *
 * The bug these pin: rows that share a frequency and set power but differ in
 * signal configuration were keyed identically, so all but the last vanished
 * from the chart without any sign anything was missing.
 */
import { describe, expect, it } from 'vitest'
import { buildSeries, pickAxis, type GraphableRow } from './graphSeries'

function row(over: Partial<GraphableRow> = {}): GraphableRow {
  return { freq_mhz: 915, set_power_dbm: 10, measured_dbm: 9.5, current_a: 0.1, ...over }
}

const measured = (r: GraphableRow) => r.measured_dbm

describe('buildSeries', () => {
  it('keeps one series per frequency for a plain CW run', () => {
    const rows = [
      row({ freq_mhz: 902, set_power_dbm: 0, measured_dbm: -0.5 }),
      row({ freq_mhz: 902, set_power_dbm: 10, measured_dbm: 9.6 }),
      row({ freq_mhz: 915, set_power_dbm: 0, measured_dbm: -0.2 }),
      row({ freq_mhz: 915, set_power_dbm: 10, measured_dbm: 9.8 }),
    ]
    const { series, data, xLabel } = buildSeries(rows, measured, 'set')
    expect(series.map((s) => s.label)).toEqual(['902.0 MHz', '915.0 MHz'])
    expect(xLabel).toBe('Set (dBm)')
    expect(data).toEqual([
      { x: 0, s0: -0.5, s1: -0.2 },
      { x: 10, s0: 9.6, s1: 9.8 },
    ])
  })

  it('gives each signal configuration its own series at the same freq and power', () => {
    const rows = [
      row({ series: 'LoRa · 125 kHz · SF7', measured_dbm: 9.5 }),
      row({ series: 'LoRa · 125 kHz · SF12', measured_dbm: 9.1 }),
      row({ series: 'FSK · 50000', measured_dbm: 8.7 }),
    ]
    const { series, data } = buildSeries(rows, measured, 'set')
    expect(series.map((s) => s.label)).toEqual([
      '915.0 MHz · LoRa · 125 kHz · SF7',
      '915.0 MHz · LoRa · 125 kHz · SF12',
      '915.0 MHz · FSK · 50000',
    ])
    // All three readings survive — none overwrote another.
    expect(data).toEqual([{ x: 10, s0: 9.5, s1: 9.1, s2: 8.7 }])
  })

  it('leaves the configuration out of the label when there is only one', () => {
    const rows = [
      row({ series: 'PA Auto', set_power_dbm: 0 }),
      row({ series: 'PA Auto', set_power_dbm: 10 }),
    ]
    expect(buildSeries(rows, measured, 'set').series.map((s) => s.label)).toEqual(['915.0 MHz'])
  })

  it('labels LTE frequencies with band and EARFCN where the row carries them', () => {
    const rows = [
      row({ freq_mhz: 1880, point: 'B2 · 18900 · 1880.0 MHz', set_power_dbm: 0 }),
      row({ freq_mhz: 1880, point: 'B2 · 18900 · 1880.0 MHz', set_power_dbm: 10 }),
      row({ freq_mhz: 1747.5, set_power_dbm: 0 }),
    ]
    const { series } = buildSeries(rows, measured, 'set')
    expect(series.map((s) => s.label)).toEqual(['1747.5 MHz', 'B2 · 18900 · 1880.0 MHz'])
  })

  it('crosses set power with configuration when frequency is on X', () => {
    const rows = [
      row({ freq_mhz: 1850, series: '10 MHz · MCS 5 · 50 RB', measured_dbm: 1 }),
      row({ freq_mhz: 1880, series: '10 MHz · MCS 5 · 50 RB', measured_dbm: 2 }),
      row({ freq_mhz: 1850, series: '10 MHz · MCS 20 · 50 RB', measured_dbm: 3 }),
      row({ freq_mhz: 1880, series: '10 MHz · MCS 20 · 50 RB', point: 'B2 · 18900 · 1880.0 MHz', measured_dbm: 4 }),
    ]
    const built = buildSeries(rows, measured, 'freq')
    expect(built.series.map((s) => s.label)).toEqual([
      '10 dBm · 10 MHz · MCS 5 · 50 RB',
      '10 dBm · 10 MHz · MCS 20 · 50 RB',
    ])
    expect(built.data).toEqual([
      { x: 1850, s0: 1, s1: 3 },
      { x: 1880, s0: 2, s1: 4 },
    ])
    expect(built.xText(1880)).toBe('B2 · 18900 · 1880.0 MHz')
    expect(built.xText(1850)).toBe('1850.0')
  })

  it('fills gaps with null rather than dropping the X value', () => {
    const rows = [
      row({ freq_mhz: 902, set_power_dbm: 0 }),
      row({ freq_mhz: 915, set_power_dbm: 10, measured_dbm: null }),
    ]
    expect(buildSeries(rows, measured, 'set').data).toEqual([
      { x: 0, s0: 9.5, s1: null },
      { x: 10, s0: null, s1: null },
    ])
  })

  it('lets a re-measured point replace the earlier reading', () => {
    const rows = [row({ measured_dbm: 1 }), row({ measured_dbm: 2 })]
    expect(buildSeries(rows, measured, 'set').data).toEqual([{ x: 10, s0: 2 }])
  })
})

describe('pickAxis', () => {
  it('puts the dimension with more distinct values on X, ties to set power', () => {
    expect(pickAxis([row({ freq_mhz: 1 }), row({ freq_mhz: 2 })])).toBe('freq')
    expect(pickAxis([row({ set_power_dbm: 1 }), row({ set_power_dbm: 2 })])).toBe('set')
    expect(pickAxis([row()])).toBe('set')
  })
})
