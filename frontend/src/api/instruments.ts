import { http } from './client'

export type InstrumentKind = 'power-sensor' | 'dc-analyzer' | 'spectrum'

interface DiscoverResponse {
  candidates: string[]
}

interface ConnectResponse {
  connected: boolean
  idn: string | null
}

export interface MeasureResponse {
  power_dbm: number | null
  current_a: number | null
  voltage_v: number | null
  power_sensor_connected: boolean
  dc_analyzer_connected: boolean
  t_ms: number
  error: string | null
}

export interface StatusResponse {
  power_sensor: { connected: boolean; idn: string | null }
  dc_analyzer: { connected: boolean; idn: string | null }
  spectrum: { connected: boolean; idn: string | null }
}

export const instrumentsApi = {
  status: () => http<StatusResponse>('/instruments/status'),
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
  measure: (freqHz?: number) =>
    http<MeasureResponse>(
      `/instruments/measure${freqHz ? `?freq_hz=${Math.round(freqHz)}` : ''}`,
      { method: 'POST' },
    ),
}
