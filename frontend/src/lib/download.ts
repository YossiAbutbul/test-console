/**
 * File export.
 *
 * The anchor/objectURL/revoke dance was open-coded in five places, each with
 * its own timestamp format and CSV quoting rule. This is the shared one.
 */

/**
 * The File System Access API, which lib.dom does not declare on every TS
 * version this project builds against. Narrowed to the one call used here.
 */
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description: string; accept: Record<string, string[]> }>
}
interface Writable {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}
interface SaveHandle {
  createWritable: () => Promise<Writable>
}
type SaveFilePicker = (opts: SaveFilePickerOptions) => Promise<SaveHandle>

/** What a save ended as. Cancelling is not a failure and must not be reported
 *  as one -- "Export failed" for a dialog the operator dismissed is wrong. */
export type SaveOutcome = 'saved' | 'cancelled'

/** File-type filter for the picker, so the dialog offers the right extension. */
function typesFor(filename: string): SaveFilePickerOptions['types'] {
  if (filename.endsWith('.xlsx')) {
    return [{
      description: 'Excel workbook',
      accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    }]
  }
  if (filename.endsWith('.csv')) {
    return [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
  }
  return undefined
}

/**
 * Save a blob, letting the operator choose the folder and name.
 *
 * Uses the File System Access API where it exists -- Chrome and Edge, which is
 * what this app runs in -- so an export lands where the operator wants it
 * rather than in whatever Downloads is set to, under a name they can change at
 * the point of saving. Anywhere else it falls back to the old anchor download,
 * which cannot ask.
 *
 * Requires a secure context; `localhost` counts, so the dev server and the
 * bundled build both qualify.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<SaveOutcome> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: typesFor(filename) })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (e) {
      // Dismissing the dialog is a decision, not an error.
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
      // Anything else -- a blocked permission, a picker the browser refused --
      // still leaves the operator wanting the file, so fall through.
    }
  }
  downloadBlob(blob, filename)
  return 'saved'
}

/** Trigger a browser download for an in-memory blob, with no choice of path. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * `2026-07-28T14-05-31` — filesystem-safe, sorts chronologically.
 *
 * Local time, not UTC: the backend names its workbooks with the same form in
 * local time (`export_filename` in backend/workbook.py), and a CSV saved at
 * 14:05 was being stamped with whatever the UTC offset made of it.
 */
export function timestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * A DUT MAC as a filename fragment. Excel uses a CSV's base name as the sheet
 * name, and colons are not valid there.
 */
export function macSlug(mac: string | null | undefined): string {
  return (mac ?? '').replace(/:/g, '').toUpperCase()
}

/**
 * `<MAC or noDUT>_<test-slug>_<YYYY-MM-DDTHH-MM-SS>.<ext>`.
 *
 * The one filename scheme for every export, CSV and workbook alike: the
 * backend builds the same name for the workbooks it renders (`export_filename`
 * in backend/workbook.py), so files from every page sort by DUT, then test,
 * then time. It used to drop the test name whenever a MAC was known, so two
 * pages' exports for one DUT could not be told apart by name.
 *
 * @param testSlug Names the test, e.g. `tx-cw-automation`.
 */
export function exportName(
  testSlug: string,
  mac: string | null | undefined,
  ext: string,
): string {
  return `${macSlug(mac) || 'noDUT'}_${testSlug}_${timestamp()}.${ext}`
}

/** RFC 4180 quoting: wrap in quotes only when the cell needs it. */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialise a header + rows to CSV text with CRLF line endings. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((cols) => cols.map(csvCell).join(',')).join('\r\n')
}

/**
 * Optional `#` lines written ahead of the header: which test, when, on which
 * DUT. Every importer skips lines starting with `#` (`csvDataLines` in
 * lib/csv.ts), so a file carrying them still reads back.
 */
export type CsvMeta = Record<string, string | number | null | undefined>

/** The `#` preamble lines for `meta`, with the export time always included. */
export function csvPreamble(meta: CsvMeta, now: Date = new Date()): string[] {
  const entries: Array<[string, unknown]> = [
    ...Object.entries(meta),
    // Readable here, unlike the filename form: "2026-07-28 14:05:31".
    ['exported', timestamp(now).replace(/T(\d\d)-(\d\d)-(\d\d)$/, ' $1:$2:$3')],
    ['app', 'Test Console'],
  ]
  return entries
    .filter(([, v]) => v != null && v !== '')
    // A newline inside a value would end the comment and start a data row.
    .map(([k, v]) => `# ${k}: ${String(v).replace(/[\r\n]+/g, ' ')}`)
}

/**
 * UTF-8 byte-order mark. Excel opens a BOM-less CSV in the system code page,
 * which turns "Ω", "—" and "µ" into mojibake; with it, Excel reads UTF-8.
 * Importers strip it again (`csvDataLines`).
 */
const BOM = '\uFEFF'

/**
 * Serialise and save in one step, asking where the file should go.
 *
 * @param meta Optional preamble -- see `CsvMeta`. Left out, the file starts at
 *             its header row as it always has.
 */
export function downloadCsv(
  header: string[],
  rows: unknown[][],
  filename: string,
  meta?: CsvMeta,
): Promise<SaveOutcome> {
  const preamble = meta ? csvPreamble(meta).join('\r\n') + '\r\n' : ''
  const blob = new Blob([BOM + preamble + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  return saveBlob(blob, filename)
}
