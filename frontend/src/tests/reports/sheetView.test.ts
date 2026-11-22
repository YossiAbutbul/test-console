import { describe, expect, it } from 'vitest'
import type { ReportSheets } from '../../api/reports'
import { BAD_BG, HEADER_BG, SUMMARY, cellText, toWorkbook } from './sheetView'

const rs: ReportSheets = {
  product: 'Sonata', notes: '',
  facts: [['Product', 'Sonata'], ['Runs', '2']],
  summary_columns: ['Run', 'Test', 'Result'],
  summary_rows: [[1, 'LoRa CW', 'Fail'], [2, 'LTE CW', 'Pass']],
  sheets: [
    {
      test: 'tx-cw-automation', name: 'LoRa CW', title: 'LoRa CW automation', entry_ids: ['a'],
      columns: ['MAC', 'Freq [MHz]', 'Measured [dBm]', 'Verdict'],
      rows: [['80E127FAA9F9', 902.3, 13.8, 'pass'], ['80E127FAA9F9', 903.3125, 12, 'fail']],
    },
    {
      test: 'lte-cw-automation', name: 'LTE CW', title: 'LTE CW automation', entry_ids: ['b'],
      columns: ['MAC', 'EARFCN'], rows: [['AABBCCDDEEFF', 18900]],
    },
  ],
}

describe('sheet cells', () => {
  it('formats numbers as the workbook does', () => {
    expect(cellText('Measured [dBm]', 13.8)).toBe('13.80')
    expect(cellText('Set [dBm]', 14)).toBe('14')
    expect(cellText('Freq [MHz]', 902.3)).toBe('902.30')
    expect(cellText('Freq [MHz]', 902.3125)).toBe('902.3125')
    expect(cellText('Freq [MHz]', 902.312)).toBe('902.312')
    expect(cellText('Measured [MHz]', '902.300172')).toBe('902.300172')
    expect(cellText('Note', null)).toBe('')
  })
})

describe('toWorkbook', () => {
  const wb = toWorkbook(rs)
  const at = (s: number, r: number, c: number) => wb[s].celldata?.find((x) => x.r === r && x.c === c)?.v

  it('has the Summary then one sheet per test type, in order', () => {
    expect(wb.map((s) => s.name)).toEqual([SUMMARY, 'LoRa CW', 'LTE CW'])
    expect(wb.map((s) => s.status)).toEqual([1, 0, 0])
  })

  it('puts the Summary table under its title and facts', () => {
    expect(at(0, 0, 0)?.v).toBe('Sonata — test report')
    expect(at(0, 2, 0)?.v).toBe('Runs')
    expect(at(0, 4, 0)).toMatchObject({ v: 'Run', bl: 1, bg: HEADER_BG })
    expect(at(0, 5, 2)).toMatchObject({ v: 'Fail', bg: BAD_BG })
    expect(at(0, 6, 2)?.bg).toBeUndefined()
  })

  it('writes a test sheet header first and its rows under it', () => {
    expect(at(1, 0, 1)).toMatchObject({ v: 'Freq [MHz]', bl: 1 })
    expect(at(1, 1, 1)).toMatchObject({ v: 902.3, m: '902.30', ct: { fa: '0.00##', t: 'n' } })
    expect(at(1, 2, 2)).toMatchObject({ v: 12, m: '12', ct: { fa: '0' } })
    expect(at(1, 2, 3)).toMatchObject({ v: 'fail', bg: BAD_BG })
    expect(wb[1].filter_select).toEqual({ row: [0, 2], column: [0, 3] })
  })
})
