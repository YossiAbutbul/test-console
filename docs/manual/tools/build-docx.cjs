/**
 * Builds docs/manual/Test-Console-User-Manual.docx from source/*.md and img/.
 *
 * The chapters are kept as Markdown so the manual can be edited and diffed
 * like code; this script is the only thing that turns them into Word. It maps
 * the subset of Markdown the chapters use -- headings, paragraphs, nested
 * lists, tables, block quotes (rendered as callouts), code, images and
 * ```mermaid blocks (replaced by img/diagram-<n>.png from render-diagrams.cjs).
 * Links become plain text: a bare section number such as [3.4](...) reads
 * "section 3.4", since a Word reader cannot follow a link to a .md file.
 *
 * When Microsoft Word is installed, it is then driven over COM to fill in the
 * table of contents (docx-js can only write the field; Word computes it) and,
 * with --pdf <path>, to export a PDF for review.
 *
 * Usage: node docs\manual\tools\build-docx.cjs [--pdf out.pdf]
 */
const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const { marked } = require('marked')
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  LevelFormat, PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table,
  TableCell, TableOfContents, TableRow, TabStopType, TextRun, WidthType,
} = require('docx')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'source')
const IMG = path.join(ROOT, 'img')
const OUT = path.join(ROOT, 'Test-Console-User-Manual.docx')

// ---- page geometry (A4, 2 cm margins) ------------------------------------
const PAGE_W = 11906
const MARGIN = 1134
const CONTENT_W = PAGE_W - 2 * MARGIN // 9638 dxa
const CONTENT_PX = Math.floor((CONTENT_W / 1440) * 96) // ~642 px at 96 dpi
const MAX_IMG_H_PX = 700

// ---- palette: graphite, like the app's Anodized theme --------------------
const INK = '1F2328'
const MUTED = '57606A'
const RULE = 'D0D7DE'
const HEAD_FILL = 'EEF1F4'
const CODE_FILL = 'F4F6F8'
const NOTE_FILL = 'F3F6FA'
const NOTE_BAR = '8C959F'
const FONT = 'Segoe UI'
const MONO = 'Consolas'

// ---- helpers -------------------------------------------------------------
const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&')

function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

/** Screenshots are captured at 1.5x: show them at their CSS size, shrunk
 *  only when they would not fit the page. Diagrams are drawn small by mermaid
 *  and read better stretched to the full text width. */
function imageRun(file) {
  const { w, h } = pngSize(file)
  const diagram = path.basename(file).startsWith('diagram-')
  let cw = w / 1.5
  let ch = h / 1.5
  const k = diagram
    ? Math.min(CONTENT_PX / cw, 420 / ch)
    : Math.min(1, CONTENT_PX / cw, MAX_IMG_H_PX / ch)
  cw = Math.round(cw * k)
  ch = Math.round(ch * k)
  return new ImageRun({
    type: 'png', data: fs.readFileSync(file),
    transformation: { width: cw, height: ch },
    altText: { title: path.basename(file), description: path.basename(file), name: path.basename(file) },
  })
}

function linkText(tok) {
  const t = decode(tok.text)
  if (/^\d+(\.\d+)*( [A-Z])?$/.test(t)) return `section ${t}`
  return t
}

