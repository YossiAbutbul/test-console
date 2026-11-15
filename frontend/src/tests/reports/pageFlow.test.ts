import { describe, expect, it } from 'vitest'
import { BODY_H, SHEET, layoutPages } from './pageFlow'

const H = (pairs: Array<[string, number]>) => new Map(pairs)

describe('report pages', () => {
  it('puts the cover on a page of its own and flows the rest', () => {
    const f = layoutPages(
      [{ id: 'cover', ownPage: true }, { id: 'a' }, { id: 'b' }],
      H([['cover', 700], ['a', 300], ['b', 300]]),
    )
    expect(f.sheets.map((s) => s.cover)).toEqual([true, false])
    // a opens page 2: the rest of page 1, the gap, page 2's top margin.
    expect(f.spacer.get('a')).toBe(SHEET.height - SHEET.margin - 700 + SHEET.gap + SHEET.margin)
    expect(f.spacer.has('b')).toBe(false)
    expect(f.height).toBe(2 * SHEET.height + SHEET.gap)
  })

  it('starts a new page when the next block does not fit', () => {
    const f = layoutPages([{ id: 'a' }, { id: 'b' }, { id: 'c' }], H([['a', BODY_H - 100], ['b', 150], ['c', 50]]))
    expect(f.sheets).toHaveLength(2)
    expect(f.spacer.has('b')).toBe(true)
    expect(f.spacer.has('c')).toBe(false)
  })

  it('ends the page at a page break', () => {
    const f = layoutPages([{ id: 'a' }, { id: 'pb', breakAfter: true }, { id: 'b' }], H([['a', 100], ['pb', 20], ['b', 100]]))
    expect(f.sheets).toHaveLength(2)
    expect(f.spacer.has('b')).toBe(true)
  })

  it('keeps a heading with the block it introduces', () => {
    const f = layoutPages(
      [{ id: 'a' }, { id: 'h1', keepWithNext: true }, { id: 'h2', keepWithNext: true }, { id: 't' }],
      H([['a', BODY_H - 120], ['h1', 40], ['h2', 30], ['t', 200]]),
    )
    // The table did not fit; both headings above it went to the next page.
    expect(f.spacer.has('h1')).toBe(true)
    expect(f.spacer.has('t')).toBe(false)
    expect(f.spacer.get('h1')).toBe(SHEET.height - SHEET.margin - (BODY_H - 120) + SHEET.gap + SHEET.margin)
  })

  it('does not carry a heading that would leave its page empty', () => {
    const f = layoutPages([{ id: 'h', keepWithNext: true }, { id: 't' }], H([['h', 40], ['t', BODY_H]]))
    expect(f.spacer.has('t')).toBe(true)
    expect(f.spacer.has('h')).toBe(false)
  })

  it('grows a page to hold a block taller than a page', () => {
    const f = layoutPages([{ id: 'a' }], H([['a', BODY_H + 300]]))
    expect(f.sheets[0].height).toBe(SHEET.height + 300)
  })
})
