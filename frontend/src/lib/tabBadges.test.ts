import { describe, expect, it } from 'vitest'
import { badgeLabel, clear, combine, raise, worse, type Badges } from './tabBadges'

describe('tab badges', () => {
  it('counts events on a page and keeps the worst colour', () => {
    let b: Badges = {}
    b = raise(b, 'power', 'success', 'reports')
    b = raise(b, 'power', 'error', 'reports')
    b = raise(b, 'power', 'info', 'reports')
    expect(b.power).toEqual({ count: 3, status: 'error' })
  })

  it('ignores the page on screen', () => {
    const b = raise({}, 'power', 'error', 'power')
    expect(b).toEqual({})
  })

  it('clears a page when it is opened', () => {
    const b = raise(raise({}, 'power', 'error', 'x'), 'lteCw', 'success', 'x')
    expect(clear(b, 'power')).toEqual({ lteCw: { count: 1, status: 'success' } })
    expect(clear(b, 'nothing')).toBe(b)
  })

  it('orders statuses red, amber, green, blue', () => {
    expect(worse('attention', 'error')).toBe('error')
    expect(worse('success', 'attention')).toBe('attention')
    expect(worse('info', 'success')).toBe('success')
  })

  it('combines a folded section', () => {
    const b: Badges = { a: { count: 2, status: 'success' }, b: { count: 99, status: 'attention' } }
    expect(combine(b, ['a', 'b', 'c'])).toEqual({ count: 101, status: 'attention' })
    expect(combine(b, ['c'])).toBeNull()
  })

  it('shows up to 99, then 99+', () => {
    expect(badgeLabel(1)).toBe('1')
    expect(badgeLabel(99)).toBe('99')
    expect(badgeLabel(100)).toBe('99+')
  })
})
