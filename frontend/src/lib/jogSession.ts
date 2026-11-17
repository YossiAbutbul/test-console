/**
 * One press-and-hold jog of the trombone, from key-down to key-up.
 *
 * Shared by Load Pull (useTromboneJog) and the Trombone page (useHoldJog),
 * because both had the same hole: start and stop went out as two independent
 * requests. A short click sent them together, the stop reached the backend
 * while `jog_start` was still waiting for the motor to idle, and the jog that
 * followed was never stopped -- the carriage ran to the soft limit, or with
 * none set (the trombone range dialog lifts them) kept going.
 *
 * So a session:
 *   - sends stop only once its start has answered, so a stop can never
 *     overtake the start it belongs to;
 *   - starts only once the previous session's stop has answered, for the
 *     same reason when the direction is reversed mid-hold;
 *   - sends a keepalive while held. The backend stops a jog whose keepalives
 *     stop (`JOG_DEADMAN_S` in backend/motor/manager.py), so a release lost
 *     any other way -- a dropped request, a closed tab -- still stops it.
 */
import { motor } from '../api/motor'

/** Well inside the backend's 1 s deadman, so one late request does not stop
 *  a jog that is still held. */
const KEEPALIVE_MS = 250

export interface JogSession {
  /** Release. Resolves once the stop has been answered. */
  stop: () => Promise<void>
}

export function startJogSession(
  positive: boolean,
  speed: number | undefined,
  onStartError: (e: Error) => void,
  /** The previous session's stop, if one is still going out. */
  after: Promise<void> = Promise.resolve(),
): JogSession {
  let held = true
  const timer = setInterval(() => {
    // Silent: a missed keepalive is what the deadman is for, and a backend
    // without the route (not yet restarted) must not fill the log.
    if (held) void motor.jogKeepalive().catch(() => {})
  }, KEEPALIVE_MS)

  const started = after
    .catch(() => {})
    .then(() => motor.jogStart(positive, speed))
    .then(() => true, (e: Error) => {
      clearInterval(timer)
      held = false
      onStartError(e)
      return false
    })

  let stopping: Promise<void> | null = null
  return {
    stop: () => {
      if (stopping) return stopping
      held = false
      clearInterval(timer)
      // Sent even when the start failed: stopping an idle motor is harmless,
      // and a start that failed after moving it is not.
      stopping = started.then(() => motor.jogStop()).then(() => {})
      return stopping
    },
  }
}
