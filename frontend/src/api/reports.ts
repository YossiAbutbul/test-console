import { http, httpBlob } from './client'

/** backend/reports/models.py */
export type ReportCell = string | number | boolean | null

export interface ReportDut {
  mac?: string | null
  name?: string | null
  nickname?: string | null
}

/** What a test page hands over: its results table as it exports it (the
 *  page's CSV_HEADER / toCsvBody), with the run's settings. */
export interface ReportEntryDraft {
  /** The test, as a slug ("tx-cw-automation"). */
  test: string
  /** Heading in the report ("LoRa CW automation"). */
  title: string
  settings?: Array<[string, string]>
  columns: string[]
  rows: ReportCell[][]
}

export interface ReportEntryIn extends ReportEntryDraft {
  note?: string
  operator?: string
  dut: ReportDut
}

export interface ReportEntrySummary {
  points: number
  passed: number
  failed: number
}

export interface ReportEntry extends ReportEntryIn {
  id: string
  added_at: string
  summary: ReportEntrySummary
  settings: Array<[string, string]>
  note: string
  operator: string
}

export type ReportBlockType =
  | 'cover' | 'heading' | 'text' | 'summary' | 'entry' | 'all_entries' | 'page_break' | 'image'
  | 'params' | 'units' | 'chart'

/** One component of a report's layout, in document order. */
export interface ReportBlock {
  id: string
  type: ReportBlockType
  text: string
  /** Heading level: 1 section, 2 sub-section. */
  level: number
  entry_id?: string | null
  show_settings: boolean
  show_note: boolean
  /** image: the picture, its share of the text width (%), `text` its caption. */
  image_id?: string | null
  width: number
  /** The block's own words for its fixed labels ("subtitle", "title",
   *  "settings", ...); a key not given prints the default. */
  labels: Record<string, string>
  /** params: the table's rows, [parameter, value]. */
  rows: string[][]
  /** chart: the run's column across (`x`), those plotted (`ys`), and how;
   *  `text` is its title, `image_id` the picture Word prints. */
  x: number
  ys: number[]
  kind: 'line' | 'bar' | 'scatter'
}

/** How every report looks beyond its layout: the logo. */
export interface ReportStyle {
  logo_image_id: string | null
}

export interface ReportProduct {
  id: string
  name: string
  notes: string
  created_at: string
  updated_at: string
  entries: ReportEntry[]
  blocks: ReportBlock[]
}

export interface ReportTemplate {
  id: string
  name: string
  created_at: string
  blocks: ReportBlock[]
}

export interface ReportListItem {
  id: string
  name: string
  notes: string
  created_at: string
  updated_at: string
  entry_count: number
  units: number
}

/** backend/reports/sheets.py: the report as one sheet per test type, the
 *  same tables the page shows and the Excel export writes. */
export interface ReportSheet {
  /** The test slug this sheet holds. */
  test: string
  /** The tab's name, as in the workbook. */
  name: string
  /** The runs' own title ("LoRa CW automation"). */
  title: string
  entry_ids: string[]
  columns: string[]
  rows: ReportCell[][]
}

export interface ReportSheets {
  product: string
  notes: string
  facts: Array<[string, string]>
  summary_columns: string[]
  summary_rows: ReportCell[][]
  sheets: ReportSheet[]
}

/** "Fail" if any point failed, "Pass" if any was judged and none failed. */
export function entryResult(s: ReportEntrySummary): 'Pass' | 'Fail' | null {
  return s.failed ? 'Fail' : s.passed ? 'Pass' : null
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
})

/** backend/api/reports.py */
export const reportsApi = {
  list: () => http<ReportListItem[]>('/reports'),
  create: (name: string, templateId?: string | null) =>
    http<ReportProduct>('/reports', json({ name, notes: '', template_id: templateId ?? null })),
  get: (id: string) => http<ReportProduct>(`/reports/${id}`),
  update: (id: string, patch: { name?: string; notes?: string }) =>
    http<ReportProduct>(`/reports/${id}`, json(patch, 'PATCH')),
  remove: (id: string) => http<{ ok: boolean }>(`/reports/${id}`, { method: 'DELETE' }),
  addEntry: (id: string, entry: ReportEntryIn) => http<ReportEntry>(`/reports/${id}/entries`, json(entry)),
  removeEntry: (id: string, eid: string) =>
    http<ReportProduct>(`/reports/${id}/entries/${eid}`, { method: 'DELETE' }),
  reorder: (id: string, ids: string[]) => http<ReportProduct>(`/reports/${id}/entries/order`, json({ ids }, 'PUT')),
  sheets: (id: string) => http<ReportSheets>(`/reports/${id}/sheets`),
  exportXlsx: (id: string) => httpBlob(`/reports/${id}/export.xlsx`),
  setBlocks: (id: string, blocks: ReportBlock[]) =>
    http<ReportProduct>(`/reports/${id}/blocks`, json({ blocks }, 'PUT')),
  applyTemplate: (id: string, templateId: string) =>
    http<ReportProduct>(`/reports/${id}/apply-template`, json({ template_id: templateId })),
  templates: () => http<ReportTemplate[]>('/reports/templates'),
  saveTemplate: (name: string, blocks: ReportBlock[]) =>
    http<ReportTemplate>('/reports/templates', json({ name, blocks })),
  removeTemplate: (id: string) => http<{ ok: boolean }>(`/reports/templates/${id}`, { method: 'DELETE' }),
  /** Raw body, as the workbook import: no multipart dependency. */
  uploadImage: (img: Blob) =>
    http<{ id: string }>('/reports/images', { method: 'POST', body: img, headers: { 'Content-Type': img.type } }),
  imageUrl: (id: string) => `/reports/images/${id}`,
  style: () => http<ReportStyle>('/reports/style'),
  setStyle: (style: ReportStyle) => http<ReportStyle>('/reports/style', json(style, 'PUT')),
}
