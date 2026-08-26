/**
 * The signal parameters a modulated command carries.
 *
 * Shared by the sweep panel and the CSV round-trip, so the labels a workbook
 * is written with are the same ones read back — a second copy of these maps
 * would drift the moment a bandwidth was added.
 */

export const MODEM_FSK = 0
export const MODEM_LORA = 1

/** Indexed by the wire value. */
export const MODEM_LABEL = ['FSK', 'LoRa']

export const BW_OPTIONS = [
  { code: 0, label: '125 kHz' },
  { code: 1, label: '250 kHz' },
  { code: 2, label: '500 kHz' },
]

/**
 * Datarate means two different things.
 *
 * For LoRa it is the spreading factor, 6..12. For FSK it is a bit rate, which
 * is a far larger number — the manual tab caps the field at 12 either way,
 * which quietly makes FSK unusable there.
 */
export const SF_MIN = 6
export const SF_MAX = 12
export const SF_DEFAULT = 7
export const FSK_BPS_MAX = 300_000

/** Valid datarate span for a modem. */
export function drRange(modem: number): { min: number; max: number } {
  return modem === MODEM_FSK ? { min: 1, max: FSK_BPS_MAX } : { min: SF_MIN, max: SF_MAX }
}

/** Wire value for a modem name, tolerant of what a spreadsheet might hold. */
export function modemFromLabel(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const byLabel = MODEM_LABEL.findIndex((l) => l.toLowerCase() === t.toLowerCase())
  if (byLabel !== -1) return byLabel
  // Files written by hand, or by an older export, may hold the raw enum.
  const n = Number(t)
  return n === MODEM_FSK || n === MODEM_LORA ? n : null
}

/** Bandwidth code for a label like "250 kHz". */
export function bandwidthFromLabel(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const byLabel = BW_OPTIONS.find((b) => b.label.toLowerCase() === t.toLowerCase())
  if (byLabel) return byLabel.code
  const n = Number(t)
  return BW_OPTIONS.some((b) => b.code === n) ? n : null
}
