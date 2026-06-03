import { http } from './client'

export interface MotorStatus {
  connected: boolean
  moving: boolean
  position: number | null
  device_index: number | null
  error: string | null
  soft_min: number | null
  soft_max: number | null
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
  jogStart: (positive: boolean, speed?: number) =>
    http<MotorStatus>('/motor/jog/start', {
      method: 'POST',
      body: JSON.stringify({ positive, speed: speed ?? null }),
    }),
  jogStop: () => http<MotorStatus>('/motor/jog/stop', { method: 'POST' }),
  setLimits: (softMin: number | null, softMax: number | null) =>
    http<MotorStatus>('/motor/limits', {
      method: 'POST',
      body: JSON.stringify({ soft_min: softMin, soft_max: softMax }),
    }),
  stop: () => http<MotorStatus>('/motor/stop', { method: 'POST' }),
}
