import { describe, expect, it } from 'vitest'
import { detex } from './chatText'

/**
 * The rule these all serve: a formula may come out clumsier than the model
 * wrote it, but it must never come out *wrong*. A dropped term or a lost
 * parenthesis turns an answer about a measurement into a different answer, and
 * nothing on screen would say so.
 */
describe('detex', () => {
  it('leaves prose completely alone', () => {
    const prose = 'Power flattens at 20.8 dBm; current_a keeps climbing to 0.297 A.'
    expect(detex(prose)).toBe(prose)
  })

  it('does not touch snake_case column names', () => {
    // The whole app names columns this way: power_dbm, pos_mm, current_a.
    const s = 'power_dbm_setting = 16 while current_a stayed on trend'
    expect(detex(s)).toBe(s)
  })

  it('unwraps inline and display maths', () => {
    expect(detex('the $V_{DC}$ rail')).toBe('the V_{DC} rail')
    expect(detex('$$P = V I$$')).toBe('P = V I')
  })

  it('turns a fraction into a parenthesised division', () => {
    const out = detex('$$\\text{PAE} = \\frac{P_{out} - P_{in}}{V_{DC} \\times I_{DC}}$$')
    expect(out).toBe('PAE = (P_{out} - P_{in}) / (V_{DC} × I_{DC})')
  })

  it('keeps the denominator grouped, because P/(V×I) is not P/V×I', () => {
    expect(detex('$\\frac{a}{b \\times c}$')).toBe('a / (b × c)')
  })

  it('handles a nested fraction', () => {
    expect(detex('$\\frac{\\frac{a}{b}}{c}$')).toBe('(a / b) / c')
  })

  it('renders the operators and units that turn up in RF answers', () => {
    expect(detex('$50 \\Omega \\pm 5\\%$')).toBe('50 Ω ± 5%')
    expect(detex('$\\eta \\approx 0.4$')).toBe('η ≈ 0.4')
    expect(detex('$\\sqrt{P R}$')).toBe('√(P R)')
  })

  it('keeps an unknown command as text rather than dropping the term', () => {
    // Losing a term silently is the one failure that cannot be spotted on screen.
    expect(detex('$a \\widehat{b} c$')).toContain('b')
    expect(detex('$x \\oplus y$')).toContain('x')
    expect(detex('$x \\oplus y$')).toContain('y')
  })


  it('drops sizing hints instead of printing them as words', () => {
    // \left( and \right) are sizing hints; falling through to the
    // keep-unknown-commands rule renders them as "left(" and "right)".
    expect(detex('$\\left( a + b \\right) \\times c$')).toBe('( a + b ) × c')
  })

  it('unescapes a column name the model escaped', () => {
    // LaTeX needs power\_dbm; the column is power_dbm, and the operator may
    // well paste it back into a search box.
    expect(detex('$power\\_dbm - 30$')).toBe('power_dbm - 30')
  })

  it('leaves a lone dollar sign alone', () => {
    expect(detex('costs $5 to replace')).toBe('costs $5 to replace')
  })

  it('leaves unbalanced braces alone rather than mangling the line', () => {
    const broken = '$\\frac{a$'
    expect(detex(broken)).toContain('a')
  })

  it('turns a LaTeX line break into a real one', () => {
    expect(detex('$a \\\\ b$')).toBe('a\nb')
  })
})
