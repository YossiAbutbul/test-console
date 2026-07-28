/**
 * File export.
 *
 * The anchor/objectURL/revoke dance was open-coded in five places, each with
 * its own timestamp format and CSV quoting rule. This is the shared one.
 */

/** Trigger a browser download for an in-memory blob. */
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

/** Serialise and download in one step. */
export function downloadCsv(
  header: string[],
  rows: unknown[][],
  filename: string,
): void {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, filename)
}
