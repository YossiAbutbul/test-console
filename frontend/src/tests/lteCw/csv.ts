/**
 * The LTE CW automation's results, written out and read back.
 *
 * Both directions live here so they cannot disagree: an exporter and an
 * importer that each keep their own column list stay in step exactly until
 * someone adds a column to one of them.
 */
import { columnReader, numOrNull, splitCsvRow } from '../../lib/csv'
import { num } from '../../lib/format'
import { uplinkFromEarfcn } from '../../lib/earfcn'
import { verdictWithinMargin } from '../../lib/verdict'
import type { LteAutomationResultRow } from '../../store/lteCwPageStore'

export const CSV_HEADER = [
  'earfcn', 'band', 'freq_mhz', 'set_power_dbm',
  'measured_dbm', 'current_ma', 'path_loss_db',
  'margin_db', 'min_dbm', 'max_dbm', 'verdict', 'ok', 'status', 'error',
] as const

/** Columns without which this is not one of our exports. */
const REQUIRED = ['earfcn', 'set_power_dbm', 'measured_dbm']

/** Values are rounded for readability in a spreadsheet, not for storage. */
export function toCsvBody(
  rows: LteAutomationResultRow[],
): Array<Array<string | number | boolean>> {
  return rows.map((r) => [
    r.earfcn,
    r.band ?? '',
    num(r.freq_mhz, 3),
    r.set_power_dbm,
    num(r.measured_dbm, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    // Derived from the row so it is the loss this point was corrected by,
    // which is not the same for every row once the table spans bands.
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
export function parseLteCwCsv(text: string): LteAutomationResultRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new Error('The file is empty')

  const header = splitCsvRow(lines[0]).map((h) => h.trim())
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `Not an LTE CW export — missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }
  const col = columnReader(header)

  const rows: LteAutomationResultRow[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line)
    const earfcn = numOrNull(col.get(cols, 'earfcn'))
    // A row with no channel is not a measurement point — a stray trailing
    // line, or a totals row someone added in Excel.
    if (earfcn == null) continue

    const setPower = numOrNull(col.get(cols, 'set_power_dbm')) ?? 0
    const measured = numOrNull(col.get(cols, 'measured_dbm'))
    const pathLoss = numOrNull(col.get(cols, 'path_loss_db'))
    const ccMa = numOrNull(col.get(cols, 'current_ma'))
    const margin = numOrNull(col.get(cols, 'margin_db'))
    const error = (col.get(cols, 'error') ?? '').trim()

    // Frequency and band are derived from the EARFCN when the file does not
    // carry them, which is what makes a hand-written channel list importable:
    // the channel number is the only thing that cannot be recomputed.
    const ch = uplinkFromEarfcn(earfcn)
    const freq = numOrNull(col.get(cols, 'freq_mhz'))
      ?? (ch ? ch.freqHz / 1e6 : 0)
    const band = numOrNull(col.get(cols, 'band')) ?? ch?.band ?? null

    const recorded = (col.get(cols, 'verdict') ?? '').trim().toLowerCase()
    const verdict = recorded === 'pass' || recorded === 'fail'
      ? recorded
      // Recomputed only when the file does not say. The recorded verdict is
      // the truth of the run that produced it; recomputing over the top would
      // rewrite history if the rule ever changed.
      : verdictWithinMargin(measured, setPower, margin)

    rows.push({
      earfcn,
      band,
      freq_mhz: freq,
      set_power_dbm: setPower,
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
