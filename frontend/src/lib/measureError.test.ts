import { describe, expect, it } from 'vitest'
import { describeMeasureError } from './instrumentError'

describe('describeMeasureError', () => {
  it('shortens the real no-signal message', () => {
    const raw = 'RuntimeError: no signal at power sensor (-997.5 dBm) — check the RF path, or increase the settle time so the PA is keyed before the read'
    const f = describeMeasureError(raw)
    expect(f.title).toBe('No signal at the power sensor · -997.5 dBm')
    expect(f.hint).toBe('Check the RF path, or increase the settle time.')
    expect(f.title).not.toContain('RuntimeError')
    // The whole point of this was that the raw line ran the page width.
    expect(`${f.title} ${f.hint}`.length).toBeLessThan(100)
  })
  it('collapses the duplicated InvalidSession pair', () => {
    const raw = 'current: InvalidSession: Invalid session handle. The resource might be closed.; voltage: InvalidSession: Invalid session handle. The resource might be closed.'
    const f = describeMeasureError(raw)
    expect(f.title).toBe('Instrument session closed')
    expect(f.hint).toBe('Reconnect it from the Instruments panel.')
  })
  it('keeps the raw text for the log', () => {
    const raw = 'RuntimeError: boom'
    expect(describeMeasureError(raw).raw).toBe(raw)
  })
  it('falls back to a capitalised message', () => {
    expect(describeMeasureError('ValueError: bad channel').title).toBe('Bad channel')
  })
})
