import { http } from './client'
import type {
  CommandResponse, LoraCwRequest, LoraModulatedRequest, LoraPowerRequest,
  LteCwRequest,
} from '../types/models'

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

  // --- LTE ---
  //
  // Modem power is held by the operator rather than bracketed around each
  // command: it stays up across several sends instead of paying its ~10 s boot
  // every time, and only comes down when they ask. So there is no composite
  // here — aborting a test never powers the modem down.

  /** Slow on purpose — powering the modem up is a radio boot, not a register
   *  write, and the 5 s used elsewhere times out on a cold modem. */
  lteModemOn: (timeout = 10) =>
    http<CommandResponse>('/device/lte/modem-on', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),
  // No signal, for the same reason as `stop`: this is the operator's way out.
  lteModemOff: (timeout = 5) =>
    http<CommandResponse>('/device/lte/modem-off', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),
  lteCw: (req: LteCwRequest, opts?: Cancel) =>
    http<CommandResponse>('/device/lte/cw', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, start: true, ...req }),
      signal: opts?.signal,
    }),
}
