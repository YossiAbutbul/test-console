import { describe, expect, it } from 'vitest'
import { CSV_HEADER, parseLteCwCsv, toCsvBody } from './csv'
import type { LteAutomationResultRow } from '../../store/lteCwPageStore'

const row = (over: Partial<LteAutomationResultRow> = {}): LteAutomationResultRow => ({
  earfcn: 18900,
  band: 2,
  freq_mhz: 1880,
  set_power_dbm: 23,
  measured_dbm: 22.6,
  measured_dbm_raw: 2.1,
  current_a: 0.4214,
  voltage_v: 3.6,
  margin_db: 1,
  verdict: 'pass',
  ok: true,
  status: 0,
  error: null,
  ...over,
})

/** What `downloadCsv` hands to the file, as one string. */
const asText = (rows: LteAutomationResultRow[]): string =>
  [CSV_HEADER.join(','), ...toCsvBody(rows).map((r) => r.join(','))].join('\n')

describe('round trip', () => {
  it('survives export then import', () => {
    const original = [
      row(),
      row({ earfcn: 20175, band: 4, freq_mhz: 1732.5, set_power_dbm: 10, verdict: 'fail', measured_dbm: 7.2, measured_dbm_raw: -13.3 }),
      row({ earfcn: 23010, band: 12, freq_mhz: 699, margin_db: null, verdict: null }),
    ]
    const back = parseLteCwCsv(asText(original))
    expect(back).toHaveLength(3)
    for (let i = 0; i < original.length; i++) {
      const o = original[i]
      const b = back[i]
      expect(b.earfcn).toBe(o.earfcn)
      expect(b.band).toBe(o.band)
      expect(b.freq_mhz).toBeCloseTo(o.freq_mhz, 3)
      expect(b.set_power_dbm).toBe(o.set_power_dbm)
      expect(b.measured_dbm).toBeCloseTo(o.measured_dbm!, 2)
      expect(b.current_a).toBeCloseTo(o.current_a!, 5)
      expect(b.margin_db).toBe(o.margin_db)
      expect(b.verdict).toBe(o.verdict)
      expect(b.ok).toBe(o.ok)
    }
  })

  it('recovers the raw reading from the path-loss column', () => {
    const [back] = parseLteCwCsv(asText([row({ measured_dbm: 22.6, measured_dbm_raw: 2.1 })]))
    expect(back.measured_dbm_raw).toBeCloseTo(2.1, 2)
    expect(back.measured_dbm! - back.measured_dbm_raw!).toBeCloseTo(20.5, 2)
  })

  it('keeps a row that failed to measure', () => {
    const [back] = parseLteCwCsv(asText([row({
      measured_dbm: null, measured_dbm_raw: null, current_a: null,
      verdict: null, ok: false, status: 3, error: 'tx status=3',
    })]))
    expect(back.measured_dbm).toBeNull()
    expect(back.verdict).toBeNull()
    expect(back.ok).toBe(false)
    expect(back.error).toBe('tx status=3')
  })
})

describe('parseLteCwCsv', () => {
  /**
   * The channel number is the only thing that cannot be recomputed, so a file
   * carrying just EARFCNs still imports — frequency and band come from the
   * band table.
   */
  it('derives frequency and band from the EARFCN when absent', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm',
      '18900,23,22.6',
      '20175,23,22.4',
    ].join('\n')
    const back = parseLteCwCsv(text)
    expect(back[0].freq_mhz).toBeCloseTo(1880, 3)
    expect(back[0].band).toBe(2)
    expect(back[1].freq_mhz).toBeCloseTo(1732.5, 3)
    expect(back[1].band).toBe(4)
  })

  it('leaves an unknown EARFCN without a band rather than guessing', () => {
    const text = ['earfcn,set_power_dbm,measured_dbm', '999999,23,22.6'].join('\n')
    const [back] = parseLteCwCsv(text)
    expect(back.band).toBeNull()
    expect(back.freq_mhz).toBe(0)
  })

  it('reads columns by name, not position', () => {
    const text = [
      'error,measured_dbm,set_power_dbm,earfcn',
      ',22.6,23,18900',
    ].join('\n')
    const [back] = parseLteCwCsv(text)
    expect(back.earfcn).toBe(18900)
    expect(back.measured_dbm).toBe(22.6)
  })

  it('tolerates a quoted error containing a comma', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,error',
      '18900,23,,"no signal at power sensor (-997.0 dBm), check the RF path"',
    ].join('\n')
    expect(parseLteCwCsv(text)[0].error)
      .toBe('no signal at power sensor (-997.0 dBm), check the RF path')
  })

  it('skips a trailing total row someone added in Excel', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm',
      '18900,23,22.6',
      ',,45.2',
    ].join('\n')
    expect(parseLteCwCsv(text)).toHaveLength(1)
  })

  it('recomputes a verdict the file does not carry', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,margin_db',
      '18900,23,22.6,1',
      '18900,23,20.0,1',
    ].join('\n')
    const back = parseLteCwCsv(text)
    expect(back[0].verdict).toBe('pass')
    expect(back[1].verdict).toBe('fail')
  })

  it('rejects a file that is not one of ours', () => {
    expect(() => parseLteCwCsv('freq_mhz,set_power_dbm,measured_dbm\n915,14,14.2'))
      .toThrow(/Not an LTE CW export/)
  })

  it('rejects an empty file and a header with no rows', () => {
    expect(() => parseLteCwCsv('')).toThrow(/empty/)
    expect(() => parseLteCwCsv('earfcn,set_power_dbm,measured_dbm'))
      .toThrow(/No data rows/)
  })
})
