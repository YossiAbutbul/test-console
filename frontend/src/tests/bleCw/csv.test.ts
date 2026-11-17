import { describe, expect, it } from 'vitest'
import { CSV_HEADER, parseBleCwCsv, toCsvBody } from './csv'
import type { BleAutomationResultRow } from '../../store/bleCwPageStore'

const row = (over: Partial<BleAutomationResultRow> = {}): BleAutomationResultRow => ({
  channel: 22,
  freq_mhz: 2446,
  power_param: 31,
  measured_dbm: 4.2,
  measured_dbm_raw: -16.3,
  current_a: 0.0123,
  voltage_v: 3.6,
  min_dbm: 3,
  max_dbm: 6,
  verdict: 'pass',
  // An unanswered tone start: the expected shape, not a fault.
  status: null,
  ok: true,
  error: null,
  ...over,
})

const asText = (rows: BleAutomationResultRow[]): string =>
  [CSV_HEADER.join(','), ...toCsvBody(rows).map((r) => r.join(','))].join('\n')

describe('round trip', () => {
  it('survives export then import', () => {
    const original = [
      row(),
      row({ channel: 0, freq_mhz: 2402, power_param: 6, measured_dbm: -9.8, verdict: 'fail', status: 0 }),
      row({ channel: 39, freq_mhz: 2480, min_dbm: null, max_dbm: null, verdict: null }),
    ]
    const back = parseBleCwCsv(asText(original))
    expect(back).toHaveLength(3)
    original.forEach((o, i) => {
      const b = back[i]
      expect(b.channel).toBe(o.channel)
      expect(b.freq_mhz).toBe(o.freq_mhz)
      expect(b.power_param).toBe(o.power_param)
      expect(b.measured_dbm).toBeCloseTo(o.measured_dbm!, 2)
      expect(b.measured_dbm_raw).toBeCloseTo(o.measured_dbm_raw!, 2)
      expect(b.current_a).toBeCloseTo(o.current_a!, 5)
      expect(b.min_dbm).toBe(o.min_dbm)
      expect(b.max_dbm).toBe(o.max_dbm)
      expect(b.verdict).toBe(o.verdict)
      expect(b.status).toBe(o.status)
      expect(b.ok).toBe(o.ok)
    })
  })

  it('keeps a point whose DUT never came back', () => {
    const [back] = parseBleCwCsv(asText([row({
      measured_dbm: null, measured_dbm_raw: null, current_a: null, verdict: null,
      ok: false, error: 'ble relink: timed out',
    })]))
    expect(back.ok).toBe(false)
    expect(back.error).toBe('ble relink: timed out')
  })
})

describe('parseBleCwCsv', () => {
  it('derives the frequency from the channel when the file has none', () => {
    const [back] = parseBleCwCsv('Channel,Power param,Measured [dBm]\n22,31,4.2')
    expect(back.freq_mhz).toBe(2446)
  })

  it('works the verdict out from the limits when the file does not say', () => {
    const back = parseBleCwCsv([
      'Channel,Power param,Measured [dBm],Min [dBm],Max [dBm]',
      '0,31,4.2,3,6',
      '0,31,7.0,3,6',
    ].join('\n'))
    expect(back.map((r) => r.verdict)).toEqual(['pass', 'fail'])
  })

  it('keeps the recorded verdict over one worked out again', () => {
    const [back] = parseBleCwCsv('Channel,Power param,Measured [dBm],Min [dBm],Verdict\n0,31,1,3,pass')
    expect(back.verdict).toBe('pass')
  })

  it('skips rows that are not a BLE channel', () => {
    const back = parseBleCwCsv('Channel,Power param,Measured [dBm]\n22,31,4.2\n40,31,4.2\n,,9')
    expect(back).toHaveLength(1)
  })

  it('rejects a file that is not one of ours', () => {
    expect(() => parseBleCwCsv('EARFCN,Set [dBm],Measured [dBm]\n18900,23,22.6'))
      .toThrow(/Not a BLE CW export/)
  })

  it('rejects an empty file and a header with no rows', () => {
    expect(() => parseBleCwCsv('')).toThrow(/empty/)
    expect(() => parseBleCwCsv(CSV_HEADER.join(','))).toThrow(/No data rows/)
  })
})
