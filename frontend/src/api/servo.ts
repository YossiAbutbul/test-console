import { http } from './client'

export interface ServoStatus {
  connected: boolean
  port: string | null
  idn: string | null
  last_angle: number | null
  last_command: string | null
  last_response: string | null
  baud: number
  error: string | null
}

export type ServoTarget = 'VNA' | 'PCB'

export const servo = {
  status: () => http<ServoStatus>('/servo/status'),
  discover: () => http<{
    candidates: string[]
    details?: { port: string; idn: string | null; description?: string | null; usb?: boolean }[]
  }>('/servo/discover'),
  connect: (port: string) =>
    http<ServoStatus>('/servo/connect', {
      method: 'POST',
      body: JSON.stringify({ port }),
    }),
  disconnect: () =>
    http<ServoStatus>('/servo/disconnect', { method: 'POST' }),
  move: (angle: number) =>
    http<ServoStatus>('/servo/move', {
      method: 'POST',
      body: JSON.stringify({ angle }),
    }),
  goto: (target: ServoTarget) =>
    http<ServoStatus>('/servo/goto', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
  save: (target: ServoTarget) =>
    http<ServoStatus>('/servo/save', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
}
