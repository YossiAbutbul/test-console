/**
 * The printed page's colours and type -- the lab's RF report style, as
 * backend/reports/docx_export.py writes it -- shared by the canvas
 * (Paper.tsx) and the page around it.
 *
 * The page is A4 at 96 px to the inch: 794 px wide, 2.54 cm (96 px)
 * margins, so a point here is 4/3 px, as in Word at 100 %. Fonts are the
 * Word file's, by name, with the nearest Windows face after each for a PC
 * that lacks it -- as Word itself substitutes.
 */
import type { ReportEntry } from '../../api/reports'

export const PAPER = {
  bg: '#FFFFFF',
  ink: '#000000',
  muted: '#595959',
  navy: '#002060',
  blue: '#4472C4',
  line: '#000000',
  soft: '#D9D9D9',
  headFill: '#D9E2F3',
  failFill: '#FBE9E9',
  pass: '#1E7F3C',
  fail: '#C0262D',
} as const

export const FONT = {
  body: 'Calibri, Carlito, "Segoe UI", sans-serif',
  display: '"Source Sans Pro", "Source Sans 3", "Segoe UI Black", "Segoe UI", sans-serif',
  cover: '"Source Sans Pro", "Source Sans 3", "Segoe UI", sans-serif',
  table: '"Aptos Narrow", "Arial Narrow", Calibri, sans-serif',
} as const

/** The page: A4 portrait at 96 dpi. */
export const PAGE = { width: 794, margin: 96, headerLogo: 128, coverLogo: 435 } as const

const pt = (n: number) => (n * 4) / 3

export const when = (iso: string) => iso.replace('T', ' ').slice(0, 16)

/** The reference's date form: 08.11.2026. */
export const dotDate = (iso: string) => {
  const d = iso.slice(0, 10).split('-')
  return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso
}

export function unitLabel(e: ReportEntry): string {
  const who = e.dut.nickname || e.dut.name
  if (who && e.dut.mac) return `${who} (${e.dut.mac})`
  return who || e.dut.mac || 'Unknown unit'
}

export const resultColor = (r: 'Pass' | 'Fail' | null) => (r === 'Pass' ? PAPER.pass : r === 'Fail' ? PAPER.fail : PAPER.muted)

/** Type on the page, in the Word file's sizes. */
export const PAPER_TYPE = {
  title: { fontFamily: FONT.display, fontSize: pt(60), fontWeight: 900, lineHeight: 1.05, color: PAPER.navy, letterSpacing: '-0.01em' },
  subtitle: { fontFamily: FONT.display, fontSize: pt(28), fontWeight: 900, lineHeight: 1.15, color: PAPER.navy },
  coverLine: { fontFamily: FONT.cover, fontSize: pt(14), lineHeight: 1.35, color: PAPER.ink },
  h1: { fontFamily: FONT.body, fontSize: pt(16), fontWeight: 700, lineHeight: 1.25, color: PAPER.navy },
  h2: { fontFamily: FONT.body, fontSize: pt(13), fontWeight: 700, lineHeight: 1.3, color: PAPER.navy },
  body: { fontFamily: FONT.body, fontSize: pt(12), lineHeight: 1.45, color: PAPER.ink },
  small: { fontFamily: FONT.body, fontSize: pt(10), lineHeight: 1.4, color: PAPER.muted },
  caption: { fontFamily: FONT.body, fontSize: pt(9), lineHeight: 1.4, color: PAPER.ink },
  cell: { fontFamily: FONT.table, fontSize: pt(10), lineHeight: 1.3, color: PAPER.ink },
} as const

/** Chart series colours: the report's navy, then Office's chart colours. */
export const SERIES = ['#002060', '#ED7D31', '#4472C4', '#70AD47', '#FFC000', '#7030A0', '#A5A5A5']
