import { http } from './client'
import type { ConnectionStatus, ScannedDevice } from '../types/models'

export interface ScanStreamHandlers {
  onDevice: (d: ScannedDevice) => void
  onDone?: (count: number) => void
  onError?: (msg: string) => void
}

export function scanStream(duration: number, h: ScanStreamHandlers): () => void {
  const es = new EventSource(`/ble/scan/stream?duration=${duration}`)
  es.addEventListener('device', (e) => {
    try {
      h.onDevice(JSON.parse((e as MessageEvent).data))
    } catch {
      /* ignore */
    }
  })
  es.addEventListener('done', (e) => {
    try {
      const { count } = JSON.parse((e as MessageEvent).data)
      h.onDone?.(count)
    } catch {
      h.onDone?.(0)
    }
    es.close()
  })
  es.addEventListener('error', (e) => {
    const data = (e as MessageEvent).data
    if (data) {
      try {
        h.onError?.(JSON.parse(data).detail ?? 'stream error')
      } catch {
        h.onError?.('stream error')
      }
    } else {
      // network/transport error — readyState may be CLOSED
      if (es.readyState === EventSource.CLOSED) h.onError?.('connection closed')
    }
    es.close()
  })
  return () => es.close()
}

export const ble = {
  scan: (duration: number) =>
    http<ScannedDevice[]>(`/ble/scan?duration=${duration}`),
  connect: (address: string, timeout = 15) =>
    http<ConnectionStatus>('/ble/connect', {
      method: 'POST',
      body: JSON.stringify({ address, timeout }),
    }),
  disconnect: () => http<ConnectionStatus>('/ble/disconnect', { method: 'POST' }),
  status: () => http<ConnectionStatus>('/ble/status'),
}
