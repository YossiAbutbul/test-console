/**
 * The TX CW automation's results, written out and read back.
 *
 * Both directions live here so they cannot disagree: an exporter and an
 * importer that each keep their own column list stay in step exactly until
 * someone adds a column to one of them.
 */
import { columnReader, numOrNull, splitCsvRow } from '../../lib/csv'
import { num } from '../../lib/format'
import { verdictWithinMargin } from '../../lib/verdict'
import type { AutomationResultRow } from '../../store/powerPageStore'

/** Indexed by the wire value: 0 = Off, 1 = On, 2 = Auto. */
export const PA_MODE_LABEL = ['Off', 'On', 'Auto']

/** Wire value for a PA mode name, tolerant of what a spreadsheet might hold. */
export function paModeFromLabel(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const byLabel = PA_MODE_LABEL.findIndex((l) => l.toLowerCase() === t.toLowerCase())
  if (byLabel !== -1) return byLabel
  // Files written by hand, or by an older export, may hold the raw enum.
  const n = Number(t)
  return PA_MODE_LABEL[n] != null ? n : null
}

export const CSV_HEADER = [
  'freq_mhz', 'set_power_dbm', 'pa_mode',
  'measured_dbm', 'current_ma', 'path_loss_db',
  'margin_db', 'min_dbm', 'max_dbm', 'verdict', 'ok', 'status', 'error',
] as const

/** Columns without which this is not one of our exports. */
const REQUIRED = ['freq_mhz', 'set_power_dbm', 'measured_dbm']

/** Values are rounded for readability in a spreadsheet, not for storage. */
export function toCsvBody(
  rows: AutomationResultRow[],
): Array<Array<string | number | boolean>> {
  return rows.map((r) => [
    num(r.freq_mhz, 2),
    r.set_power_dbm,
    PA_MODE_LABEL[r.pa_mode] ?? r.pa_mode,
    num(r.measured_dbm, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    // Derived from the row so it is the loss this point was corrected by,
    // which is not the same for every row once the table spans a band.
    r.measured_dbm == null || r.measured_dbm_raw == null
      ? ''
      : num(r.measured_dbm - r.measured_dbm_raw, 2),
    r.margin_db ?? '',
    // The band the margin worked out to, written out so a reader of the
    // workbook does not have to redo the arithmetic per row.
    r.margin_db == null ? '' : num(r.set_power_dbm - r.margin_db, 2),
    r.margin_db == null ? '' : num(r.set_power_dbm + r.margin_db, 2),
    r.verdict ?? '',
    r.ok,
    r.status ?? '',
    r.error ?? '',
  ])
}

/**
 * Read back a results CSV this panel exported.
 *
 * Tolerant about column order and about extra columns, strict about the few it
 * cannot do without. Throws with something an operator can act on rather than
 * returning a half-filled table.
 */
export function parsePowerCsv(text: string): AutomationResultRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('The file is empty')

  const header = splitCsvRow(lines[0]).map((h) => h.trim())
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `Not a TX CW export — missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }
  const col = columnReader(header)

  const rows: AutomationResultRow[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line)
    const freq = numOrNull(col.get(cols, 'freq_mhz'))
    // A row with no frequency is not a measurement point — a stray trailing
    // line, or a totals row someone added in Excel.
    if (freq == null) continue

    const setPower = numOrNull(col.get(cols, 'set_power_dbm')) ?? 0
    const measured = numOrNull(col.get(cols, 'measured_dbm'))
    const pathLoss = numOrNull(col.get(cols, 'path_loss_db'))
    const ccMa = numOrNull(col.get(cols, 'current_ma'))
    const margin = numOrNull(col.get(cols, 'margin_db'))
    const error = (col.get(cols, 'error') ?? '').trim()

    const recorded = (col.get(cols, 'verdict') ?? '').trim().toLowerCase()
    const verdict = recorded === 'pass' || recorded === 'fail'
      ? recorded
      // Recomputed only when the file does not say. The recorded verdict is
      // the truth of the run that produced it; recomputing over the top would
      // rewrite history if the rule ever changed.
      : verdictWithinMargin(measured, setPower, margin)

    rows.push({
      freq_mhz: freq,
      set_power_dbm: setPower,
      pa_mode: paModeFromLabel(col.get(cols, 'pa_mode') ?? '') ?? 2,
      measured_dbm: measured,
      // The raw reading is not exported — it is recovered from the corrected
      // value and the loss that was applied, so the path-loss column survives
      // a round trip.
      measured_dbm_raw: measured == null || pathLoss == null ? null : measured - pathLoss,
      current_a: ccMa == null ? null : ccMa / 1000,
      // Not exported: the table never shows it, so there is nothing to recover.
      voltage_v: null,
      margin_db: margin,
      verdict,
      ok: (col.get(cols, 'ok') ?? '').trim().toLowerCase() === 'true',
      status: numOrNull(col.get(cols, 'status')),
      error: error === '' ? null : error,
    })
  }

  if (rows.length === 0) throw new Error('No data rows found')
  return rows
}
