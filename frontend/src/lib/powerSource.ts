/**
 * What reads TX power on a test: the USB power sensor, or the spectrum
 * analyzer at settings the test keeps for itself.
 *
 * Mode Sweep had this first (PowerSweepPage); every page that measures power
 * now offers it, each with its own analyzer settings, persisted with the
 * page. The analyzer is centred on each step's own frequency, so there is no
 * centre here, and its reference offset is zeroed by the backend: the path
 * loss is added in software, as it is to sensor readings.
 */
import type { InstrumentId } from '../context/InstrumentsContext'
import type { PowerSource, SpectrumSweepSettings } from '../types/models'

export type { PowerSource }

/** As typed: kHz fields stay strings so a half-typed value survives. */
export interface PowerSourceState {
  source: PowerSource
  spanKhz: string
  rbwKhz: string
  vbwKhz: string
  detector: string
}

/** Mode Sweep's defaults, and the backend's (SpectrumSettings). */
export const POWER_SOURCE_DEFAULT: PowerSourceState = {
  source: 'sensor', spanKhz: '1000', rbwKhz: '100', vbwKhz: '300', detector: 'POS',
}

/** The FSC3's detectors. Must match SPECTRUM_DETECTORS in
 *  backend/sweep/models.py, which refuses any other. */
export const SPECTRUM_DETECTORS = ['APE', 'POS', 'NEG', 'SAMP', 'RMS'] as const

/** A typed kHz field as Hz, or null when it is not a positive number. */
export function khzToHz(v: string): number | null {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}

/** A saved state, filled in with the defaults for anything it predates. */
export function powerSourceOf(saved?: Partial<PowerSourceState> | null): PowerSourceState {
  return { ...POWER_SOURCE_DEFAULT, ...(saved ?? {}) }
}

/** The analyzer settings to send, or null when one of them is not a number. */
export function spectrumSettingsOf(p: PowerSourceState): SpectrumSweepSettings | null {
  const span = khzToHz(p.spanKhz)
  const rbw = khzToHz(p.rbwKhz)
  const vbw = khzToHz(p.vbwKhz)
  if (span == null || rbw == null || vbw == null) return null
  return { span_hz: span, rbw_hz: rbw, vbw_hz: vbw, detector: p.detector }
}

/** Whether a run can start: always with the sensor; with the analyzer only
 *  on settings it would accept. */
export function powerSourceValid(p: PowerSourceState): boolean {
  return p.source === 'sensor' || spectrumSettingsOf(p) != null
}

/** The instrument that reads power, for preflight and auto-connect. */
export function powerInstrument(p: PowerSourceState | PowerSource): InstrumentId {
  const source = typeof p === 'string' ? p : p.source
  return source === 'spectrum' ? 'spectrum' : 'power-sensor'
}

/** What `instrumentsApi.measure` sends for this source: nothing extra for
 *  the sensor, the analyzer's settings otherwise. */
export function measureSpectrumOf(p: PowerSourceState | undefined): SpectrumSweepSettings | undefined {
  if (!p || p.source !== 'spectrum') return undefined
  return spectrumSettingsOf(p) ?? undefined
}
