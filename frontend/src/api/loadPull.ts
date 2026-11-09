import type { PowerSource, SpectrumSweepSettings } from '../types/models'
import { http, httpBlob } from './client'
import type { LoadPullResultRow } from '../store/loadPullPageStore'

/** One plan point, as backend/loadpull/models.py PlanPoint has it. */
export interface LoadPullPlanPoint {
  pos: number
  freq_mhz: number
  earfcn?: number | null
  power_dbm: number
  att_db: number | null
}

/** What starts a run (LoadPullRunConfig on the backend). */
export interface LoadPullRunConfig {
  radio: 'LoRa' | 'LTE'
  points: LoadPullPlanPoint[]
  /** Points already measured; Continue starts the run here. */
  start_index: number
  settle_ms: number
  pa_mode?: number
  /** Path loss for every frequency in the plan, resolved here. */
  path_loss: Array<{ freq_mhz: number; db: number; calibrated: boolean }>
  /** What reads TX power: the sensor (default) or the spectrum analyzer at
   *  `spectrum`, centred on each point's frequency. */
  power_source?: PowerSource
  spectrum?: SpectrumSweepSettings
  vna_half_span_frac: number
  plan_key: string
}

export interface LoadPullAttPrompt {
  seq: number
  db: number
  /** 0-based attenuator step, of `cycles`. */
  cycle: number
  cycles: number
  /** The plan's later settings, in order -- the ones a jump can go to. */
  upcoming?: number[]
}

/** The backend run as it stands (LoadPullStatus). */
export interface LoadPullRunStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error'
  radio: 'LoRa' | 'LTE' | null
  completed: number
  total: number
  start_index: number
  rows: number
  /** Points passed over by jumping the attenuator ahead; in `completed`. */
  skipped?: number
  errors: number
  phase: 'modem' | 'moving' | 'vna' | 'measuring' | 'attenuator' | null
  att_prompt: LoadPullAttPrompt | null
  started_at: number | null
  finished_at: number | null
  error: string | null
  plan_key: string | null
}

/** Run parameters for the workbook's Run sheet — none of it is in the rows. */
export interface LoadPullExportMeta {
  /** Which radio keyed the DUT: 'LoRa' or 'LTE'. Absent from older clients. */
  radio?: string
  /** What read power: 'sensor' or 'spectrum'. */
  power_source?: PowerSource
  freq_spec?: string
  power_spec?: string
  settle_ms?: number
  pa_mode?: number
  delta_x_mm?: number
  zero_pulses?: number | null
  end_pulses?: number | null
  path_loss_default_db?: number
  path_loss_points?: Array<{ freq_mhz: number; db: number; calibrated: boolean }>
  dut_mac?: string | null
  /** Epoch seconds, when the page knows them; the Run sheet says "—" otherwise. */
  started_at?: number | null
  finished_at?: number | null
  /** Optional free text for the Run sheet. */
  operator?: string
  notes?: string
  // The rig (instrument IDNs, VISA address, DC channel, DUT name) is filled in
  // by the backend from the sessions it holds, so it is not sent from here.
}

export const loadPullApi = {
  /**
   * Render the results to a workbook.
   *
   * The rows go up with the request: this test's loop runs in the browser, so
   * the backend has no copy of them — it is being used for openpyxl, not for
   * state it holds.
   */
  exportXlsx: (rows: LoadPullResultRow[], meta: LoadPullExportMeta) =>
    httpBlob('/test/load-pull/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, meta }),
    }),

  /**
   * The run. It is driven by the backend, so a tab that crashes or reloads
   * does not take it down: the page starts it, polls it, and answers its
   * attenuator prompts.
   */
  start: (config: LoadPullRunConfig) =>
    http<LoadPullRunStatus>('/test/load-pull/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
  status: () => http<LoadPullRunStatus>('/test/load-pull/status'),
  /** This run's rows from `since` (0 = the first point it measured). */
  rows: (since: number) => http<LoadPullResultRow[]>(`/test/load-pull/rows?since=${since}`),
  /** `attDb`: the setting dialled in when it is not the one asked for. */
  answerPrompt: (seq: number, proceed: boolean, attDb: number | null = null) =>
    http<LoadPullRunStatus>('/test/load-pull/att', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq, proceed, att_db: attDb }),
    }),
  cancel: () => http<LoadPullRunStatus>('/test/load-pull/cancel', { method: 'POST' }),

  /** Read an exported workbook back into rows. */
  importXlsx: (file: File) =>
    http<LoadPullResultRow[]>('/test/load-pull/import', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
}
