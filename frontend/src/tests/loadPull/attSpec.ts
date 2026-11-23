import { parseRangeSpec } from '../../lib/numericList'
import type { LoadPullPageSnapshot } from '../../store/loadPullPageStore'

/** The attenuator's range. It is set by hand in whole dB. */
export const ATT_MAX_LIMIT_DB = 20

/** The attenuator settings a spec names, in the order typed ("20-0:5",
 *  "0-5, 8, 9, 20"), or null while it is empty or names a setting that is
 *  not a whole dB within 0-20. */
export function parseAttSpec(text: string): number[] | null {
  const vs = parseRangeSpec(text)
  return vs.length > 0 && vs.every((v) => Number.isInteger(v) && v >= 0 && v <= ATT_MAX_LIMIT_DB)
    ? vs : null
}

/** The spec a snapshot saved before the single field had: its start, stop
 *  and step (or the older Att max, which always started at 0). */
export function legacyAttSpec(snap: LoadPullPageSnapshot): string {
  const start = snap.attStartDb ?? 0
  const stop = snap.attStopDb ?? snap.attMaxDb ?? ATT_MAX_LIMIT_DB
  const step = snap.attStepDb ?? 1
  return step === 1 ? `${start}-${stop}` : `${start}-${stop}:${step}`
}
