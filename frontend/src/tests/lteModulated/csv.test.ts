import { describe, expect, it } from 'vitest'
import { CSV_HEADER, parseLteModulatedCsv, toCsvBody } from './csv'
import { BW_OPTIONS } from './signal'
import type { LteModulatedResultRow } from '../../store/lteModulatedPageStore'

const row = (over: Partial<LteModulatedResultRow> = {}): LteModulatedResultRow => ({
  earfcn: 18900,
  band: 2,
  freq_mhz: 1880,
  set_power_dbm: 23,
  bandwidth: 2,
  mcs: 5,
  rb_count: 6,
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
const asText = (rows: LteModulatedResultRow[]): string =>
  [CSV_HEADER.join(','), ...toCsvBody(rows).map((r) => r.join(','))].join('\n')

describe('round trip', () => {
  it('survives export then import', () => {
    const original = [
      row(),
      row({
        earfcn: 20175, band: 4, freq_mhz: 1732.5, set_power_dbm: 10,
        bandwidth: 0, mcs: 12, rb_count: 6,
        verdict: 'fail', measured_dbm: 7.2, measured_dbm_raw: -13.3,
      }),
      row({ earfcn: 23010, band: 12, freq_mhz: 699, margin_db: null, verdict: null }),
    ]
    const back = parseLteModulatedCsv(asText(original))
    expect(back).toHaveLength(3)
    for (let i = 0; i < original.length; i++) {
      const o = original[i]
      const b = back[i]
      expect(b.earfcn).toBe(o.earfcn)
      expect(b.band).toBe(o.band)
      expect(b.freq_mhz).toBeCloseTo(o.freq_mhz, 3)
      expect(b.set_power_dbm).toBe(o.set_power_dbm)
      expect(b.bandwidth).toBe(o.bandwidth)
      expect(b.mcs).toBe(o.mcs)
      expect(b.rb_count).toBe(o.rb_count)
      expect(b.measured_dbm).toBeCloseTo(o.measured_dbm!, 2)
      expect(b.current_a).toBeCloseTo(o.current_a!, 5)
      expect(b.margin_db).toBe(o.margin_db)
      expect(b.verdict).toBe(o.verdict)
      expect(b.ok).toBe(o.ok)
    }
  })

  it('round-trips every bandwidth by label', () => {
    for (const bw of BW_OPTIONS) {
      const [back] = parseLteModulatedCsv(asText([row({ bandwidth: bw.code })]))
      expect(back.bandwidth).toBe(bw.code)
    }
  })

  it('recovers the raw reading from the path-loss column', () => {
    const [back] = parseLteModulatedCsv(asText([row({ measured_dbm: 22.6, measured_dbm_raw: 2.1 })]))
    expect(back.measured_dbm_raw).toBeCloseTo(2.1, 2)
    expect(back.measured_dbm! - back.measured_dbm_raw!).toBeCloseTo(20.5, 2)
  })

  it('keeps a row that failed to measure', () => {
    const [back] = parseLteModulatedCsv(asText([row({
      measured_dbm: null, measured_dbm_raw: null, current_a: null,
      verdict: null, ok: false, status: 3, error: 'tx status=3',
    })]))
    expect(back.measured_dbm).toBeNull()
    expect(back.verdict).toBeNull()
    expect(back.ok).toBe(false)
    expect(back.error).toBe('tx status=3')
  })
})

describe('parseLteModulatedCsv', () => {
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
    const back = parseLteModulatedCsv(text)
    expect(back[0].freq_mhz).toBeCloseTo(1880, 3)
    expect(back[0].band).toBe(2)
    expect(back[1].freq_mhz).toBeCloseTo(1732.5, 3)
    expect(back[1].band).toBe(4)
  })

  it('leaves an unknown EARFCN without a band rather than guessing', () => {
    const text = ['earfcn,set_power_dbm,measured_dbm', '999999,23,22.6'].join('\n')
    const [back] = parseLteModulatedCsv(text)
    expect(back.band).toBeNull()
    expect(back.freq_mhz).toBe(0)
  })

  /** A file without the signal columns is still a set of readings. */
  it('falls back to the defaults when the signal columns are absent', () => {
    const text = ['earfcn,set_power_dbm,measured_dbm', '18900,23,22.6'].join('\n')
    const [back] = parseLteModulatedCsv(text)
    expect(back.bandwidth).toBe(2)
    expect(back.mcs).toBe(5)
    expect(back.rb_count).toBe(6)
  })

  it('reads a bandwidth written as a bare figure in MHz', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,bandwidth',
      '18900,23,22.6,10',
      '18900,23,22.6,1.4',
    ].join('\n')
    const back = parseLteModulatedCsv(text)
    expect(back[0].bandwidth).toBe(3)
    expect(back[1].bandwidth).toBe(0)
  })

  it('reads columns by name, not position', () => {
    const text = [
      'error,measured_dbm,rb_count,set_power_dbm,earfcn',
      ',22.6,25,23,18900',
    ].join('\n')
    const [back] = parseLteModulatedCsv(text)
    expect(back.earfcn).toBe(18900)
    expect(back.rb_count).toBe(25)
    expect(back.measured_dbm).toBe(22.6)
  })

  it('tolerates a quoted error containing a comma', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,error',
      '18900,23,,"no signal at power sensor (-997.0 dBm), check the RF path"',
    ].join('\n')
    expect(parseLteModulatedCsv(text)[0].error)
      .toBe('no signal at power sensor (-997.0 dBm), check the RF path')
  })

  it('skips a trailing total row someone added in Excel', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm',
      '18900,23,22.6',
      ',,45.2',
    ].join('\n')
    expect(parseLteModulatedCsv(text)).toHaveLength(1)
  })

  it('recomputes a verdict the file does not carry', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,margin_db',
      '18900,23,22.6,1',
      '18900,23,20.0,1',
    ].join('\n')
    const back = parseLteModulatedCsv(text)
    expect(back[0].verdict).toBe('pass')
    expect(back[1].verdict).toBe('fail')
  })

  it('prefers the recorded verdict over recomputing it', () => {
    const text = [
      'earfcn,set_power_dbm,measured_dbm,margin_db,verdict',
      '18900,23,22.6,0.01,pass',
    ].join('\n')
    expect(parseLteModulatedCsv(text)[0].verdict).toBe('pass')
  })

  it('rejects a file that is not one of ours', () => {
    expect(() => parseLteModulatedCsv('freq_mhz,set_power_dbm,measured_dbm\n915,14,14.2'))
      .toThrow(/Not an LTE Modulated export/)
  })

  it('rejects an empty file and a header with no rows', () => {
    expect(() => parseLteModulatedCsv('')).toThrow(/empty/)
    expect(() => parseLteModulatedCsv('earfcn,set_power_dbm,measured_dbm'))
      .toThrow(/No data rows/)
  })
})

