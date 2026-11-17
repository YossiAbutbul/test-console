/**
 * The BLE CW automation's results, written out and read back.
 *
 * Both directions live here so they cannot disagree -- the same arrangement
 * as `lteCw/csv.ts`, in the same workbook vocabulary.
 */
import {
  LEGACY_CSV_HEADERS, columnReader, csvDataLines, numOrNull, readStatus, splitCsvRow,
  statusCell,
} from '../../lib/csv'
import { num } from '../../lib/format'
import { verdictOf } from '../../lib/verdict'
import type { BleAutomationResultRow } from '../../store/bleCwPageStore'
import { channelMhz, isChannel } from '../ble/radio'

export const CSV_HEADER = [
  'Channel', 'Freq [MHz]', 'Power param',
  'Measured [dBm]', 'Raw [dBm]', 'Path loss [dB]', 'CC [mA]', 'V [V]',
  'Min [dBm]', 'Max [dBm]', 'Verdict', 'Status', 'DUT status',
] as const

/** Columns without which this is not one of our exports. */
const REQUIRED = ['Channel', 'Power param', 'Measured [dBm]']

/** Values are rounded for readability in a spreadsheet, not for storage. */
export function toCsvBody(
  rows: BleAutomationResultRow[],
): Array<Array<string | number | boolean>> {
  return rows.map((r) => [
    r.channel,
    num(r.freq_mhz, 0),
    r.power_param,
    num(r.measured_dbm, 2),
    num(r.measured_dbm_raw, 2),
    // Derived from the row, so it is the loss this point was corrected by.
    r.measured_dbm == null || r.measured_dbm_raw == null
      ? ''
      : num(r.measured_dbm - r.measured_dbm_raw, 2),
    r.current_a == null ? '' : num(r.current_a * 1000, 2),
    num(r.voltage_v, 2),
    r.min_dbm ?? '',
    r.max_dbm ?? '',
    r.verdict ?? '',
    statusCell(r),
    r.status ?? '',
  ])
}

/**
 * Read back a results CSV this panel exported.
 *
 * Tolerant about column order and extra columns, strict about the few it
 * cannot do without. Throws with something an operator can act on rather
 * than returning a half-filled table.
 */
export function parseBleCwCsv(text: string): BleAutomationResultRow[] {
  const lines = csvDataLines(text)
  if (lines.length === 0) throw new Error('The file is empty')

  const header = splitCsvRow(lines[0]).map((h) => h.trim())
  const col = columnReader(header, LEGACY_CSV_HEADERS)
  const missing = REQUIRED.filter((c) => !col.has(c))
  if (missing.length) {
    throw new Error(
      `Not a BLE CW export: missing ${missing.join(', ')}. `
      + `Found: ${header.join(', ')}`,
    )
  }

  const rows: BleAutomationResultRow[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvRow(line)
    const channel = numOrNull(col.get(cols, 'Channel'))
    // A row with no channel is not a point -- a stray line, a totals row.
    if (channel == null || !isChannel(channel)) continue

    const measured = numOrNull(col.get(cols, 'Measured [dBm]'))
    const raw = numOrNull(col.get(cols, 'Raw [dBm]'))
    const pathLoss = numOrNull(col.get(cols, 'Path loss [dB]'))
    const ccMa = numOrNull(col.get(cols, 'CC [mA]'))
    const min = numOrNull(col.get(cols, 'Min [dBm]'))
    const max = numOrNull(col.get(cols, 'Max [dBm]'))

    const recorded = (col.get(cols, 'Verdict') ?? '').trim().toLowerCase()
    // The recorded verdict is the truth of the run that produced it; it is
    // only worked out here when the file does not say.
    const verdict = recorded === 'pass' || recorded === 'fail'
      ? recorded
      : verdictOf(measured, min, max)

    rows.push({
      channel,
      freq_mhz: numOrNull(col.get(cols, 'Freq [MHz]')) ?? channelMhz(channel),
      power_param: numOrNull(col.get(cols, 'Power param')) ?? 0,
      measured_dbm: measured,
      measured_dbm_raw: raw ?? (measured == null || pathLoss == null ? null : measured - pathLoss),
      current_a: ccMa == null ? null : ccMa / 1000,
      voltage_v: numOrNull(col.get(cols, 'V [V]')),
      min_dbm: min,
      max_dbm: max,
      verdict,
      ...readStatus(col, cols),
    })
  }

  if (rows.length === 0) throw new Error('No data rows found')
  return rows
}
