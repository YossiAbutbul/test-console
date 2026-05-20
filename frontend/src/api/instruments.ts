import { http } from './client'

export type InstrumentKind = 'power-sensor' | 'dc-analyzer' | 'spectrum'

interface DiscoverResponse {
  candidates: string[]
}

interface ConnectResponse {
  connected: boolean
  idn: string | null
}

export const instrumentsApi = {
  discover: (kind: InstrumentKind) =>
    http<DiscoverResponse>(`/instruments/discover/${kind}`),
  connect: (kind: InstrumentKind, address: string, channel?: number) =>
    http<ConnectResponse>(`/instruments/${kind}/connect`, {
      method: 'POST',
      body: JSON.stringify({ address, channel: channel ?? null }),
    }),
  disconnect: (kind: InstrumentKind) =>
    http<ConnectResponse>(`/instruments/${kind}/disconnect`, {
      method: 'POST',
    }),
}
