/**
 * Which DUT a test's results were measured on, remembered against the results
 * themselves (AddToReport.tsx), so "Add to report" names the right unit after
 * the DUT is disconnected or another one is connected.
 */
import type { ReportEntryDraft } from '../../api/reports'

/** The DUT a test's current results were measured on. */
export interface RunDut {
  mac: string
  name: string | null
  /** Which results: see fingerprint(). */
  fp: string
}

/** "80:e1:27-fa a9 f9" -> "80E127FAA9F9"; the report stores MACs bare. */
export function normMac(mac: string | null | undefined): string {
  return (mac ?? '').replace(/[:\s-]/g, '').toUpperCase()
}

/** Identifies a results table well enough to tell a new run from the same
 *  one: its test, size, and first and last rows. Empty for no results. */
export function fingerprint(d: ReportEntryDraft): string {
  const n = d.rows.length
  if (!n) return ''
  return `${d.test}|${n}|${JSON.stringify(d.rows[0])}|${JSON.stringify(d.rows[n - 1])}`
}

/** What the run's DUT is remembered as, given what was stored, the results
 *  now and the DUT connected now. Results that changed while a DUT was
 *  connected were measured on it; results that did not change keep the unit
 *  they had, whoever is connected since; no results, no unit. */
export function nextRunDut(
  prev: RunDut | undefined, fp: string, live: { mac: string; name: string | null } | null,
): RunDut | undefined {
  if (!fp) return undefined
  if (prev?.fp === fp) return prev
  return live ? { mac: normMac(live.mac), name: live.name, fp } : prev
}
