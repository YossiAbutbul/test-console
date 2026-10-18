import { http, httpBlob } from './client'
import type { ResultRow, RunStatus, StartRequest } from '../types/models'

export const tests = {
  run: (req: StartRequest) =>
    http<RunStatus>('/test/run', { method: 'POST', body: JSON.stringify(req) }),
  cancel: () => http<RunStatus>('/test/cancel', { method: 'POST' }),
  status: () => http<RunStatus>('/test/status'),
  results: () => http<ResultRow[]>('/test/results'),
  /** Discard the finished run's rows. 409 while a sweep is still running. */
  clear: () => http<RunStatus>('/test/clear', { method: 'POST' }),
  /**
   * Render the finished run to a workbook. `operator` and `notes` are optional
   * free text for its Run sheet; the backend names the file (Content-Disposition).
   */
  exportXlsx: (opts: { operator?: string; notes?: string } = {}) => {
    const q = new URLSearchParams()
    if (opts.operator) q.set('operator', opts.operator)
    if (opts.notes) q.set('notes', opts.notes)
    const qs = q.toString()
    return httpBlob(qs ? `/test/export?${qs}` : '/test/export')
  },
  /**
   * Read a previously exported workbook back into rows.
   *
   * Sent as the raw body rather than multipart — the backend takes the bytes
   * directly, which saves it a `python-multipart` dependency. The rows come
   * back to the caller; the backend's own run state is untouched.
   */
  importXlsx: (file: File) =>
    http<ResultRow[]>('/test/import', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  /**
   * Re-export an imported workbook in the current layout.
   *
   * The file goes back up rather than the rows: its Run sheet holds the path
   * loss and settle time the rows were measured with, and only the file has it.
   */
  reexportXlsx: (file: File) =>
    httpBlob('/test/reexport', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
}
