import { describe, expect, it } from 'vitest'
import type { ReportEntry } from '../../api/reports'
import { documentOrder, move, newBlock, unplaced } from './layout'

const entry = (id: string) => ({ id } as ReportEntry)

describe('report layout', () => {
  it('numbers runs in the order the document prints them', () => {
    const entries = [entry('a'), entry('b'), entry('c')]
    const blocks = [
      newBlock('heading', { text: 'TX' }),
      newBlock('entry', { entry_id: 'c' }),
      newBlock('summary'),
      newBlock('all_entries'),
    ]
    expect([...documentOrder(blocks, entries)]).toEqual([['c', 1], ['a', 2], ['b', 3]])
    expect(unplaced(blocks, entries).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('does not print a run whose block names one that is gone', () => {
    expect(documentOrder([newBlock('entry', { entry_id: 'x' })], [entry('a')]).size).toBe(0)
  })

  it('moves a block to a new place', () => {
    expect(move(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(move(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
})
