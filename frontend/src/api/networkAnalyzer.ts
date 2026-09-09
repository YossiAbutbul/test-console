import { http } from './client'

export interface VnaConfig {
  connected: boolean
  idn: string | null
  start_hz: number | null
  stop_hz: number | null
  points: number | null
  if_bandwidth_hz: number | null
  source_power_dbm: number | null
  markers: number[]
}

export interface VnaMarkerResult {
  index: number
  requested_hz: number
  freq_hz: number
  s11_real: number
  s11_imag: number
  s11_mag_db: number
  r_ohm: number
  x_ohm: number
}

export interface VnaMeasureResponse {
  connected: boolean
  start_hz: number | null
  stop_hz: number | null
  points: number | null
  markers: VnaMarkerResult[]
}

/** One S21 marker. Transmission, so magnitude and phase rather than the
 *  impedance an S11 marker carries. Mirrors `S21MarkerResult` in
 *  backend/api/instruments/network_analyzer.py. */
export interface VnaS21MarkerResult {
  index: number
  requested_hz: number
  freq_hz: number
  mag_db: number
  phase_deg: number
  real: number
  imag: number
}

export interface VnaMeasureS21Response {
  connected: boolean
  start_hz: number | null
  stop_hz: number | null
  points: number | null
  markers: VnaS21MarkerResult[]
}

export const vna = {
  discover: () => http<{ candidates: string[] }>('/instruments/discover/network-analyzer'),
  connect: (address: string) =>
    http<{ connected: boolean; idn: string | null }>('/instruments/network-analyzer/connect', {
      method: 'POST',
      body: JSON.stringify({ address }),
    }),
  disconnect: () =>
    http<{ connected: boolean; idn: string | null }>('/instruments/network-analyzer/disconnect', {
      method: 'POST',
    }),
  config: () => http<VnaConfig>('/instruments/network-analyzer/config'),
  setFreq: (start_hz: number, stop_hz: number, points?: number) =>
    http<VnaConfig>('/instruments/network-analyzer/freq', {
      method: 'POST',
      body: JSON.stringify({ start_hz, stop_hz, points: points ?? null }),
    }),
  setMarkers: (markers: number[]) =>
    http<VnaConfig>('/instruments/network-analyzer/markers', {
      method: 'POST',
      body: JSON.stringify({ markers }),
    }),
  measure: (markers?: number[]) =>
    http<VnaMeasureResponse>('/instruments/network-analyzer/measure', {
      method: 'POST',
      body: JSON.stringify(markers ? { markers } : {}),
    }),
  measureS21: (markers?: number[]) =>
    http<VnaMeasureS21Response>('/instruments/network-analyzer/measure-s21', {
      method: 'POST',
      body: JSON.stringify(markers ? { markers } : {}),
    }),
}
