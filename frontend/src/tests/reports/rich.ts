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

/** The value as HTML to edit in place: our own tags only, rebuilt from the
 *  parsed runs, so nothing else in a value can reach the page. */
export function toHtml(value: string): string {
  const html = parse(value).map(wrap).join('')
  // A line the text ends on shows only with something after it.
  return value.endsWith('\n') ? `${html}<br>` : html
}

/**
 * What the browser's editing left in an editable element, as runs: <b>,
 * <strong>, <i>, <em>, <u>, styled spans and <font color> (what execCommand
 * writes), line breaks and the <div>s Enter can make. Anything else keeps
 * its words and loses its looks.
 */
export function fromDom(root: Node): Span[] {
  const out: Span[] = []
  const walk = (node: Node, f: Look) => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push({ text: child.textContent ?? '', ...f })
        return
      }
      if (!(child instanceof HTMLElement)) return
      const tag = child.tagName
      if (tag === 'BR') {
        // The browser's own last <br> holds an empty last line open; it is
        // not a line of the text.
        const last = i === node.childNodes.length - 1 && node === root
        if (!last) out.push({ text: '\n', ...f })
        return
      }
      const g = { ...f }
      if (tag === 'B' || tag === 'STRONG') g.bold = true
      if (tag === 'I' || tag === 'EM') g.italic = true
      if (tag === 'U') g.underline = true
      const st = child.style
      const w = weight(st.fontWeight)
      if (w !== undefined) g.bold = w
      if (st.fontStyle === 'italic') g.italic = true
      if (st.fontStyle === 'normal') delete g.italic
      const deco = st.textDecorationLine || st.textDecoration
      if (/underline/.test(deco)) g.underline = true
      const c = hex(st.color || child.getAttribute('color') || '')
      if (c) g.color = c
      const block = tag === 'DIV' || tag === 'P'
      if (block && out.length && !out[out.length - 1].text.endsWith('\n')) out.push({ text: '\n', ...f })
      walk(child, g)
    })
  }
  walk(root, {})
  return merge(out)
}
