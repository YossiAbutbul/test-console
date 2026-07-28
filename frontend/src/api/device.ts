import { http } from './client'
import type { CommandResponse, LoraCwRequest, LoraModulatedRequest, LoraPowerRequest } from '../types/models'

/** Passed by sweeps so Stop cancels the request in flight, not just after it. */
type Cancel = { signal?: AbortSignal }

export const device = {
  loraCw: (req: LoraCwRequest, opts?: Cancel) =>
    http<CommandResponse>('/device/lora-cw', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
      signal: opts?.signal,
    }),
  loraPower: (req: LoraPowerRequest, opts?: Cancel) =>
    http<CommandResponse>('/device/lora-power', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
      signal: opts?.signal,
    }),
  loraModulated: (req: LoraModulatedRequest, opts?: Cancel) =>
    http<CommandResponse>('/device/lora-modulated', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, ...req }),
      signal: opts?.signal,
    }),
  // Deliberately takes no signal: stop is what runs *because* of an abort, so
  // cancelling it with the same signal would leave the DUT transmitting.
  stop: (timeout = 5) =>
    http<CommandResponse>('/device/stop', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),
}
