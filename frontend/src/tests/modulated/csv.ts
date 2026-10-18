/**
 * The Modulated automation's results, written out and read back.
 *
 * Both directions live here so they cannot disagree: an exporter and an
 * importer that each keep their own column list stay in step exactly until
 * someone adds a column to one of them.
 *
 * Headers use the workbook's vocabulary, as the other automation CSVs do; files
 * written with the older snake_case headers still import -- see
 * `LEGACY_CSV_HEADERS`.
 */
import {
  LEGACY_CSV_HEADERS, columnReader, csvDataLines, numOrNull, readStatus, splitCsvRow,
  statusCell,
} from '../../lib/csv'
import { num } from '../../lib/format'
import { verdictWithinMargin } from '../../lib/verdict'
import type { ModulatedResultRow } from '../../store/modulatedPageStore'
import {
  BW_OPTIONS, MODEM_FSK, MODEM_LABEL, bandwidthFromLabel, modemFromLabel,
} from './signal'

export const CSV_HEADER = [
  'Freq [MHz]', 'Set [dBm]', 'Modem', 'BW', 'Datarate',
  'Measured [dBm]', 'Raw [dBm]', 'Path loss [dB]', 'CC [mA]', 'V [V]',
  'Margin [dB]', 'Min [dBm]', 'Max [dBm]', 'Verdict', 'Status', 'DUT status',
] as const

/** Columns without which this is not one of our exports. */
const REQUIRED = ['Freq [MHz]', 'Set [dBm]', 'Measured [dBm]']

/** Values are rounded for readability in a spreadsheet, not for storage. */
export function toCsvBody(rows: ModulatedResultRow[]): Array<Array<string | number | boolean>> {
  return rows.map((r) => [
    num(r.freq_mhz, 2),
    r.set_power_dbm,
    MODEM_LABEL[r.modem] ?? r.modem,
    // The label, not the enum: a column of 0/1/2 is unreadable in a workbook
    // opened six months later.
    r.modem === MODEM_FSK ? '' : (BW_OPTIONS[r.bandwidth]?.label ?? r.bandwidth),
    r.datarate,
    num(r.measured_dbm, 2),
    // Raw beside the corrected figure, as the workbooks have it.
    num(r.measured_dbm_raw, 2),
    // Derived from the row so it is the loss this point was corrected by,
    // which is not the same for every row once the table spans a band.
    r.measured_dbm == null || r.measured_dbm_raw == null
      ? ''
      : num(r.measured_dbm - r.measured_dbm_raw, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    num(r.voltage_v, 2),
    r.margin_db ?? '',
    // The band the margin worked out to, written out so a reader of the
    // workbook does not have to redo the arithmetic per row.
    r.margin_db == null ? '' : num(r.set_power_dbm - r.margin_db, 2),
    r.margin_db == null ? '' : num(r.set_power_dbm + r.margin_db, 2),
    r.verdict ?? '',
    statusCell(r),
    r.status ?? '',
  ])
}

/**
 * Read back a results CSV this panel exported.
 *
 * Tolerant about column order and about extra columns, strict about the few it
 * cannot do without. Throws with something an operator can act on rather than
 * returning a half-filled table.
 */
export function parseModulatedCsv(text: string): ModulatedResultRow[] {
  const lines = csvDataLines(text)
  if (lines.length === 0) throw new Error('The file is empty')

  const header = splitCsvRow(lines[0]).map((h) => h.trim())
  const col = columnReader(header, LEGACY_CSV_HEADERS)
  const missing = REQUIRED.filter((c) => !col.has(c))
  if (missing.length) {
    throw new Error(
      `Not a Modulated export — missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }

  const rows: ModulatedResultRow[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line)
    const freq = numOrNull(col.get(cols, 'Freq [MHz]'))
    // A row with no frequency is not a measurement point — a stray trailing
    // line, or a totals row someone added in Excel.
    if (freq == null) continue

    const setPower = numOrNull(col.get(cols, 'Set [dBm]')) ?? 0
    const measured = numOrNull(col.get(cols, 'Measured [dBm]'))
    const raw = numOrNull(col.get(cols, 'Raw [dBm]'))
    const pathLoss = numOrNull(col.get(cols, 'Path loss [dB]'))
    const ccMa = numOrNull(col.get(cols, 'CC [mA]'))
    const margin = numOrNull(col.get(cols, 'Margin [dB]'))
    const modem = modemFromLabel(col.get(cols, 'Modem') ?? '') ?? MODEM_FSK

    const recorded = (col.get(cols, 'Verdict') ?? '').trim().toLowerCase()
    const verdict = recorded === 'pass' || recorded === 'fail'
      ? recorded
      // Recomputed only when the file does not say. The recorded verdict is
      // the truth of the run that produced it; recomputing over the top would
      // rewrite history if the rule ever changed.
      : verdictWithinMargin(measured, setPower, margin)

    rows.push({
      freq_mhz: freq,
      set_power_dbm: setPower,
      modem,
      bandwidth: bandwidthFromLabel(col.get(cols, 'BW') ?? '') ?? 0,
      datarate: numOrNull(col.get(cols, 'Datarate')) ?? 0,
      measured_dbm: measured,
      // Older files carry no raw column; it is recovered there from the
      // corrected value and the loss that was applied.
      measured_dbm_raw: raw ?? (measured == null || pathLoss == null ? null : measured - pathLoss),
      current_a: ccMa == null ? null : ccMa / 1000,
      voltage_v: numOrNull(col.get(cols, 'V [V]')),
      margin_db: margin,
      verdict,
      ...readStatus(col, cols),
    })
  }

  if (rows.length === 0) throw new Error('No data rows found')
  return rows
}
