import { describe, expect, it } from 'vitest'
import { CSV_HEADER, parsePowerCsv, toCsvBody } from './csv'
import type { AutomationResultRow } from '../../store/powerPageStore'

const row = (over: Partial<AutomationResultRow> = {}): AutomationResultRow => ({
  freq_mhz: 915,
  set_power_dbm: 14,
  pa_mode: 2,
  measured_dbm: 14.2,
  measured_dbm_raw: -6.3,
  current_a: 0.1856,
  voltage_v: 3.6,
  margin_db: 1,
  verdict: 'pass',
  ok: true,
  status: 0,
  error: null,
  ...over,
})

/** What `downloadCsv` hands to the file, as one string. */
const asText = (rows: AutomationResultRow[]): string =>
  [CSV_HEADER.join(','), ...toCsvBody(rows).map((r) => r.join(','))].join('\n')

describe('round trip', () => {
  it('survives export then import', () => {
    const original = [
      row(),
      row({ freq_mhz: 902.3, set_power_dbm: 20, pa_mode: 1, verdict: 'fail', measured_dbm: 17.1, measured_dbm_raw: -3.4 }),
      row({ pa_mode: 0, margin_db: null, verdict: null }),
    ]
    const back = parsePowerCsv(asText(original))
    expect(back).toHaveLength(3)
    for (let i = 0; i < original.length; i++) {
      const o = original[i]
      const b = back[i]
      expect(b.freq_mhz).toBeCloseTo(o.freq_mhz, 2)
      expect(b.set_power_dbm).toBe(o.set_power_dbm)
      expect(b.pa_mode).toBe(o.pa_mode)
      expect(b.measured_dbm).toBeCloseTo(o.measured_dbm!, 2)
      expect(b.current_a).toBeCloseTo(o.current_a!, 5)
      expect(b.margin_db).toBe(o.margin_db)
      expect(b.verdict).toBe(o.verdict)
      expect(b.ok).toBe(o.ok)
      expect(b.status).toBe(o.status)
    }
  })

  /** The raw reading is not a column; it is recovered from the corrected value
   *  and the loss that was applied, so the path-loss figure is not lost. */
  it('recovers the raw reading from the path-loss column', () => {
    const [back] = parsePowerCsv(asText([row({ measured_dbm: 14.2, measured_dbm_raw: -6.3 })]))
    expect(back.measured_dbm_raw).toBeCloseTo(-6.3, 2)
    expect(back.measured_dbm! - back.measured_dbm_raw!).toBeCloseTo(20.5, 2)
  })

  it('round-trips every PA mode by name', () => {
    for (const mode of [0, 1, 2]) {
      const [back] = parsePowerCsv(asText([row({ pa_mode: mode })]))
      expect(back.pa_mode).toBe(mode)
    }
  })

  it('keeps a row that failed to measure', () => {
    const [back] = parsePowerCsv(asText([row({
      measured_dbm: null, measured_dbm_raw: null, current_a: null,
      verdict: null, ok: false, status: 3, error: 'tx status=3',
    })]))
    expect(back.measured_dbm).toBeNull()
    expect(back.current_a).toBeNull()
    expect(back.verdict).toBeNull()
    expect(back.ok).toBe(false)
    expect(back.error).toBe('tx status=3')
  })
})

describe('parsePowerCsv', () => {
  it('reads columns by name, not position', () => {
    const text = [
      'error,measured_dbm,set_power_dbm,freq_mhz',
      ',14.2,14,915',
    ].join('\n')
    const [back] = parsePowerCsv(text)
    expect(back.freq_mhz).toBe(915)
    expect(back.set_power_dbm).toBe(14)
    expect(back.measured_dbm).toBe(14.2)
  })

  it('tolerates a quoted error containing a comma', () => {
    const text = [
      'freq_mhz,set_power_dbm,measured_dbm,error',
      '915,14,,"no signal at power sensor (-997.0 dBm), check the RF path"',
    ].join('\n')
    expect(parsePowerCsv(text)[0].error)
      .toBe('no signal at power sensor (-997.0 dBm), check the RF path')
  })

  it('skips a trailing total row someone added in Excel', () => {
    const text = [
      'freq_mhz,set_power_dbm,measured_dbm',
      '915,14,14.2',
      ',,28.4',
    ].join('\n')
    expect(parsePowerCsv(text)).toHaveLength(1)
  })

  it('recomputes a verdict the file does not carry', () => {
    const text = [
      'freq_mhz,set_power_dbm,measured_dbm,margin_db',
      '915,14,14.2,1',
      '915,20,17.0,1',
    ].join('\n')
    const back = parsePowerCsv(text)
    expect(back[0].verdict).toBe('pass')
    expect(back[1].verdict).toBe('fail')
  })

  it('prefers the recorded verdict over recomputing it', () => {
    const text = [
      'freq_mhz,set_power_dbm,measured_dbm,margin_db,verdict',
      '915,14,14.2,0.01,pass',
    ].join('\n')
    expect(parsePowerCsv(text)[0].verdict).toBe('pass')
  })

  it('rejects a file that is not one of ours', () => {
    expect(() => parsePowerCsv('pos_mm,power_dbm\n1,2'))
      .toThrow(/Not a TX CW export/)
  })

  it('rejects an empty file and a header with no rows', () => {
    expect(() => parsePowerCsv('')).toThrow(/empty/)
    expect(() => parsePowerCsv('freq_mhz,set_power_dbm,measured_dbm'))
      .toThrow(/No data rows/)
  })
})
