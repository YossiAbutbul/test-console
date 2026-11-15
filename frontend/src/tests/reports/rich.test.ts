import { describe, expect, it } from 'vitest'
import { parse, plain, serialize, toHtml } from './rich'

describe('formatted words', () => {
  it('reads plain text as written', () => {
    expect(parse('< 30 ppm & more')).toEqual([{ text: '< 30 ppm & more' }])
    expect(plain('< 30 ppm & more')).toBe('< 30 ppm & more')
  })

  it('reads bold, not bold and colour', () => {
    const v = 'Plain <b>bold</b> <span style="color:#C00000">red <b>both</b></span> <span style="font-weight:400">light</span> &lt; 30'
    expect(parse(v)).toEqual([
      { text: 'Plain ' }, { text: 'bold', bold: true }, { text: ' ' },
      { text: 'red ', color: '#C00000' }, { text: 'both', bold: true, color: '#C00000' }, { text: ' ' },
      { text: 'light', bold: false }, { text: ' < 30' },
    ])
    expect(plain(v)).toBe('Plain bold red both light < 30')
    // Stored flat, one wrapper per run, meaning the same.
    expect(parse(serialize(parse(v)))).toEqual(parse(v))
  })

  it('reads italic and underline, with the rest', () => {
    const v = '<i>slanted</i> <u>lined</u> <span style="color:#C00000"><b><i><u>all</u></i></b></span>'
    expect(parse(v)).toEqual([
      { text: 'slanted', italic: true }, { text: ' ' }, { text: 'lined', underline: true }, { text: ' ' },
      { text: 'all', bold: true, italic: true, underline: true, color: '#C00000' },
    ])
    expect(parse(serialize(parse(v)))).toEqual(parse(v))
    expect(toHtml('<u>x</u>')).toBe('<u>x</u>')
  })

  it('stays plain until something is formatted', () => {
    expect(serialize([{ text: 'a < b' }, { text: ' & c' }])).toBe('a < b & c')
  })

  it('edits as our own tags only', () => {
    expect(toHtml('<b>x</b> <em>y</em>')).toBe('<b>x</b> &lt;em&gt;y&lt;/em&gt;')
    expect(toHtml('<span style="color:#002060;background:url(x)">y</span>')).toBe('<span style="color:#002060">y</span>')
    expect(toHtml('a\n')).toBe('a\n<br>')
  })
})
