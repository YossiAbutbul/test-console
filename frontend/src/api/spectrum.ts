import { http } from './client'

/**
 * R&S FSC3 spectrum analyzer over LAN.
 *
 * Every number is nullable: the analyzer answers 9.91e37 for a level it cannot
 * resolve, and the backend maps that to null rather than a plausible value.
 */
export interface SpectrumSettings {
  center_hz: number | null
  span_hz: number | null
  start_hz: number | null
  stop_hz: number | null
  ref_level_dbm: number | null
  ref_offset_db: number | null
  /** Read-only: the FSC3 accepts DISP:TRAC:Y:SCAL and ignores it. */
  range_db: number | null
  rbw_hz: number | null
  vbw_hz: number | null
  atten_db: number | null
  atten_auto: boolean
  sweep_time_s: number | null
  trace_mode: string
  detector: string
  continuous: boolean
  zero_span: boolean
  /** Markers on, contiguous from 1. */
  markers: number
}

export interface SpectrumState {
  connected: boolean
  idn: string | null
  address: string | null
  /** Empty until connected. */
  state: Partial<SpectrumSettings>
  restorable: boolean
  /** Commands the analyzer rejected on the last request, verbatim. */
  problems: string[]
  markers_max: number
  trace_modes: string[]
  detectors: string[]
}

export interface SpectrumMarker {
  n: number
  /** Hz in a frequency sweep, seconds in zero span. */
  x: number | null
  y: number | null
}

export interface SpectrumTrace {
  swept: boolean
  start_hz: number | null
  stop_hz: number | null
  zero_span: boolean
  values: number[]
  markers: SpectrumMarker[]
}

export type MarkerAction = 'peak' | 'next' | 'min' | 'center'

/** One panel operation; only the fields its `op` uses are read. */
export type SpectrumCommand =
  | { op: 'frequency'; center_hz?: number; span_hz?: number; start_hz?: number; stop_hz?: number }
  | { op: 'full_span' | 'trace_restart' | 'restore' | 'refresh' }
  | { op: 'ref_level'; dbm: number }
  | { op: 'ref_offset'; db: number }
  | { op: 'attenuation'; db?: number; auto?: boolean }
  | { op: 'trace_mode'; mode: string }
  | { op: 'detector'; detector: string }
  | { op: 'rbw' | 'vbw'; hz?: number; auto?: boolean }
  | { op: 'sweep_time'; seconds?: number; auto?: boolean }
  | { op: 'continuous'; on: boolean }
  | { op: 'markers'; count: number }
  | { op: 'marker_off'; n: number }
  | { op: 'marker_x'; n: number; x: number }
  | { op: 'marker_action'; n: number; action: MarkerAction }

export const TRACE_MODE_NAMES: Record<string, string> = {
  WRIT: 'Clear write', MAXH: 'Max hold', MINH: 'Min hold', AVER: 'Average', VIEW: 'View',
}
export const DETECTOR_NAMES: Record<string, string> = {
  APE: 'Auto peak', POS: 'Max peak', NEG: 'Min peak', SAMP: 'Sample', RMS: 'RMS',
}

export const spectrumApi = {
  state: () => http<SpectrumState>('/instruments/spectrum/state'),
  command: (cmd: SpectrumCommand) =>
    http<SpectrumState>('/instruments/spectrum/command', {
      method: 'POST',
      body: JSON.stringify(cmd),
    }),
  /** `single` arms one sweep first; otherwise the free-running trace is read. */
  trace: (single = false) =>
    http<SpectrumTrace>(`/instruments/spectrum/trace?single=${single}`, { method: 'POST' }),
}
