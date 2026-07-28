/**
 * Instrument connect failures, translated for the operator.
 *
 * The backend reports failures as driver exception text — "VI_ERROR_RSRC_NFOUND",
 * "pyvisa not installed", a bare 409. Showing that raw tells a person standing
 * at the bench nothing about what to do next. Each failure is classified into a
 * kind with a short title and a concrete next step; the original text is kept
 * on `raw` for the log and the details line.
 */
import { ApiError } from '../api/client'

export type ConnectErrorKind =
  | 'timeout'
  | 'no-address'
  | 'not-found'
  | 'in-use'
  | 'driver-missing'
  | 'backend-down'
  | 'unsupported'
  | 'rejected'
  | 'unknown'

export interface ConnectFailure {
  kind: ConnectErrorKind
  /** Short label — fits on one line next to the instrument name. */
  title: string
  /** The action that most often fixes it. */
  hint: string
  /** Original driver/HTTP text, for the log and the expandable detail. */
  raw: string
}

/** Marker thrown by the connect timeout race. */
export class ConnectTimeout extends Error {
  seconds: number
  constructor(seconds: number) {
    super(`no response after ${seconds}s`)
    this.name = 'ConnectTimeout'
    this.seconds = seconds
  }
}

const COPY: Record<ConnectErrorKind, { title: string; hint: string }> = {
  timeout: {
    title: 'No response',
    hint: 'Check the instrument is powered on and its USB/LAN cable is seated, then retry.',
  },
  'no-address': {
    title: 'No address selected',
    hint: 'Pick a resource for this instrument in the Instruments panel first.',
  },
  'not-found': {
    title: 'Not found at that address',
    hint: 'The address is no longer present. Re-scan and pick it again.',
  },
  'in-use': {
    title: 'Already in use',
    hint: 'Another program or session holds this instrument. Close it, or disconnect and retry.',
  },
  'driver-missing': {
    title: 'Driver not installed',
    hint: 'This PC is missing the vendor library for the instrument. Install it and restart the backend.',
  },
  'backend-down': {
    title: 'Backend unreachable',
    hint: 'The test-console backend is not responding. Restart it and retry.',
  },
  unsupported: {
    title: 'Not supported yet',
    hint: 'This instrument is a placeholder — it has no driver wired up.',
  },
  rejected: {
    title: 'Rejected by the instrument',
    hint: 'The instrument refused the connection settings. Check the address and channel.',
  },
  unknown: {
    title: 'Connection failed',
    hint: 'See the details below, and the log for the full message.',
  },
}

function classify(error: unknown, address: string): ConnectErrorKind {
  if (error instanceof ConnectTimeout) return 'timeout'

  const raw = error instanceof Error ? error.message : String(error)
  const text = raw.toLowerCase()

  if (error instanceof ApiError) {
    // The backend's own mapping is the most reliable signal we have.
    if (error.status === 501) return 'driver-missing'
    if (error.status === 409) return 'in-use'
    if (error.status === 404) return 'not-found'
    if (error.status === 504) return 'timeout'
    if (error.status === 400) return 'rejected'
    // 502/503 come from the Vite proxy when the backend process is not
    // listening — the instrument is fine, the server isn't running.
    if (error.status === 502 || error.status === 503) return 'backend-down'
  }
  // fetch() rejects with a TypeError when it cannot reach the server at all.
  if (error instanceof TypeError || text.includes('failed to fetch')) return 'backend-down'
  if (text.includes('not wired')) return 'unsupported'
  if (text.includes('not installed')) return 'driver-missing'
  if (text.includes('rsrc_nfound') || text.includes('not found')) return 'not-found'
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if (!address.trim()) return 'no-address'
  return 'unknown'
}

/**
 * Turn a thrown connect error into something worth showing.
 *
 * @param address The address that was attempted — an empty one is itself the
 *                most likely explanation, so it is checked last as a fallback.
 */
export function describeConnectError(error: unknown, address = ''): ConnectFailure {
  const kind = classify(error, address)
  const raw = error instanceof Error ? error.message : String(error)
  return { kind, ...COPY[kind], raw }
}

/** One-line form for the log, where there is no room for the hint. */
export function formatFailure(failure: ConnectFailure): string {
  return `${failure.title} (${failure.raw})`
}
