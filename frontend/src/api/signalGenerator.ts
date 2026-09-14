import { http } from './client'

/**
 * R&S SML03 signal generator, over RS-232.
 *
 * Every reading is nullable: the backend queries the three settings
 * independently so one unanswered query costs that field alone, and a missing
 * reading has to stay visibly missing rather than becoming a plausible zero.
 */
export interface SignalGeneratorState {
  connected: boolean
  idn: string | null
  port: string | null
  freq_hz: number | null
  level_dbm: number | null
  rf_on: boolean | null
  /** The instrument's own error queue, when it held something. */
  error: string | null
}

/** Any subset. What is left out is left alone on the instrument. */
export interface SignalGeneratorSettings {
  freq_hz?: number
  level_dbm?: number
  rf_on?: boolean
}

/**
 * The rate the instrument is set to under Utilities - System - RS232. Both ends
 * must agree, and it is the generator's menu that decides — so this is a
 * setting to match, not a default to assume.
 */
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]

/** What the manual's own RS-232 example uses. */
export const DEFAULT_BAUD = 9600

export const signalGeneratorApi = {
  connect: (address: string, baud = DEFAULT_BAUD) =>
    http<{ connected: boolean; idn: string | null }>(
      '/instruments/signal-generator/connect',
      { method: 'POST', body: JSON.stringify({ address, baud }) },
    ),
  disconnect: () =>
    http<{ connected: boolean; idn: string | null }>(
      '/instruments/signal-generator/disconnect',
      { method: 'POST' },
    ),
  state: () => http<SignalGeneratorState>('/instruments/signal-generator/state'),
  /**
   * Apply settings and get back what the instrument then reports.
   *
   * Sending the frequency and level alongside `rf_on: true` is the safe way to
   * key a new setting: the backend orders one request so the settings land
   * first and the output is switched on last.
   */
  apply: (settings: SignalGeneratorSettings) =>
    http<SignalGeneratorState>('/instruments/signal-generator/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
}
