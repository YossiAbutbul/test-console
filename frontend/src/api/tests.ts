import { http, httpBlob } from './client'
import type { ResultRow, RunStatus, StartRequest } from '../types/models'

export const tests = {
  run: (req: StartRequest) =>
    http<RunStatus>('/test/run', { method: 'POST', body: JSON.stringify(req) }),
  cancel: () => http<RunStatus>('/test/cancel', { method: 'POST' }),
  status: () => http<RunStatus>('/test/status'),
  results: () => http<ResultRow[]>('/test/results'),
  exportXlsx: () => httpBlob('/test/export'),
}
