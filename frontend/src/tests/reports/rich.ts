/**
 * Formatted words: bold, italic, underline and colour on selected words,
 * kept inside the value as a few HTML tags and nothing else --
 *
 *   <b>..</b>                          bold
 *   <i>..</i>                          italic
 *   <u>..</u>                          underlined
 *   <span style="font-weight:400">..   not bold (in a heading, say)
 *   <span style="color:#RRGGBB">..     a colour
 *
 * with &amp; &lt; &gt; &quot; for the characters the tags use. A value with
 * none of those tags is plain text and is read as written, so values saved
 * before formatting existed ("< 30 ppm" included) read as they always did,
 * and a value nobody formatted stays plain. The Word side reads the same
 * format: backend/reports/rich.py.
 */

export interface Span {
  text: string
  /** true bold, false explicitly not bold, undefined the place's own weight. */
  bold?: boolean
  italic?: true
  underline?: true
  /** '#RRGGBB', or undefined for the place's own colour. */
  color?: string
}

type Look = Omit<Span, 'text'>

const RICH = /<[biu]>|<span style="[^"]*">/
const TOKEN = /<[biu]>|<\/[biu]>|<span style="([^"]*)">|<\/span>|[^<]+|</g

export const isRich = (v: string) => RICH.test(v)

function unescape(s: string): string {
  return s.replace(/&(lt|gt|quot|#39|amp);/g, (_, e: string) =>
    ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[e] ?? '')
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hex(c: string): string | undefined {
  const s = c.trim().toLowerCase()
  let m = /^#?([0-9a-f]{6})$/.exec(s)
  if (m) return `#${m[1].toUpperCase()}`
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase()
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  return undefined
}

function weight(w: string): boolean | undefined {
  const s = w.trim().toLowerCase()
  if (!s) return undefined
  if (s === 'bold' || s === 'bolder' || Number(s) >= 600) return true
  if (s === 'normal' || s === 'lighter' || Number(s) < 600) return false
  return undefined
}

function styleOf(style: string): Look {
  const out: Look = {}
  for (const part of style.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = part.slice(0, i).trim().toLowerCase()
    const v = part.slice(i + 1)
    if (k === 'color') out.color = hex(v)
    if (k === 'font-weight') out.bold = weight(v)
  }
  return out
}

const same = (a: Look, b: Look) =>
  a.bold === b.bold && a.color === b.color && a.italic === b.italic && a.underline === b.underline

/** Adjacent runs of the same formatting joined. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of spans) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && same(last, s)) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

export function parse(value: string): Span[] {
  if (!value) return []
  if (!isRich(value)) return [{ text: value }]
  const out: Span[] = []
  const stack: Array<{ tag: string } & Look> = []
  for (const m of value.matchAll(TOKEN)) {
    const tok = m[0]
    if (tok === '<b>') stack.push({ tag: 'b', bold: true })
    else if (tok === '<i>') stack.push({ tag: 'i', italic: true })
    else if (tok === '<u>') stack.push({ tag: 'u', underline: true })
    else if (tok.startsWith('<span ')) stack.push({ tag: 'span', ...styleOf(m[1] ?? '') })
    else if (tok.startsWith('</')) {
      const want = tok.slice(2, -1)
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === want) { stack.splice(i, 1); break }
    } else {
      const s: Span = { text: unescape(tok) }
      for (const f of stack) {
        if (f.bold !== undefined) s.bold = f.bold
        if (f.color !== undefined) s.color = f.color
        if (f.italic) s.italic = true
        if (f.underline) s.underline = true
      }
      out.push(s)
    }
  }
  return merge(out)
}

/** The words alone. */
export const plain = (value: string) => parse(value).map((s) => s.text).join('')

const formatted = (s: Span) => s.bold !== undefined || !!s.color || !!s.italic || !!s.underline

function wrap(s: Span): string {
  let h = escape(s.text)
  if (s.underline) h = `<u>${h}</u>`
  if (s.italic) h = `<i>${h}</i>`
  if (s.bold === true) h = `<b>${h}</b>`
  if (s.bold === false) h = `<span style="font-weight:400">${h}</span>`
  if (s.color) h = `<span style="color:${s.color}">${h}</span>`
  return h
}

/** Runs back to the stored form: plain text when nothing is formatted. */
export function serialize(spans: Span[]): string {
  const m = merge(spans)
  if (!m.some(formatted)) return m.map((s) => s.text).join('')
  return m.map(wrap).join('')
}

/**
 * The editor's document (TipTap's JSON, RichText.tsx) for a value, and back.
 * One line of words with line breaks; the marks are bold, weight (not bold),
 * italic, underline and textStyle's colour. Built from the parsed runs, so
 * nothing but our own formatting reaches the editor.
 */
export interface DocNode {
  type: string
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
  content?: DocNode[]
}

export function toDoc(value: string): DocNode {
  const content: DocNode[] = []
  for (const s of parse(value)) {
    const marks: NonNullable<DocNode['marks']> = []
    if (s.bold === true) marks.push({ type: 'bold' })
    if (s.bold === false) marks.push({ type: 'weight' })
    if (s.italic) marks.push({ type: 'italic' })
    if (s.underline) marks.push({ type: 'underline' })
    if (s.color) marks.push({ type: 'textStyle', attrs: { color: s.color } })
    s.text.split('\n').forEach((line, i) => {
      if (i) content.push({ type: 'hardBreak' })
      if (line) content.push({ type: 'text', text: line, ...(marks.length ? { marks } : null) })
    })
  }
  return { type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : null) }] }
}

export function fromDoc(doc: DocNode): string {
  const out: Span[] = []
  ;(doc.content ?? []).forEach((par, i) => {
    if (i) out.push({ text: '\n' })
    for (const n of par.content ?? []) {
      if (n.type === 'hardBreak') { out.push({ text: '\n' }); continue }
      if (n.type !== 'text' || !n.text) continue
      const s: Span = { text: n.text }
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') s.bold = true
        if (m.type === 'weight') s.bold = false
        if (m.type === 'italic') s.italic = true
        if (m.type === 'underline') s.underline = true
        if (m.type === 'textStyle' && typeof m.attrs?.color === 'string') {
          const c = hex(m.attrs.color)
          if (c) s.color = c
        }
      }
      out.push(s)
    }
  })
  return serialize(out)
}
