import { http } from './client'

/**
 * Keysight N6705B DC power analyzer, one channel at a time — the channel the
 * analyzer was connected with, which is also the one every test measures.
 *
 * Every reading is nullable: the backend queries each on its own so one
 * refused query costs that field alone, and a missing reading has to stay
 * visibly missing rather than becoming a plausible zero.
 */
export interface DcAnalyzerState {
  connected: boolean
  idn: string | null
  channel: number
  /** The module in that slot, e.g. "N6781A". */
  module: string | null
  output_on: boolean | null
  /** Setpoint as seen at the DUT (the backend undoes the rig's x2 scaling). */
  voltage_set_v: number | null
  current_limit_a: number | null
  voltage_v: number | null
  current_a: number | null
  power_w: number | null
  voltage_range_auto: boolean | null
  current_range_auto: boolean | null
  /** The instrument's own error queue, when it held something. */
  error: string | null
}

/** Any subset. What is left out is left alone on the instrument. */
export interface DcAnalyzerSettings {
  voltage_v?: number
  current_limit_a?: number
  output_on?: boolean
}

/** Typo guards, mirroring MAX_VOLTAGE_V / MAX_CURRENT_LIMIT_A in
 *  backend/api/instruments/dc_analyzer.py. The module has tighter limits of
 *  its own and reports them through its error queue. */
export const MAX_VOLTAGE_V = 60
export const MAX_CURRENT_LIMIT_A = 10

export const dcAnalyzerApi = {
  state: () => http<DcAnalyzerState>('/instruments/dc-analyzer/state'),
  /**
   * Apply settings and get back what the instrument then reports.
   *
   * Sending the voltage and limit alongside `output_on: true` is the safe way
   * to power up at a new setting: the backend orders one request so the values
   * land first and the output is switched on last.
   */
  apply: (settings: DcAnalyzerSettings) =>
    http<DcAnalyzerState>('/instruments/dc-analyzer/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
}