describe('shared export vocabulary', () => {
  it('uses the workbook column names', () => {
    for (const name of ['Set [dBm]', 'Measured [dBm]', 'Raw [dBm]', 'CC [mA]', 'V [V]', 'Status']) {
      expect(CSV_HEADER).toContain(name)
    }
  })

  it('round-trips the raw reading and the voltage as columns of their own', () => {
    const [back] = parseLteModulatedCsv(asText([row({ measured_dbm_raw: -6.31, voltage_v: 3.61 })]))
    expect(back.measured_dbm_raw).toBeCloseTo(-6.31, 2)
    expect(back.voltage_v).toBeCloseTo(3.61, 2)
  })

  it('round-trips a failure that carried only a DUT status', () => {
    const [back] = parseLteModulatedCsv(asText([row({
      measured_dbm: null, measured_dbm_raw: null, current_a: null,
      verdict: null, ok: false, status: 7, error: null,
    })]))
    expect(back.ok).toBe(false)
    expect(back.status).toBe(7)
    expect(back.error).toBeNull()
  })

  it('reads a file carrying a UTF-8 BOM and a # preamble', () => {
    const text = '\uFEFF# test: automation\r\n# dut_mac: 80:E1:27:20:76:DD\r\n'
      + asText([row()]).replace(/\n/g, '\r\n')
    expect(parseLteModulatedCsv(text)).toHaveLength(1)
  })
})

describe('files written with the old snake_case headers', () => {
  const old = ['earfcn,band,freq_mhz,set_power_dbm,bandwidth,mcs,rb_count,measured_dbm,current_ma,path_loss_db,margin_db,min_dbm,max_dbm,verdict,ok,status,error', '18900,2,1880,23,5 MHz,5,6,14.2,185.6,20.5,1,22,24,pass,true,0,', '18900,2,1880,23,5 MHz,5,6,,,,1,22,24,,false,3,tx status=3'].join('\n')

  it('still import', () => {
    const [ok, bad] = parseLteModulatedCsv(old)
    expect(ok.measured_dbm).toBe(14.2)
    expect(ok.current_a).toBeCloseTo(0.1856, 6)
    // No raw column then: recovered from the corrected value and the loss.
    expect(ok.measured_dbm_raw).toBeCloseTo(14.2 - 20.5, 6)
    expect(ok.voltage_v).toBeNull()
    expect(ok.verdict).toBe('pass')
    expect(ok.ok).toBe(true)
    expect(ok.status).toBe(0)
    expect(bad.ok).toBe(false)
    expect(bad.status).toBe(3)
    expect(bad.error).toBe('tx status=3')
  })

  it('still import with a BOM in front', () => {
    expect(parseLteModulatedCsv('\uFEFF' + old)).toHaveLength(2)
  })
})
