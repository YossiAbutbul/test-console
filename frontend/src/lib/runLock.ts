/**
 * One run in the browser at a time.
 *
 * The backend refuses a second run of its own (`refuse_if_running`, 409), but
 * the sweeps loop in the browser and every page stays mounted, so nothing
 * stopped a LoRa CW sweep and a Full Run keying the DUT and reading the sensor
 * at once -- two callers on one VISA session, which desyncs it. A run claims
 * the rig as it starts and releases it however it ends.
 *
 * Module state rather than context: nothing renders from it, and a context
 * would re-render every sweep panel whenever any run started or stopped.
 */
const holders = new Map<string, string>()

/**
 * Claim the rig for the run under `key` ("run:power"), described as `label`
 * ("LoRa CW"). Returns a release function, or the reason it is taken.
 */
export function claimRun(key: string, label: string): (() => void) | string {
  for (const [k, l] of holders) {
    if (k !== key) return `${l} is running — one run at a time`
  }
  holders.set(key, label)
  return () => { if (holders.get(key) === label) holders.delete(key) }
}

/** For tests: forget every claim. */
export function resetRunLocks(): void { holders.clear() }
