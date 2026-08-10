/**
 * Read back a Load Pull CSV this page exported.
 *
 * The inverse of `downloadCsv` in LoadPullPage, and deliberately tolerant about
 * column *order* while strict about column *names*: a file that has been opened
 * in Excel and saved again keeps its headers but may not keep anything else.
 *
 * Parsed in the browser rather than on the backend — the results table is page
 * state here, not a backend run, so a round-trip would buy nothing.
 */
import type { LoadPullResultRow } from '../../store/loadPullPageStore'

/** Columns `downloadCsv` writes. `error` may be absent on hand-edited files. */
const REQUIRED = ['pos_mm', 'pos_pulses', 'power_dbm', 'cc_ma', 'r_ohm', 'x_ohm', 's11_db']

export interface LoadPullImport {
  rows: LoadPullResultRow[]
  /**
   * From the `#` preamble, when present.
   *
   * `freqSpec`/`powerSpec` are what current exports write, since a run sweeps
   * several of each. `freqMhz`/`powerDbm` are the single values older files
   * carry and are still read so those files keep importing.
   */
  meta: {
    freqSpec?: string
    powerSpec?: string
    freqMhz?: number
    powerDbm?: number
    pathLossDb?: number
  }
}

/** Split one CSV line, honouring quoted fields and doubled quotes inside them. */
function splitRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }   // escaped quote
        else quoted = false
      } else cur += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Empty cells mean "not measured", which is null rather than 0. */
const numOrNull = (s: string | undefined): number | null => {
  const t = (s ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parseLoadPullCsv(text: string): LoadPullImport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('The file is empty')

  const meta: LoadPullImport['meta'] = {}
  let headerIdx = -1

  for (let i = 0; i < lines.length; i++) {
    // The header also starts with '#', so the preamble is only a '#' followed
    // by a space. Matching on '#' alone would swallow the header.
    if (/^#\s/.test(lines[i])) {
      // A spec value can hold commas, dashes and colons ("900-930:5"), so the
      // value pattern is "everything up to the next space", not just digits.
      // Skip element 0 — that is the whole `key=value` match, not the key.
      for (const [, key, value] of lines[i].matchAll(/(\w+)=(\S+)/g)) {
        const n = Number(value)
        if (key === 'freq_spec') meta.freqSpec = value
        else if (key === 'power_spec') meta.powerSpec = value
        else if (key === 'freq_mhz' && Number.isFinite(n)) meta.freqMhz = n
        else if (key === 'power_dbm' && Number.isFinite(n)) meta.powerDbm = n
        else if (key === 'path_loss_db' && Number.isFinite(n)) meta.pathLossDb = n
      }
      continue
    }
    headerIdx = i
    break
  }
  if (headerIdx === -1) throw new Error('No column header row found')

  const header = splitRow(lines[headerIdx]).map((h) => h.trim())
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `Not a Load Pull export — missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }
  const at = (cols: string[], name: string) => cols[header.indexOf(name)]

  const rows: LoadPullResultRow[] = []
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = splitRow(line)
    const posPulses = numOrNull(at(cols, 'pos_pulses'))
    const posMm = numOrNull(at(cols, 'pos_mm'))
    // A row with no position is not a measurement point — a stray trailing line,
    // or a totals row someone added in Excel.
    if (posPulses == null && posMm == null) continue
    const ccMa = numOrNull(at(cols, 'cc_ma'))
    const error = header.includes('error') ? (at(cols, 'error') ?? '').trim() : ''
    // Both optional: a file written before the sweep existed has one frequency
    // and power for the whole run, recorded in the preamble rather than per row.
    const freq = header.includes('freq_mhz') ? numOrNull(at(cols, 'freq_mhz')) : null
    const setPower = header.includes('set_power_dbm')
      ? numOrNull(at(cols, 'set_power_dbm'))
      : null
    rows.push({
      pos_pulses: posPulses ?? 0,
      pos_mm: posMm ?? 0,
      ...(freq != null ? { freq_mhz: freq } : {}),
      ...(setPower != null ? { power_dbm_setting: setPower } : {}),
      power_dbm: numOrNull(at(cols, 'power_dbm')),
      current_a: ccMa == null ? null : ccMa / 1000,
      r_ohm: numOrNull(at(cols, 'r_ohm')),
      x_ohm: numOrNull(at(cols, 'x_ohm')),
      s11_db: numOrNull(at(cols, 's11_db')),
      error: error === '' ? null : error,
    })
  }

  if (rows.length === 0) throw new Error('No data rows found')
  return { rows, meta }
}
