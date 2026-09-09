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

/** `2026-07-28T14-05-31` — filesystem-safe, sorts chronologically. */
export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * A DUT MAC as a filename fragment. Excel uses a CSV's base name as the sheet
 * name, and colons are not valid there.
 */
export function macSlug(mac: string | null | undefined): string {
  return (mac ?? '').replace(/:/g, '').toUpperCase()
}

/**
 * Build a timestamped download filename, keyed on the DUT when one is known.
 *
 * @param fallback Base name when there is no MAC.
 * @param suffix   Appended after the MAC, to name the test in the file.
 */
export function exportName(
  fallback: string,
  mac: string | null | undefined,
  ext: string,
  suffix = '',
): string {
  const slug = macSlug(mac)
  const base = slug ? `${slug}${suffix}` : fallback
  return `${base}-${timestamp()}.${ext}`
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

/** Serialise and save in one step, asking where the file should go. */
export function downloadCsv(
  header: string[],
  rows: unknown[][],
  filename: string,
): Promise<SaveOutcome> {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  return saveBlob(blob, filename)
}
