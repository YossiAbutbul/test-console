import { http } from './client'
import type { CommandResponse, LoraCwRequest, LoraModulatedRequest, LoraPowerRequest } from '../types/models'

export const device = {
  loraCw: (req: LoraCwRequest) =>
    http<CommandResponse>('/device/lora-cw', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
    }),
  loraPower: (req: LoraPowerRequest) =>
    http<CommandResponse>('/device/lora-power', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
    }),
  loraModulated: (req: LoraModulatedRequest) =>
    http<CommandResponse>('/device/lora-modulated', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
    }),
  stop: (timeout = 5) =>
    http<CommandResponse>('/device/stop', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),
}
