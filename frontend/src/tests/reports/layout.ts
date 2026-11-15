/**
 * A report's layout: the blocks, and what they print. Mirrors
 * backend/reports/docx_export.py's `document_order`, so the canvas numbers
 * runs exactly as the Word file will.
 */
import type { ReportBlock, ReportBlockType, ReportEntry } from '../../api/reports'

export function newBlock(type: ReportBlockType, extra: Partial<ReportBlock> = {}): ReportBlock {
  return {
    id: Math.random().toString(16).slice(2, 12),
    type, text: '', level: 1, entry_id: null, show_settings: true, show_note: true,
    image_id: null, width: 100, labels: {},
    rows: type === 'params' ? [['', '']] : [],
    x: 0, ys: [], kind: 'line',
    ...extra,
  }
}

/** Every run the layout prints, in print order, with its number: an entry
 *  block's run where it stands, an "All runs" block's (the runs placed
 *  nowhere else) where that stands. */
export function documentOrder(blocks: ReportBlock[], entries: ReportEntry[]): Map<string, number> {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const placed = new Set(blocks.filter((b) => b.type === 'entry').map((b) => b.entry_id))
  const out = new Map<string, number>()
  for (const b of blocks) {
    if (b.type === 'entry' && b.entry_id && byId.has(b.entry_id) && !out.has(b.entry_id)) {
      out.set(b.entry_id, out.size + 1)
    } else if (b.type === 'all_entries') {
      for (const e of entries) if (!placed.has(e.id) && !out.has(e.id)) out.set(e.id, out.size + 1)
    }
  }
  return out
}

/** The runs an "All runs" block prints: those no entry block places. */
export function unplaced(blocks: ReportBlock[], entries: ReportEntry[]): ReportEntry[] {
  const placed = new Set(blocks.filter((b) => b.type === 'entry').map((b) => b.entry_id))
  return entries.filter((e) => !placed.has(e.id))
}

/** `blocks` with the one at `from` moved to `to`. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list
  const out = list.slice()
  const [it] = out.splice(from, 1)
  out.splice(to, 0, it)
  return out
}
