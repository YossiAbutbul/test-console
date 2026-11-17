import { describe, expect, it } from 'vitest'
import { fromDoc, parse, plain, serialize, toDoc } from './rich'

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
  })

  it('stays plain until something is formatted', () => {
    expect(serialize([{ text: 'a < b' }, { text: ' & c' }])).toBe('a < b & c')
  })

  it('edits as our own formatting only', () => {
    // A tag of ours goes in as a mark; anything else stays its words.
    expect(toDoc('<b>x</b> <em>y</em>')).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'x', marks: [{ type: 'bold' }] }, { type: 'text', text: ' <em>y</em>' },
    ] }] })
    expect(fromDoc(toDoc('<span style="color:#002060;background:url(x)">y</span>')))
      .toBe('<span style="color:#002060">y</span>')
  })

  it('goes to the editor and back unchanged', () => {
    for (const v of [
      '', 'plain < 30 & more', 'a\nb', 'a\n',
      'Plain <b>bold</b> <span style="font-weight:400">light</span>',
      '<span style="color:#C00000"><b><i><u>all</u></i></b></span> rest',
    ]) expect(fromDoc(toDoc(v))).toBe(serialize(parse(v)))
    expect(toDoc('a\nb').content?.[0].content?.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('reads a colour the editor wrote another way', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'rgb(192, 0, 0)' } }] },
    ] }] }
    expect(fromDoc(doc)).toBe('<span style="color:#C00000">x</span>')
  })
})
