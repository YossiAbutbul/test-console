import { describe, expect, it } from 'vitest'
import { csvPreamble, exportName, timestamp } from './download'

describe('exportName', () => {
  it('is <MAC>_<test>_<local timestamp>.<ext>', () => {
    expect(exportName('tx-cw-automation', '80:e1:27:20:76:dd', 'csv'))
      .toMatch(/^80E1272076DD_tx-cw-automation_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/)
  })

  it('says noDUT when no DUT is connected', () => {
    expect(exportName('lte-cw-automation', null, 'csv')).toMatch(/^noDUT_lte-cw-automation_/)
  })
})

describe('timestamp', () => {
  it('is local time in a filesystem-safe form', () => {
    expect(timestamp(new Date(2026, 6, 28, 14, 5, 31))).toBe('2026-07-28T14-05-31')
  })
})

describe('csvPreamble', () => {
  it('writes # lines, skipping empty values, with the export time', () => {
    const lines = csvPreamble({ test: 'TX CW automation', dut_mac: null }, new Date(2026, 6, 28, 14, 5, 31))
    expect(lines).toEqual([
      '# test: TX CW automation',
      '# exported: 2026-07-28 14:05:31',
      '# app: Test Console',
    ])
  })

  it('cannot be broken out of by a newline in a value', () => {
    const [line] = csvPreamble({ notes: 'one\r\ntwo' })
    expect(line).toBe('# notes: one two')
  })
})
