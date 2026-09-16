import { http } from './client'

export interface Capabilities {
  /** False in the DUT-only desktop build: no VISA, no vendor wrappers. */
  instruments: boolean
  /** Which vendor packages were looked for and not found. Empty when available. */
  missing: string[]
}

export function getCapabilities(): Promise<Capabilities> {
  // `no-store` for the same reason /chat/status uses it: when the route is
  // missing (an older backend, or a dev server without the proxy rule) the SPA
  // fallback answers 200 with index.html, and the browser then serves that
  // HTML from cache for the rest of the session.
  return http<Capabilities>('/capabilities', { cache: 'no-store' })
}
