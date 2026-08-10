import { describe, expect, it } from 'vitest'
import { parseLoadPullCsv } from './importCsv'

const HEADER = '#,pos_mm,pos_pulses,power_dbm,cc_ma,r_ohm,x_ohm,s11_db,error'
const PREAMBLE = '# freq_mhz=902.3 power_dbm=14 path_loss_db=20.5'

const SWEEP_HEADER =
  '#,pos_mm,pos_pulses,freq_mhz,set_power_dbm,power_dbm,cc_ma,r_ohm,x_ohm,s11_db,error'
const SWEEP_PREAMBLE = '# freq_spec=902.3,915 power_spec=10-20:5 path_loss_db=20.5'
const SWEEP_ROW = '1,-124.33,-49732,915,15,18.89,22.1,49.5,-3.2,-14.8,'
const PLAIN_ROW = '1,0,0,14,20,50,0,-10,'
const CRLF = String.fromCharCode(13, 10)
const LF = String.fromCharCode(10)

describe('parseLoadPullCsv', () => {
  it('reads a sweep file with per-row frequency and power', () => {
    const { rows, meta } = parseLoadPullCsv(
      [SWEEP_PREAMBLE, SWEEP_HEADER, SWEEP_ROW].join(CRLF),
    )
    expect(meta.freqSpec).toBe('902.3,915')
    expect(meta.powerSpec).toBe('10-20:5')
    expect(meta.pathLossDb).toBe(20.5)
    expect(rows[0].freq_mhz).toBe(915)
    expect(rows[0].power_dbm_setting).toBe(15)
  })

  it('leaves frequency and power unset on a pre-sweep file', () => {
    const { rows } = parseLoadPullCsv([HEADER, PLAIN_ROW].join(LF))
    expect(rows[0].freq_mhz).toBeUndefined()
    expect(rows[0].power_dbm_setting).toBeUndefined()
  })

  it('reads back what the exporter writes', () => {
    const { rows, meta } = parseLoadPullCsv(
      [PREAMBLE, HEADER, '1,-124.33,-49732,18.89,22.1,49.5,-3.2,-14.8,'].join('\r\n'),
    )

    expect(meta).toEqual({ freqMhz: 902.3, powerDbm: 14, pathLossDb: 20.5 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      pos_pulses: -49732,
      pos_mm: -124.33,
      power_dbm: 18.89,
      current_a: 0.0221,   // mA in the file, amps in the row
      r_ohm: 49.5,
      x_ohm: -3.2,
      s11_db: -14.8,
      error: null,
    })
  })

  it('imports a file with no preamble', () => {
    const { rows, meta } = parseLoadPullCsv([HEADER, '1,0,0,14,20,50,0,-10,'].join('\n'))
    expect(meta).toEqual({})
    expect(rows).toHaveLength(1)
  })

  it('treats empty cells as not-measured rather than zero', () => {
    const { rows } = parseLoadPullCsv([HEADER, '1,0,0,,,,,,'].join('\n'))
    expect(rows[0].power_dbm).toBeNull()
    expect(rows[0].current_a).toBeNull()
    expect(rows[0].s11_db).toBeNull()
  })

  it('keeps an error message that contains a comma', () => {
    const { rows } = parseLoadPullCsv(
      [HEADER, '1,0,0,,,,,,"tx status=3, no marker"'].join('\n'),
    )
    expect(rows[0].error).toBe('tx status=3, no marker')
  })

  it('survives columns being reordered by a spreadsheet', () => {
    const { rows } = parseLoadPullCsv(
      ['pos_pulses,pos_mm,s11_db,x_ohm,r_ohm,cc_ma,power_dbm', '400,1,-14.8,-3.2,49.5,22.1,18.89'].join('\n'),
    )
    expect(rows[0].pos_pulses).toBe(400)
    expect(rows[0].s11_db).toBe(-14.8)
    expect(rows[0].error).toBeNull()
  })

  it('skips rows with no position at all', () => {
    const { rows } = parseLoadPullCsv([HEADER, '1,0,0,14,20,50,0,-10,', ',,,,,,,,'].join('\n'))
    expect(rows).toHaveLength(1)
  })

  it('rejects a file that is not a Load Pull export', () => {
    expect(() => parseLoadPullCsv(['a,b,c', '1,2,3'].join('\n'))).toThrow(/missing/)
  })

  it('rejects a file with a header but no data', () => {
    expect(() => parseLoadPullCsv([PREAMBLE, HEADER].join('\n'))).toThrow(/No data rows/)
  })
})
