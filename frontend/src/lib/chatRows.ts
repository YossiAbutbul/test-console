/**
 * Shaping a results table for the assistant.
 *
 * The rule here is that what the chat sees is what the operator sees. A page's
 * stored rows are not that: the Mode Sweep table shows "CC (mA) 503.8" while
 * the row holds `current_a: 0.5038`, and the Load Pull table shows a VSWR the
 * row does not carry at all. Send the stored shape and two things go wrong at
 * once. A question about "CC" is answered "there is no CC column", which is
 * what happened; and a relabelled `current_a` would have been reported as
 * 0.5 mA, which is worse, because it reads like a measurement.
 *
 * So each page maps its rows to its own column headers, in the units those
 * headers name, and these are the shared pieces of that mapping.
 */

/** Amps to milliamps, at the one decimal the tables show. Null stays null: a
 *  point that did not measure must not become a zero. */
export function mA(a: number | null | undefined): number | null {
  return a == null ? null : Math.round(a * 1000 * 10) / 10
}

/** The Status column, as the tables render it. */
export function statusOf(r: { ok?: boolean; error?: string | null }): string {
  if (r.error) return r.error
  return r.ok === false ? 'fail' : 'ok'
}
