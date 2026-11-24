/**
 * The Test Sequence run, driven by the backend (backend/sequence/runner.py).
 *
 * The page plans -- each test turns its settings into points -- and sends the
 * points; the backend keys the DUT, settles, reads, judges and leaves the rig
 * idle. A tab that closes or reloads does not end the run: the page polls
 * `status` and picks it back up. Shapes mirror backend/sequence/models.py.
 */
import type { SetupId } from '../tests/engine/sweepTest'
import type { RunState, SpectrumSweepSettings } from '../types/models'
import { http } from './client'

export type SequenceTestId =
  | 'power' | 'modulated' | 'lte-cw' | 'lte-modulated' | 'ble-cw' | 'freq-accuracy' | 'lte-freq-accuracy'

/** What reads power, as PowerSource on the backend. */
export interface SequencePower {
  source: 'sensor' | 'spectrum'
  spectrum?: SpectrumSweepSettings
}

/** A step's run as its test wires it (`SweepTest.wire`): what the backend
 *  executes, without the step's identity. */
export interface WiredStep {
  /** The plan's points, in the backend's point model for this test. */
  points: Array<Record<string, unknown>>
  settle_ms: number
  power: SequencePower
  /** BLE only: a fixed tone length in seconds, or null for auto. */
  tone_s?: number | null
  /** Frequency accuracy only: the zoom stages, widest first, and each
   *  stage's tolerance in ppm (null: not judged). */
  freq?: {
    stages: Array<{ span_hz: number; rbw_hz: number; vbw_hz: number }>
    stage_limits_ppm: Array<number | null>
  }
}

export interface SequenceStepIn extends WiredStep {
  uid: string
  test: SequenceTestId
  setup: SetupId
  label: string
}

export interface SequenceIn {
  steps: SequenceStepIn[]
  bench: SetupId | null
  path_loss: { default_db: number; points: Array<{ freq_mhz: number; db: number }> }
}

export type SequenceStepVerdict = 'pass' | 'fail' | 'na' | 'error' | 'stopped' | 'not-run' | 'running'

export interface SequenceStepOutcome {
  uid: string
  verdict: SequenceStepVerdict
  passed: number
  failed: number
  measured: number
  planned: number
  errors: number
  ms: number
  message: string | null
}

export interface SequencePrompt {
  seq: number
  step_uid: string
  from_setup: SetupId | null
  to_setup: SetupId
}

export interface SequenceNote {
  seq: number
  message: string
  level: 'info' | 'warn' | 'error'
}

export interface SequenceStatus {
  state: RunState
  steps: SequenceStepOutcome[]
  current: { uid: string; index: number; done: number; total: number } | null
  prompt: SequencePrompt | null
  bench: SetupId | null
  notes: SequenceNote[]
  started_at: number | null
  finished_at: number | null
  error: string | null
  ended: 'stopped' | 'declined' | 'error' | null
}

const post = <T>(path: string, body?: unknown) => http<T>(path, {
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})

export const sequenceApi = {
  start: (seq: SequenceIn) => post<SequenceStatus>('/sequence/run', seq),
  status: () => http<SequenceStatus>('/sequence/status'),
  /** A step's rows from `since` (0 = its first point). */
  rows: (uid: string, since: number) =>
    http<Array<Record<string, unknown>>>(`/sequence/rows?step=${encodeURIComponent(uid)}&since=${since}`),
  /** Answer re-cable prompt `seq`; a stale answer is ignored. */
  recable: (seq: number, ok: boolean) => post<SequenceStatus>('/sequence/recable', { seq, ok }),
  cancel: () => post<SequenceStatus>('/sequence/cancel'),
}

/** The run holding the rig, any kind ("Test Sequence", "Load Pull"), or null. */
export const runsApi = {
  active: () => http<{ run: string | null }>('/runs/active'),
}
