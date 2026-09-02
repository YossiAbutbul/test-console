import { http } from './client'
import type {
  CommandResponse, LoraCwRequest, LoraModulatedRequest, LoraPowerRequest,
  AppModesResponse, ChannelOptionsResponse, LteCwRequest, LteModulatedRequest,
  MeterInfoResponse, SaveResetResponse, SetAppModeResponse, SetChannelsResponse,
} from '../types/models'

/** Passed by sweeps so Stop cancels the request in flight, not just after it. */
type Cancel = { signal?: AbortSignal }

export const device = {
  /** Read-only identity read; nine queries, so it is slower than one command. */
  info: (opts?: Cancel) =>
    http<MeterInfoResponse>('/device/info', { signal: opts?.signal }),

  /** The mode list. Fixed for a given backend, so it is cached indefinitely. */
  appModes: () => http<AppModesResponse>('/device/app-modes'),

  /** Writes the mode and reboots the unit — see SetAppModeResponse. */
  setAppMode: (mode: number, timeout = 5) =>
    http<SetAppModeResponse>('/device/app-mode', {
      method: 'POST',
      body: JSON.stringify({ mode, timeout }),
    }),

  /** Primary/secondary channel options. Fixed per backend, cached like modes. */
  channelOptions: () => http<ChannelOptionsResponse>('/device/channel-options'),

  /** Both channels go together — the command takes the pair, not one of them. */
  setChannels: (primary: number, secondary: number, timeout = 5) =>
    http<SetChannelsResponse>('/device/channels', {
      method: 'POST',
      body: JSON.stringify({ primary, secondary, timeout }),
    }),

  /** Persists staged settings and reboots the unit — the link drops after. */
  saveReset: (timeout = 5) =>
    http<SaveResetResponse>('/device/save-reset', {
      method: 'POST',
      body: JSON.stringify({ timeout }),
    }),

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
  lteModulated: (req: LteModulatedRequest, opts?: Cancel) =>
    http<CommandResponse>('/device/lte/modulated', {
      method: 'POST',
      body: JSON.stringify({ timeout: 5, start: true, ...req }),
      signal: opts?.signal,
    }),
}
