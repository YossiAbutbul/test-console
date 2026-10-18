import { http, httpBlob } from './client'
import type { LoadPullResultRow } from '../store/loadPullPageStore'

/** Run parameters for the workbook's Run sheet — none of it is in the rows. */
export interface LoadPullExportMeta {
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

  /** Read an exported workbook back into rows. */
  importXlsx: (file: File) =>
    http<LoadPullResultRow[]>('/test/load-pull/import', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
}
