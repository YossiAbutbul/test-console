import { http } from './client'

/** One zoom stage: the analyzer re-centres on the last peak, then sweeps this. */
export interface FreqStage {
  span_hz: number
  rbw_hz: number
  vbw_hz: number
}

/** One carrier to measure: the CW page's command (frequency, power, PA mode). */
export interface FreqPoint {
  freq_hz: number
  power_dbm: number
  pa_mode: number
}

export interface FreqAccuracyStart {
  /** One from the Manual tab, the whole plan from the Automation tab. */
  points: FreqPoint[]
  stages: FreqStage[]
  /** Carrier keyed this long before each point's first sweep; 400 ms floor. */
  settle_ms: number
  /** Omit for each point's TX power plus headroom (backend/freqacc/zoom.py). */
  ref_level_dbm?: number | null
}

export interface FreqStageResult extends FreqStage {
  n: number
  center_hz: number
  marker_hz: number
  level_dbm: number | null
  shift_hz: number
  at_edge: boolean
}

export interface FreqResult {
  nominal_hz: number
  measured_hz: number
  error_hz: number
  error_ppm: number
  ref_level_dbm: number
}

export interface FreqPointStatus extends FreqPoint {
  state: 'pending' | 'running' | 'done' | 'error'
  stages: FreqStageResult[]
  result: FreqResult | null
  warnings: string[]
  error: string | null
}

export interface FreqAccuracyStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error'
  phase: string
  stage_count: number
  /** The point being measured, -1 when none is. */
  current: number
  points: FreqPointStatus[]
  warnings: string[]
  error: string | null
}

/** backend/api/freq_accuracy.py */
export const freqAccuracy = {
  start: (req: FreqAccuracyStart) =>
    http<FreqAccuracyStatus>('/test/frequency-accuracy/start', { method: 'POST', body: JSON.stringify(req) }),
  status: () => http<FreqAccuracyStatus>('/test/frequency-accuracy/status'),
  cancel: () => http<FreqAccuracyStatus>('/test/frequency-accuracy/cancel', { method: 'POST' }),
}
