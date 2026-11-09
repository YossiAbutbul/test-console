import { newBlock, type BlockDraft, type Bounds } from './blocks'

/**
 * A configuration table pasted into the advanced ranges: one row per
 * configuration, typically the chosen settings for each target power copied
 * out of an earlier analysis in Excel --
 *
 *   Target [dBm]  PA mode  Power (Set)  PA DC  HP Max  [P ... ]  [I ... ]  Status
 *
 * Each row becomes a single-step range with its own PA mode, so the table
 * reruns exactly as written, PA off rows and PA on rows in one run, in the
 * table's order. Measured columns (P/I per unit, means, error, Status) are
 * ignored: only the three settings and the PA mode are read.
 *
 * Columns are found by header text, so their order and any extra columns do
 * not matter. Without a header row the user's layout is assumed: Target,
 * PA mode, Power, PA DC, HP Max (five or more columns), PA mode, Power,
 * PA DC, HP Max (four), or Power, PA DC, HP Max (three).
 */

export interface ConfigTableRow {
  /** The row's own target, kept only to say which rows were read. */
  target: number | null
  paMode: number | null
  power: number
  duty: number
  hp: number
}

export interface ParsedConfigTable {
  rows: ConfigTableRow[]
  /** Why the table cannot be used, one line per bad row; empty when it can. */
  errors: string[]
}

type Col = 'target' | 'mode' | 'power' | 'duty' | 'hp'

/** First match wins, in this order: "PA mode" must not be read as PA DC,
 *  and "Power (Set)" must win over a measured "P mean [dBm]". */
const HEADER_PATTERNS: Array<[Col, RegExp]> = [
  ['target', /target/i],
  ['mode', /pa\s*mode|^mode\b/i],
  ['duty', /pa\s*dc|duty/i],
  ['hp', /hp\s*max|^hp\b/i],
  // "Power (Set)" from the analysis sheet, "Set [dBm]" from this app's export.
  ['power', /\bset\b|^power\b/i],
]

const PA_WORDS: Record<string, number> = { off: 0, on: 1, auto: 2, '0': 0, '1': 1, '2': 2 }

function splitLine(line: string): string[] {
  // Excel copies as tabs; a hand-typed or CSV table as commas or spaces.
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim())
  if (/[,;]/.test(line)) return line.split(/[,;]/).map((c) => c.trim())
  return line.trim().split(/\s+/)
}

function isHeader(cells: string[]): boolean {
  return cells.some((c) => HEADER_PATTERNS.some(([, re]) => re.test(c)))
}

function columnsFromHeader(cells: string[]): Partial<Record<Col, number>> {
  const at: Partial<Record<Col, number>> = {}
  cells.forEach((c, i) => {
    const hit = HEADER_PATTERNS.find(([col, re]) => at[col] == null && re.test(c))
    if (hit) at[hit[0]] = i
  })
  return at
}

function columnsByPosition(n: number): Partial<Record<Col, number>> {
  if (n >= 5) return { target: 0, mode: 1, power: 2, duty: 3, hp: 4 }
  if (n === 4) return { mode: 0, power: 1, duty: 2, hp: 3 }
  return { power: 0, duty: 1, hp: 2 }
}

export function parseConfigTable(text: string, bounds: Bounds): ParsedConfigTable {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], errors: [] }

  let first = 0
  let at: Partial<Record<Col, number>>
  const head = splitLine(lines[0])
  if (isHeader(head)) {
    at = columnsFromHeader(head)
    first = 1
    const missing = (['power', 'duty', 'hp'] as const).filter((c) => at[c] == null)
    if (missing.length) {
      const names = { power: 'Power (Set)', duty: 'PA DC', hp: 'HP Max' }
      return { rows: [], errors: [`No ${missing.map((m) => names[m]).join(', ')} column in the header.`] }
    }
  } else {
    at = columnsByPosition(head.length)
  }

  const rows: ConfigTableRow[] = []
  const errors: string[] = []
  for (let i = first; i < lines.length; i++) {
    const cells = splitLine(lines[i])
    const where = `Row ${i - first + 1}`
    const int = (col: 'power' | 'duty' | 'hp', name: string, ax: { min: number; max: number }) => {
      const raw = cells[at[col]!] ?? ''
      const v = Number(raw)
      if (raw === '' || !Number.isInteger(v)) {
        errors.push(`${where}: ${name} "${raw}" is not a whole number.`)
        return null
      }
      if (v < ax.min || v > ax.max) {
        errors.push(`${where}: ${name} ${v} is outside ${ax.min} to ${ax.max}.`)
        return null
      }
      return v
    }
    const power = int('power', 'Power', bounds.power)
    const duty = int('duty', 'PA DC', bounds.duty)
    const hp = int('hp', 'HP Max', bounds.hp)

    let paMode: number | null = null
    if (at.mode != null) {
      const raw = (cells[at.mode] ?? '').toLowerCase()
      if (raw in PA_WORDS) paMode = PA_WORDS[raw]
      else errors.push(`${where}: PA mode "${cells[at.mode] ?? ''}" is not Off, On or Auto.`)
    }
    const t = at.target != null ? Number(cells[at.target]) : NaN

    if (power != null && duty != null && hp != null) {
      rows.push({ target: Number.isFinite(t) ? t : null, paMode, power, duty, hp })
    }
  }
  return { rows, errors }
}

/** One single-step range per row, in the table's order. A row without a PA
 *  mode runs at the run's. */
export function configTableBlocks(rows: ConfigTableRow[], bounds: Bounds): BlockDraft[] {
  return rows.map((r) => ({
    ...newBlock(bounds),
    powerLo: r.power, powerHi: r.power,
    dutyLo: r.duty, dutyHi: r.duty,
    hpLo: r.hp, hpHi: r.hp,
    ...(r.paMode != null ? { paMode: r.paMode } : {}),
  }))
}
