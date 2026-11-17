/**
 * The DUT's BLE radio, as the BLE test pages address it.
 *
 * Every limit here is enforced again by the backend -- see
 * backend/device/ble.py, which each constant mirrors -- so a value the UI
 * lets through and the backend refuses is a 422 naming the field rather than
 * a frame on the wire.
 */

/** Tone power is the firmware's own parameter, not dBm. The operator works
 *  in it too, so it is never converted. Mirrors TX_POWER_PARAM_MIN / _MAX. */
export const POWER_PARAM_MIN = 6
export const POWER_PARAM_MAX = 31

/** BLE RF channels 0-39. Mirrors CHANNEL_MAX. */
export const CHANNEL_MIN = 0
export const CHANNEL_MAX = 39

/**
 * Tone duration, whole seconds. Mirrors DURATION_MIN_S / DURATION_MAX_S.
 *
 * Never 0: a tone cannot be stopped once started, so one without an end is a
 * DUT only a power cycle gets back. Capped at 255 because the frames seen so
 * far do not settle whether the field is one byte or two.
 */
export const DURATION_MIN_S = 1
export const DURATION_MAX_S = 255

/**
 * How long a relink scans for the DUT before giving up, in seconds. Covers a
 * reboot after save-and-reset with room to spare. Mirrors RELINK_TIMEOUT_S in
 * backend/ble/manager.py.
 */
export const RELINK_TIMEOUT_S = 30

/**
 * Pause after a tone's duration before relinking.
 *
 * Small on purpose. The relink starts with a scan, and a scan cannot reach a
 * DUT that is still transmitting -- it is not advertising -- so starting a
 * moment early costs nothing but scanning. It was a full second, paid on
 * every point for no measured benefit. What is left covers our estimate of
 * the tone's end running a round trip early (it is taken from when the start
 * was sent).
 */
export const TONE_END_GRACE_MS = 200

/** 2402 + 2*channel MHz. */
export const channelMhz = (ch: number): number => 2402 + 2 * ch

export const isChannel = (v: number): boolean =>
  Number.isInteger(v) && v >= CHANNEL_MIN && v <= CHANNEL_MAX

export const isPowerParam = (v: number): boolean =>
  Number.isInteger(v) && v >= POWER_PARAM_MIN && v <= POWER_PARAM_MAX

export const isDuration = (v: number): boolean =>
  Number.isInteger(v) && v >= DURATION_MIN_S && v <= DURATION_MAX_S

/** MHz to channel, when the frequency is exactly one. */
export const channelFromMhz = (mhz: number): number | null => {
  const ch = (mhz - 2402) / 2
  return isChannel(ch) ? ch : null
}

/**
 * Why a reading cannot be the tone's power, or null when it can.
 *
 * A tone is measured inside a window that closes when its duration runs out,
 * and a reading that finishes after that was at least partly taken from a DUT
 * back to advertising: a few mA and the advertising bursts' average power,
 * which looks like a weak part rather than a missed one -- the first bench
 * run recorded -15 dBm at 1 mA on two channels that way. A read can run late
 * when it queues behind another reader of the same instrument (a continuous
 * trace on the Power Meter page, a panel's poll). Judged on when the read
 * *finished*, the last instant either instrument could have been sampling.
 * The tone's end is our estimate from when the start was sent, which runs a
 * round trip early, so the check errs towards refusing.
 */
export function offAirReason(readEndMs: number, toneEndMs: number | null, readMs: number): string | null {
  if (toneEndMs == null || readEndMs <= toneEndMs) return null
  const late = (readEndMs - toneEndMs) / 1000
  return `reading finished ${late.toFixed(1)} s after the tone ended (read took `
    + `${(readMs / 1000).toFixed(1)} s) — not recorded as the tone's power; `
    + 'lengthen the tone, or stop other readers of the instruments'
}
