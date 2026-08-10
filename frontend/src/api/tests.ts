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
  exportXlsx: () => httpBlob('/test/export'),
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
}
