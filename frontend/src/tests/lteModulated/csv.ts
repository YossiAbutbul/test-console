/**
 * The LTE Modulated automation's results, written out and read back.
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
import { uplinkFromEarfcn } from '../../lib/earfcn'
import { verdictWithinMargin } from '../../lib/verdict'
import {
  BW_DEFAULT, MCS_DEFAULT, RB_DEFAULT, bandwidthFromLabel, bandwidthLabel,
} from './signal'
import type { LteModulatedResultRow } from '../../store/lteModulatedPageStore'

export const CSV_HEADER = [
  'EARFCN', 'Band', 'Freq [MHz]', 'Set [dBm]',
  'BW', 'MCS', 'RBs',
  'Measured [dBm]', 'Raw [dBm]', 'Path loss [dB]', 'CC [mA]', 'V [V]',
  'Margin [dB]', 'Min [dBm]', 'Max [dBm]', 'Verdict', 'Status', 'DUT status',
] as const

/** Columns without which this is not one of our exports. */
const REQUIRED = ['EARFCN', 'Set [dBm]', 'Measured [dBm]']

/** Values are rounded for readability in a spreadsheet, not for storage. */
export function toCsvBody(
  rows: LteModulatedResultRow[],
): Array<Array<string | number | boolean>> {
  return rows.map((r) => [
    r.earfcn,
    r.band ?? '',
    num(r.freq_mhz, 3),
    r.set_power_dbm,
    // Written as the label rather than the wire code: a workbook column
    // reading "5 MHz" is worth more to whoever opens it than one reading 2.
    bandwidthLabel(r.bandwidth),
    r.mcs,
    r.rb_count,
    num(r.measured_dbm, 2),
    // Raw beside the corrected figure, as the workbooks have it.
    num(r.measured_dbm_raw, 2),
    // Derived from the row so it is the loss this point was corrected by,
    // which is not the same for every row once the table spans bands.
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
export function parseLteModulatedCsv(text: string): LteModulatedResultRow[] {
  const lines = csvDataLines(text)
  if (lines.length === 0) throw new Error('The file is empty')

  const header = splitCsvRow(lines[0]).map((h) => h.trim())
  const col = columnReader(header, LEGACY_CSV_HEADERS)
  const missing = REQUIRED.filter((c) => !col.has(c))
  if (missing.length) {
    throw new Error(
      `Not an LTE Modulated export — missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }

  const rows: LteModulatedResultRow[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line)
    const earfcn = numOrNull(col.get(cols, 'EARFCN'))
    // A row with no channel is not a measurement point — a stray trailing
    // line, or a totals row someone added in Excel.
    if (earfcn == null) continue

    const setPower = numOrNull(col.get(cols, 'Set [dBm]')) ?? 0
    const measured = numOrNull(col.get(cols, 'Measured [dBm]'))
    const raw = numOrNull(col.get(cols, 'Raw [dBm]'))
    const pathLoss = numOrNull(col.get(cols, 'Path loss [dB]'))
    const ccMa = numOrNull(col.get(cols, 'CC [mA]'))
    const margin = numOrNull(col.get(cols, 'Margin [dB]'))

    // Frequency and band are derived from the EARFCN when the file does not
    // carry them, which is what makes a hand-written channel list importable:
    // the channel number is the only thing that cannot be recomputed.
    const ch = uplinkFromEarfcn(earfcn)
    const freq = numOrNull(col.get(cols, 'Freq [MHz]'))
      ?? (ch ? ch.freqHz / 1e6 : 0)
    const band = numOrNull(col.get(cols, 'Band')) ?? ch?.band ?? null

    const recorded = (col.get(cols, 'Verdict') ?? '').trim().toLowerCase()
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
      // The signal columns fall back to the defaults rather than refusing the
      // row: they describe how the point was transmitted, and a file that
      // omits them is still a set of readings worth plotting.
      bandwidth: bandwidthFromLabel(col.get(cols, 'BW') ?? '') ?? BW_DEFAULT,
      mcs: numOrNull(col.get(cols, 'MCS')) ?? MCS_DEFAULT,
      rb_count: numOrNull(col.get(cols, 'RBs')) ?? RB_DEFAULT,
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
