/**
 * CSV reading helpers shared by the pages that import their own exports.
 *
 * Small, but worth having in one place: a splitter that mishandles quoting is
 * the kind of bug that only shows up on the one row whose error message
 * contained a comma.
 */

/**
 * Split one CSV line, honouring quoted fields and doubled quotes inside them.
 *
 * Deliberately line-at-a-time rather than a full parser: these files are
 * written by `downloadCsv`, which never emits a newline inside a field.
 */
export function splitCsvRow(line: string): string[] {
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
export function numOrNull(s: string | undefined): number | null {
  const t = (s ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Column lookup by name.
 *
 * Tolerant about column *order* while strict about column *names*: a file that
 * has been opened in Excel and saved again keeps its headers but may not keep
 * anything else.
 *
 * `aliases` maps a current name to the names it used to have, so a column that
 * was renamed is still found in a file written before the rename.
 */
export function columnReader(
  header: string[],
  aliases: Record<string, readonly string[]> = {},
) {
  const index = new Map(header.map((h, i) => [h.trim(), i]))
  for (const [name, old] of Object.entries(aliases)) {
    if (index.has(name)) continue
    const found = old.find((o) => index.has(o))
    if (found != null) index.set(name, index.get(found)!)
  }
  return {
    has: (name: string) => index.has(name),
    /** The cell for `name`, or undefined when the file has no such column. */
    get: (cols: string[], name: string): string | undefined => {
      const i = index.get(name)
      return i == null ? undefined : cols[i]
    },
  }
}

/**
 * The data lines of a CSV: BOM stripped, blank lines and `#` preamble lines
 * dropped.
 *
 * `downloadCsv` writes a UTF-8 BOM so Excel reads "Ω" and "—" as what they are
 * rather than as mojibake; left in place it would glue itself to the first
 * header name, which then matches nothing. The `#` lines are its optional
 * metadata preamble -- see `downloadCsv`.
 */
export function csvDataLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
}

/**
 * Header names the automation CSVs used before they took the workbook's
 * vocabulary ("Measured [dBm]" rather than `measured_dbm`). Every importer
 * passes this to `columnReader`, so a file exported before the rename still
 * reads back.
 */
export const LEGACY_CSV_HEADERS: Record<string, readonly string[]> = {
  'Freq [MHz]': ['freq_mhz'],
  'Set [dBm]': ['set_power_dbm'],
  'PA mode': ['pa_mode'],
  'Measured [dBm]': ['measured_dbm'],
  'Raw [dBm]': ['measured_dbm_raw'],
  'Path loss [dB]': ['path_loss_db'],
  'CC [mA]': ['current_ma'],
  'V [V]': ['voltage_v'],
  'Margin [dB]': ['margin_db'],
  'Min [dBm]': ['min_dbm'],
  'Max [dBm]': ['max_dbm'],
  Verdict: ['verdict'],
  'DUT status': ['status'],
  EARFCN: ['earfcn'],
  Band: ['band'],
  Modem: ['modem'],
  BW: ['bandwidth_khz', 'bandwidth'],
  Datarate: ['datarate'],
  MCS: ['mcs'],
  RBs: ['rb_count'],
}

/**
 * The workbook's "Status" cell for a row: "ok", the error, or the DUT status
 * that failed it. One column rather than the old `ok`/`error` pair, so a CSV
 * and an .xlsx of the same run say the same thing in the same place.
 */
export function statusCell(r: { ok: boolean; status: number | null; error: string | null }): string {
  if (r.error) return r.error
  return r.ok ? 'ok' : `status=${r.status ?? '?'}`
}

/**
 * `ok`, `status` and `error` back out of a row -- from the "Status" and
 * "DUT status" columns, or from the `ok`/`status`/`error` columns older files
 * carry instead.
 */
export function readStatus(
  col: ReturnType<typeof columnReader>,
  cols: string[],
): { ok: boolean; status: number | null; error: string | null } {
  const status = numOrNull(col.get(cols, 'DUT status'))
  if (col.has('Status')) {
    const text = (col.get(cols, 'Status') ?? '').trim()
    const ok = text.toLowerCase() === 'ok'
    // "status=3" is what `statusCell` writes for a failure with no message, so
    // it is not an error of its own -- the code is already in `status`.
    const error = ok || text === '' || /^status=(-?\d+|\?)$/.test(text) ? null : text
    return { ok, status, error }
  }
  const error = (col.get(cols, 'error') ?? '').trim()
  return {
    ok: (col.get(cols, 'ok') ?? '').trim().toLowerCase() === 'true',
    status,
    error: error === '' ? null : error,
  }
}
