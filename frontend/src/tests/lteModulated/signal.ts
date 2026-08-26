/**
 * The signal parameters an LTE modulated command carries.
 *
 * Shared by the sweep panel and the CSV round-trip, so the labels a workbook
 * is written with are the same ones read back — a second copy of these would
 * drift the moment a bandwidth was added.
 *
 * Mirrors `LteBandwidth` / `RB_COUNT_FOR_BW` / `MAX_MCS` in
 * `backend/device/lte.py`; both sides point at each other.
 */

export interface BandwidthOption {
  /** Wire value. */
  code: number
  label: string
  /** Resource blocks the channel has — 3GPP TS 36.101 table 5.6-1. */
  rb: number
}

export const BW_OPTIONS: BandwidthOption[] = [
  { code: 0, label: '1.4 MHz', rb: 6 },
  { code: 1, label: '3 MHz', rb: 15 },
  { code: 2, label: '5 MHz', rb: 25 },
  { code: 3, label: '10 MHz', rb: 50 },
  { code: 4, label: '15 MHz', rb: 75 },
  { code: 5, label: '20 MHz', rb: 100 },
]

export const BW_DEFAULT = 2

/** Resource blocks available in a channel, or 0 for an unknown bandwidth. */
export function rbForBandwidth(code: number): number {
  return BW_OPTIONS.find((b) => b.code === code)?.rb ?? 0
}

export function bandwidthLabel(code: number): string {
  return BW_OPTIONS.find((b) => b.code === code)?.label ?? String(code)
}

/** Bandwidth code for a label like "5 MHz". */
export function bandwidthFromLabel(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const byLabel = BW_OPTIONS.find((b) => b.label.toLowerCase() === t.toLowerCase())
  if (byLabel) return byLabel.code
  // A workbook may hold the bare figure — "5" — either as the MHz or as the
  // wire code. MHz wins: it is what the column reads as, and a file written by
  // hand is far likelier to say 10 meaning 10 MHz than 10 meaning an enum that
  // does not go that high.
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  const byMhz = BW_OPTIONS.find((b) => Number.parseFloat(b.label) === n)
  if (byMhz) return byMhz.code
  return BW_OPTIONS.some((b) => b.code === n) ? n : null
}

/**
 * PUSCH modulation and coding scheme.
 *
 * I_MCS runs 0..28; 29-31 are reserved for retransmissions and are not
 * something a test command asks for.
 */
export const MCS_MIN = 0
export const MCS_MAX = 28
export const MCS_DEFAULT = 5

/** The allocation from the captured frames — the narrowest a channel can hold. */
export const RB_DEFAULT = 6