/** Inline tokens -> TextRuns. `base` carries inherited formatting. */
function inline(tokens, base = {}) {
  const runs = []
  for (const t of tokens || []) {
    switch (t.type) {
      case 'strong': runs.push(...inline(t.tokens, { ...base, bold: true })); break
      case 'em': runs.push(...inline(t.tokens, { ...base, italics: true })); break
      case 'codespan':
        runs.push(new TextRun({ ...base, text: decode(t.text), font: MONO, size: base.size ?? 18,
          shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' } }))
        break
      case 'link': runs.push(new TextRun({ ...base, text: linkText(t) })); break
      case 'br': runs.push(new TextRun({ ...base, break: 1 })); break
      case 'escape': runs.push(new TextRun({ ...base, text: decode(t.text) })); break
      case 'text':
        if (t.tokens) runs.push(...inline(t.tokens, base))
        else runs.push(new TextRun({ ...base, text: decode(t.text) }))
        break
      case 'image': break // handled at block level
      default: if (t.text) runs.push(new TextRun({ ...base, text: decode(t.text) }))
    }
  }
  return runs
}

// ---- state shared across chapters ----------------------------------------
let figureNo = 0
let diagramNo = 0
let listInstance = 0
let firstChapter = true

function figure(file, alt, out) {
  if (!fs.existsSync(file)) throw new Error(`missing image ${file}`)
  out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true,
    spacing: { before: 120, after: 60 }, children: [imageRun(file)] }))
  if (alt) {
    figureNo++
    out.push(new Paragraph({ style: 'Caption', alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Figure ${figureNo} — `, bold: true }), new TextRun(alt)] }))
  }
}

function codeBlock(text, out, indent = 0) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/)
  lines.forEach((line, i) => out.push(new Paragraph({
    indent: { left: indent },
    shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' },
    spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 120 : 0, line: 260 },
    keepLines: true, keepNext: i < lines.length - 1,
    children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
  })))
}

/** Column widths proportional to content length, with a floor so short
 *  columns still fit their header. */
function columnWidths(tok, width) {
  const n = tok.header.length
  const len = Array(n).fill(0)
  const measure = (c) => Math.min(60, decode(c.text).length)
  tok.header.forEach((c, i) => { len[i] = Math.max(len[i], Math.min(18, measure(c))) })
  tok.rows.forEach((r) => r.forEach((c, i) => { len[i] = Math.max(len[i], measure(c)) }))
  const weights = len.map((l) => Math.max(6, l))
  const sum = weights.reduce((a, b) => a + b, 0)
  const w = weights.map((x) => Math.floor((x / sum) * width))
  w[n - 1] += width - w.reduce((a, b) => a + b, 0)
  return w
}

function table(tok, out, width = CONTENT_W) {
  const widths = columnWidths(tok, width)
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (c, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    borders,
    shading: head ? { type: ShadingType.CLEAR, fill: HEAD_FILL, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ spacing: { before: 0, after: 0, line: 252 },
      children: inline(c.tokens, { size: 18, bold: head || undefined }) })],
  })
  const rows = [
    new TableRow({ tableHeader: true, cantSplit: true, children: tok.header.map((c, i) => cell(c, i, true)) }),
    ...tok.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
  ]
  out.push(new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: widths, rows }))
  out.push(new Paragraph({ spacing: { before: 0, after: 80 }, children: [] }))
}

const isNavParagraph = (tok) => /^\[(←|Contents)/.test(tok.raw.trim())
const isAnchorList = (tok) => tok.items.every((it) => /^\[[^\]]+\]\(#[^)]+\)\s*$/.test(it.text.trim()))

function list(tok, out, level = 0, instance = null) {
  const ordered = tok.ordered
  const inst = instance ?? ++listInstance
  for (const item of tok.items) {
    let first = true
    for (const t of item.tokens) {
      if (t.type === 'text' || t.type === 'paragraph') {
        const runs = inline(t.tokens || [{ type: 'text', text: t.text }])
        out.push(new Paragraph(first
          ? { numbering: { reference: ordered ? 'numbered' : 'bullets', level, instance: inst },
              spacing: { before: 20, after: 40 }, children: runs }
          : { indent: { left: 360 * (level + 1) + 360 }, spacing: { after: 40 }, children: runs }))
        first = false
      } else if (t.type === 'list') {
        list(t, out, level + 1)
      } else if (t.type === 'table') {
        table(t, out, CONTENT_W - 720)
      } else if (t.type === 'code') {
        codeBlock(t.text, out, 360 * (level + 1) + 360)
      } else if (t.type === 'space') {
        // nothing
      } else {
        block(t, out)
      }
    }
  }
}

function block(tok, out) {
  switch (tok.type) {
    case 'heading': {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][tok.depth - 1]
      const text = decode(tok.text)
      if (tok.depth === 1 && !firstChapter) out.push(new Paragraph({ children: [new PageBreak()] }))
      if (tok.depth === 1) firstChapter = false
      // Inline runs, not tok.text, so `code` in a heading loses its backticks;
      // size/colour come from the heading style.
      out.push(new Paragraph({ heading: level, children: inline(tok.tokens, { size: [36, 28, 23, 20][tok.depth - 1] }) }))
      break
    }
    case 'paragraph': {
      if (isNavParagraph(tok)) break
      const imgs = tok.tokens.filter((t) => t.type === 'image')
      if (imgs.length && tok.tokens.every((t) => t.type === 'image' || (t.type === 'text' && !t.text.trim()))) {
        for (const im of imgs) figure(path.join(ROOT, im.href), decode(im.text), out)
        break
      }
      // "*Example data.*" under a figure repeats what its caption already says.
      if (/^\*Example data\.\*$/.test(tok.raw.trim())) break
      // A lead-in ending in ':' belongs on the same page as what it introduces.
      out.push(new Paragraph({ keepNext: /:\s*$/.test(tok.raw) || undefined, children: inline(tok.tokens) }))
      break
    }
    case 'list':
      if (isAnchorList(tok)) break // the per-chapter mini contents; Word has a TOC
      list(tok, out)
      break
    case 'table': table(tok, out); break
    case 'code':
      if (tok.lang === 'mermaid') {
        diagramNo++
        figure(path.join(IMG, `diagram-${diagramNo}.png`), null, out)
      } else codeBlock(tok.text, out)
      break
    case 'blockquote': quoteBlock(tok, out); break
    case 'hr': case 'space': case 'html': break
    default:
      if (tok.text) out.push(new Paragraph({ children: [new TextRun(decode(tok.text))] }))
  }
}

/** Renders a block quote: every paragraph inside gets the Note style. */
function quoteBlock(tok, out) {
  for (const t of tok.tokens) {
    if (t.type === 'paragraph') {
      out.push(new Paragraph({ style: 'Note', children: inline(t.tokens) }))
    } else if (t.type === 'list') {
      for (const it of t.items) {
        out.push(new Paragraph({ style: 'Note', children: [new TextRun('•  '), ...inline(it.tokens[0]?.tokens || [])] }))
      }
    } else if (t.type !== 'space') block(t, out)
  }
}

// ---- assemble ------------------------------------------------------------
function chapters() {
  const out = []
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith('.md')).sort()) {
    const tokens = marked.lexer(fs.readFileSync(path.join(SRC, f), 'utf8'))
    for (const t of tokens) block(t, out)
  }
  return out
}

function revision() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim()
    return `${branch} @ ${hash}`
  } catch { return 'unversioned' }
}

function cover() {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const rule = { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 8 } }
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({ children: [new TextRun({ text: 'TEST CONSOLE', font: FONT, size: 22, bold: true, color: MUTED, characterSpacing: 60 })] }),
    new Paragraph({ border: rule, spacing: { after: 240 },
      children: [new TextRun({ text: 'Operator Manual', font: FONT, size: 64, bold: true, color: INK })] }),
    new Paragraph({ spacing: { after: 600 }, children: [new TextRun({
      text: 'Installation, configuration, supported hardware and step-by-step test procedures for the BLE-driven PA test rig.',
      size: 24, color: MUTED })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
      children: [imageRun(path.join(IMG, 'shell-overview.png'))] }),
    new Paragraph({ children: [new TextRun({ text: `Edition: ${today}`, size: 20, color: MUTED })] }),
    new Paragraph({ children: [new TextRun({ text: `Source revision: ${revision()}`, size: 20, color: MUTED })] }),
    new Paragraph({ children: [new TextRun({ text: 'Screenshots: captured from the running application, Light theme', size: 20, color: MUTED })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ style: 'TocTitle', children: [new TextRun('Contents')] }),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  ]
}

const doc = new Document({
  creator: 'Test Console',
  title: 'Test Console — Operator Manual',
  description: 'Operator manual for the Test Console application',
  features: { updateFields: true },
  styles: {
    default: {
      document: { run: { font: FONT, size: 20, color: INK }, paragraph: { spacing: { after: 120, line: 276 } } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 36, bold: true, color: INK },
        paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0, keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: INK, space: 6 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 28, bold: true, color: INK },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 23, bold: true, color: '3D444D' },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 20, bold: true, color: '3D444D' },
        paragraph: { spacing: { before: 200, after: 60 }, outlineLevel: 3, keepNext: true } },
      { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 17, color: MUTED }, paragraph: { spacing: { before: 0, after: 200 } } },
      { id: 'Note', name: 'Note', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 19 },
        paragraph: { indent: { left: 200, right: 120 }, spacing: { before: 60, after: 60 },
          shading: { type: ShadingType.CLEAR, fill: NOTE_FILL, color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: NOTE_BAR, space: 8 } } } },
      { id: 'TocTitle', name: 'TOC Title', basedOn: 'Normal', next: 'Normal',
        run: { font: FONT, size: 36, bold: true, color: INK }, paragraph: { spacing: { after: 240 } } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [0, 1, 2].map((l) => ({
        level: l, format: LevelFormat.BULLET, text: ['•', '–', '·'][l], alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360 * (l + 1) + 200, hanging: 260 } } } })) },
      { reference: 'numbered', levels: [0, 1, 2].map((l) => ({
        level: l, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][l],
        text: `%${l + 1}.`, alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360 * (l + 1) + 200, hanging: 320 } } } })) },
    ],
  },
  sections: [{
    properties: {
      titlePage: true,
      page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 560, footer: 560 } },
    },
    headers: {
      first: new Header({ children: [new Paragraph({ children: [] })] }),
      default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
        children: [new TextRun({ text: 'Test Console', bold: true, size: 16, color: MUTED }),
          new TextRun({ text: '\tOperator Manual', size: 16, color: MUTED })] })] }),
    },
    footers: {
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED })] })] }),
    },
    children: [...cover(), new Paragraph({ children: [new PageBreak()] }), ...chapters()],
  }],
})

;(async () => {
  fs.writeFileSync(OUT, await Packer.toBuffer(doc))
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${figureNo} figures, ${diagramNo} diagrams)`)

  // Word computes the TOC; docx-js can only leave the field for it to fill.
  const pdfArg = process.argv.indexOf('--pdf')
  const pdf = pdfArg > 0 ? path.resolve(process.argv[pdfArg + 1]) : ''
  const ps = `
$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {
  $d = $w.Documents.Open('${OUT.replace(/'/g, "''")}')
  foreach ($t in $d.TablesOfContents) { $t.Update() }
  $d.Fields.Update() | Out-Null
  $d.Save()
  if ('${pdf}') { $d.ExportAsFixedFormat('${pdf.replace(/'/g, "''")}', 17) }
  "pages: " + $d.ComputeStatistics(2)
  $d.Close(0)
} finally { $w.Quit() }
`
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
  if (r.status === 0) console.log(`Word: table of contents updated; ${r.stdout.trim()}${pdf ? `; pdf -> ${pdf}` : ''}`)
  else console.log('Word not available -- open the file and press F9 on the contents to fill it in.\n' + (r.stderr || '').trim())
})()
