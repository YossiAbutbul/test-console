import { http } from './client'

export interface MotorStatus {
  connected: boolean
  moving: boolean
  position: number | null
  device_index: number | null
  error: string | null
  soft_min: number
  soft_max: number
}

export const motor = {
  status: () => http<MotorStatus>('/motor/status'),
  discover: () => http<{ candidates: string[] }>('/motor/discover'),
  connect: (deviceIndex = 0) =>
    http<MotorStatus>('/motor/connect', {
      method: 'POST',
      body: JSON.stringify({ device_index: deviceIndex }),
    }),
  disconnect: () =>
    http<MotorStatus>('/motor/disconnect', { method: 'POST' }),
  move: (position: number, absolute = true) =>
    http<MotorStatus>('/motor/move', {
      method: 'POST',
      body: JSON.stringify({ position, absolute }),
    }),
  home: (direction: 'positive' | 'negative') =>
    http<MotorStatus>('/motor/home', {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),
  stop: () => http<MotorStatus>('/motor/stop', { method: 'POST' }),
}
