/**
 * A report's sheets as the in-app spreadsheet (FortuneSheet) draws them.
 *
 * Laid out and styled as the exported workbook is (backend/reports/sheets.py
 * and backend/workbook.py): the Summary sheet's title and facts above its
 * table, the header row bold on the workbooks' blue-grey fill, numbers to two
 * decimals (frequencies up to four), a failed verdict in Excel's light red.
 * So the page and the .xlsx read alike.
 */
import type { Cell, CellWithRowAndCol, Sheet } from '@fortune-sheet/core'
import type { ReportCell, ReportSheets } from '../../api/reports'

/** backend/workbook.py: HEADER_FILL, BAD_FILL, BAD_FONT. */
export const HEADER_BG = '#DDE5F0'
export const BAD_BG = '#FFC7CE'
export const BAD_FC = '#9C0006'

export const SUMMARY = 'Summary'

/** Excel's long-standing default face and size. FortuneSheet's own default is
 *  the first of its font list, Times New Roman, which read as a document
 *  rather than a sheet. Calibri ships with Windows; elsewhere the canvas
 *  falls back to Helvetica / Arial. */
export const SHEET_FONT = 'Calibri'
export const SHEET_FONT_PT = 11

/** Every cell's face; text that would be cut at the next column flows over
 *  it while that cell is empty, as Excel does (`tb` 1: overflow). */
const BASE = { ff: SHEET_FONT, fs: SHEET_FONT_PT, tb: '1' } as const

/** Empty rows and columns beyond the data, so the grid reads as a sheet
 *  rather than a table that stops at its last cell. */
const SPARE_ROWS = 30
const MIN_COLS = 26

/** Integers as they are; other numbers to two decimals, frequencies up to
 *  four (a 902.3125 MHz channel shown as 902.31 names another channel). */
export function cellText(column: string, v: ReportCell): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v)) return String(v)
  if (column.startsWith('Freq')) return v.toFixed(4).replace(/0{1,2}$/, '')
  return v.toFixed(2)
}

/** The Excel number format the workbook gives the cell (backend/workbook.py's
 *  number_format), shown in the spreadsheet's format box. */
function numberFormat(column: string, v: number): string {
  if (Number.isInteger(v)) return '0'
  return column.startsWith('Freq') ? '0.00##' : '0.00'
}

export function isFail(v: ReportCell): boolean {
  return typeof v === 'string' && v.trim().toLowerCase().startsWith('fail')
}

function valueCell(column: string, v: ReportCell): Cell | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    return { ...BASE, v, m: cellText(column, v), ct: { fa: numberFormat(column, v), t: 'n' } }
  }
  const text = cellText(column, v)
  return { ...BASE, v: text, m: text, ct: { fa: '@', t: 's' } }
}

/** Pixel width of a column: its longest text, as a sheet autofits it. */
function widthOf(texts: string[]): number {
  const chars = Math.max(6, ...texts.map((t) => t.length))
  return Math.min(320, Math.round(chars * 7.6 + 20))
}

interface Table {
  columns: string[]
  rows: ReportCell[][]
  /** Row the header sits on. */
  top: number
}

function tableCells(t: Table): CellWithRowAndCol[] {
  const out: CellWithRowAndCol[] = []
  t.columns.forEach((name, c) => {
    out.push({ r: t.top, c, v: { ...BASE, v: name, m: name, bl: 1, bg: HEADER_BG, ct: { fa: '@', t: 's' } } })
  })
  const verdictCol = t.columns.findIndex((c) => c === 'Verdict' || c === 'Result')
  t.rows.forEach((row, i) => {
    t.columns.forEach((name, c) => {
      const v = row[c] ?? null
      const cell = valueCell(name, v)
      if (!cell) return
      if (c === verdictCol && isFail(v)) Object.assign(cell, { bg: BAD_BG, fc: BAD_FC })
      out.push({ r: t.top + 1 + i, c, v: cell })
    })
  })
  return out
}

function columnWidths(t: Table, extra: string[][] = []): Record<string, number> {
  const len: Record<string, number> = {}
  t.columns.forEach((name, c) => {
    const texts = [name, ...t.rows.map((r) => cellText(name, r[c] ?? null)), ...extra.map((x) => x[c] ?? '')]
    // Room for the filter button over the header's right edge.
    len[String(c)] = widthOf(texts) + 14
  })
  return len
}

function sheetOf(name: string, order: number, t: Table, celldata: CellWithRowAndCol[],
  widths: Record<string, number>): Sheet {
  const lastRow = t.top + t.rows.length
  const lastCol = Math.max(t.columns.length - 1, 0)
  return {
    name,
    id: `s${order}`,
    order,
    status: order === 0 ? 1 : 0,
    // A1 selected, as a workbook opens; without one the name box read
    // "A1:NaN".
    luckysheet_select_save: [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }],
    celldata,
    row: lastRow + 1 + SPARE_ROWS,
    column: Math.max(MIN_COLS, t.columns.length + 4),
    config: { columnlen: widths },
    // The header stays in view; on a test sheet the MAC column does too, as
    // the workbook's B2 freeze.
    frozen: order === 0
      ? { type: 'rangeRow', range: { row_focus: t.top, column_focus: 0 } }
      : { type: 'rangeBoth', range: { row_focus: 0, column_focus: 0 } },
    // The workbook's auto-filter, drawn as Excel's header drop-downs.
    filter_select: { row: [t.top, Math.max(lastRow, t.top)], column: [0, lastCol] },
  }
}

/** Every sheet, Summary first, in the workbook's order. */
export function toWorkbook(rs: ReportSheets): Sheet[] {
  // Summary: title, facts, a blank row, then the runs table.
  const facts = rs.facts
  const top = facts.length + 2
  const summary: Table = { columns: rs.summary_columns, rows: rs.summary_rows, top }
  const head: CellWithRowAndCol[] = [
    { r: 0, c: 0, v: { ...BASE, v: `${rs.product} — test report`, m: `${rs.product} — test report`, bl: 1, fs: 14 } },
    ...facts.flatMap(([k, v], i): CellWithRowAndCol[] => [
      { r: i + 1, c: 0, v: { ...BASE, v: k, m: k, bl: 1, ct: { fa: '@', t: 's' } } },
      { r: i + 1, c: 1, v: { ...BASE, v, m: v, ct: { fa: '@', t: 's' } } },
    ]),
  ]
  const sheets = [sheetOf(SUMMARY, 0, summary, [...head, ...tableCells(summary)], columnWidths(summary))]
  rs.sheets.forEach((s, i) => {
    const t: Table = { columns: s.columns, rows: s.rows, top: 0 }
    sheets.push(sheetOf(s.name, i + 1, t, tableCells(t), columnWidths(t)))
  })
  return sheets
}
