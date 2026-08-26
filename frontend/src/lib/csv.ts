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
 */
export function columnReader(header: string[]) {
  const index = new Map(header.map((h, i) => [h.trim(), i]))
  return {
    has: (name: string) => index.has(name),
    /** The cell for `name`, or undefined when the file has no such column. */
    get: (cols: string[], name: string): string | undefined => {
      const i = index.get(name)
      return i == null ? undefined : cols[i]
    },
  }
}
