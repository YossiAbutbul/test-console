import { http } from './client'
import type { CommandResponse, LoraCwRequest } from '../types/models'

export const device = {
  loraCw: (req: LoraCwRequest) =>
    http<CommandResponse>('/device/lora-cw', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
    }),
  stop: (timeout = 5) =>
    http<CommandResponse>('/device/stop', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),
}
