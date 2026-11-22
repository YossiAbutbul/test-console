import { describe, expect, it } from 'vitest'
import type { ReportEntryDraft } from '../../api/reports'
import { fingerprint, nextRunDut, normMac } from './runDut'

const draft = (rows: ReportEntryDraft['rows']): ReportEntryDraft =>
  ({ test: 'tx-cw-automation', title: 'LoRa CW automation', columns: ['Freq', 'Verdict'], rows })
const A = { mac: '80:E1:27:FA:A9:F9', name: 'Sonata' }
const B = { mac: '112233445566', name: 'Other' }

describe('the DUT a run was measured on', () => {
  it('is the one connected while results came in', () => {
    const fp = fingerprint(draft([[902.3, 'pass']]))
    expect(nextRunDut(undefined, fp, A)).toEqual({ mac: '80E127FAA9F9', name: 'Sonata', fp })
  })

  it('is kept when the DUT disconnects or another one connects', () => {
    const fp = fingerprint(draft([[902.3, 'pass']]))
    const measured = nextRunDut(undefined, fp, A)
    expect(nextRunDut(measured, fp, null)).toBe(measured)
    expect(nextRunDut(measured, fp, B)).toBe(measured)
  })

  it('moves to the unit that measured a new run', () => {
    const first = nextRunDut(undefined, fingerprint(draft([[902.3, 'pass']])), A)
    const fp2 = fingerprint(draft([[902.3, 'pass'], [915, 'fail']]))
    expect(nextRunDut(first, fp2, B)?.mac).toBe('112233445566')
  })

  it('is forgotten when the results are cleared', () => {
    const first = nextRunDut(undefined, fingerprint(draft([[902.3, 'pass']])), A)
    expect(nextRunDut(first, fingerprint(draft([])), A)).toBeUndefined()
  })

  it('normalises MACs as the report stores them', () => {
    expect(normMac('80:e1:27-fa a9 f9')).toBe('80E127FAA9F9')
    expect(normMac(null)).toBe('')
  })
})
