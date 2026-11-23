/**
 * A stand-in for the FastAPI backend, for component tests.
 *
 * Replaces `fetch` with a router over the paths the app calls. Every call is
 * recorded (method, path, query, parsed JSON body) so a test can assert what
 * the page sent the DUT and the instruments -- the part of a run that matters
 * on the rig. Routes not given answer 404, as a backend without them would.
 */
import { vi } from 'vitest'

export interface Call {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

export type Handler = (call: Call) => unknown

const link = (connected: boolean) => ({ connected, idn: connected ? 'FAKE,1' : null })

/** A rig with the DUT linked and the sensor and DC analyzer up. */
export const DEFAULT_ROUTES: Record<string, Handler> = {
  'GET /capabilities': () => ({}),
  'GET /ble/status': () => ({ connected: true, address: 'AA:BB:CC:DD:EE:FF', name: 'DUT' }),
  'GET /chat/status': () => ({ enabled: false, quota: null }),
  'GET /instruments/status': () => ({
    power_sensor: link(true), dc_analyzer: link(true), spectrum: link(false),
    network_analyzer: link(false), signal_generator: link(false),
  }),
  'GET /servo/status': () => ({ connected: false, idn: null }),
  'GET /motor/status': () => ({ connected: false, moving: false, position: null }),
  'GET /reports': () => [],
  'POST /device/stop': () => command(),
}

export function command(ok = true, status = 0) {
  return { ok, status, tx_hex: '', rx_hex: '', reply_opcode_hex: '', reply_payload_hex: '' }
}

export function measured(power_dbm: number | null, current_a: number | null = 0.1) {
  return {
    power_dbm, current_a, voltage_v: 3.6,
    power_sensor_connected: true, dc_analyzer_connected: true, t_ms: 1, error: null,
  }
}

export function installFakeBackend(routes: Record<string, Handler> = {}) {
  const table = { ...DEFAULT_ROUTES, ...routes }
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = undefined
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const call: Call = { method, path: url.pathname, query: url.searchParams, body }
    calls.push(call)
    const handler = table[`${method} ${url.pathname}`]
    if (!handler) {
      return new Response(JSON.stringify({ detail: `no fake for ${method} ${url.pathname}` }), { status: 404 })
    }
    return new Response(JSON.stringify(handler(call) ?? null), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  return {
    calls,
    /** Calls to one route, in order. */
    to: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  }
}

/**
 * The calls that drive the rig, as a compact list for a snapshot: every POST
 * to the DUT and every measure, with what was sent. Polls are left out --
 * their number depends on timing, not on what the run does.
 */
export function rigTrace(calls: Call[]): string[] {
  return calls
    .filter((c) => c.method === 'POST'
      && (c.path.startsWith('/device/') || c.path === '/instruments/measure' || c.path === '/ble/relink'))
    .map((c) => {
      if (c.path === '/instruments/measure') return `measure ${c.query.toString()}`
      return `${c.path} ${c.body === undefined ? '' : JSON.stringify(c.body)}`.trim()
    })
}
