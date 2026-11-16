/**
 * Product reports: the report as a document you build.
 *
 * The page is the report itself -- a sheet of paper drawn the way the Word
 * file prints it (Paper.tsx) -- made of blocks: a cover, headings and text of
 * your own, the summary table, single test runs, "All runs", page breaks.
 * Click text to edit it in place; drag a block by its handle to move it;
 * the + between blocks, or Add, inserts one. A layout can be saved as a
 * template and used to start, or restyle, another product's report.
 *
 * Saving is automatic and quiet: each change is sent a moment after it is
 * made, and the toolbar says when it has landed. Structural changes (add,
 * move, remove, a template applied) can be undone; typing has the text
 * field's own undo.
 *
 * Runs still arrive from each test's "Add to report" (components/reports).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  Box, Button, ButtonBase, Divider, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem,
  Stack, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/AddRounded'
import ArticleIcon from '@mui/icons-material/ArticleRounded'
import TitleIcon from '@mui/icons-material/TitleRounded'
import NotesIcon from '@mui/icons-material/NotesRounded'
import TableChartIcon from '@mui/icons-material/TableChartRounded'
import ViewListIcon from '@mui/icons-material/ViewListRounded'
import PageBreakIcon from '@mui/icons-material/InsertPageBreakRounded'
import ScienceIcon from '@mui/icons-material/ScienceRounded'
import DragIcon from '@mui/icons-material/DragIndicatorRounded'
import UndoIcon from '@mui/icons-material/UndoRounded'
import ChevronIcon from '@mui/icons-material/ExpandMoreRounded'
import CheckIcon from '@mui/icons-material/CheckRounded'
import PictureIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import GridIcon from '@mui/icons-material/GridOnRounded'
import BadgeIcon from '@mui/icons-material/BadgeRounded'
import ChartIcon from '@mui/icons-material/ShowChartRounded'
import BrandIcon from '@mui/icons-material/BrandingWatermarkRounded'
import ArrowUpIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ArrowDownIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import DescriptionIcon from '@mui/icons-material/DescriptionRounded'
import TemplatesIcon from '@mui/icons-material/DashboardCustomizeRounded'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import {
  entryResult, reportsApi, type ReportBlock, type ReportBlockType, type ReportTemplate,
} from '../../api/reports'
import { saveBlob } from '../../lib/download'
import { useNotify } from '../../context/NotifyContext'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import {
  ACTION_W, KeySpinner, MiniAction, ModalShell, PageBody, PRESS_SX, REDUCED_MOTION, StatusDot, TEXT,
  actionSx, usePageActive,
} from '../../ui'
import type { TestPageProps } from '../types'
import {
  AllRunsView, CoverView, EntryView, ImageView, PageBreakView, PaperText, ParamsView, SummaryView, UnitsView,
} from './Paper'
import { dragHasFiles, imageFiles, prepareImage } from './images'
import { FONT, PAGE, PAPER, PAPER_TYPE, unitLabel } from './paperStyle'

/** The tail under the last block: the "Add component" key. */
const TAIL_H = 44
import { documentOrder, move, newBlock, unplaced } from './layout'
import { useDragReorder } from './useDragReorder'
import { SHEET, layoutPages, useBlockHeights } from './pageFlow'
import { Resizable } from './Resizable'
import { ChartView } from './ChartView'
import { FormatBar } from './FormatBar'

type SaveState = 'saved' | 'pending' | 'saving' | 'error'
type Dialog = null | 'new' | 'rename' | 'delete' | 'save-template' | { apply: ReportTemplate }
type MenuState = null
  | { kind: 'add'; anchor: HTMLElement; index: number }
  | { kind: 'more' | 'templates'; anchor: HTMLElement }

const CATALOG: Array<{ type: ReportBlockType; label: string; desc: string; icon: ReactNode }> = [
  { type: 'heading', label: 'Heading', desc: 'A section title', icon: <TitleIcon fontSize="small" /> },
  { type: 'text', label: 'Text', desc: 'A paragraph of your own', icon: <NotesIcon fontSize="small" /> },
  { type: 'summary', label: 'Summary table', desc: 'Every run and its result', icon: <TableChartIcon fontSize="small" /> },
  { type: 'all_entries', label: 'All runs', desc: 'Every run not placed on its own', icon: <ViewListIcon fontSize="small" /> },
  { type: 'image', label: 'Picture', desc: 'Paste, drop or choose an image', icon: <PictureIcon fontSize="small" /> },
  { type: 'chart', label: 'Chart', desc: "A run's results plotted", icon: <ChartIcon fontSize="small" /> },
  { type: 'params', label: 'Parameters table', desc: 'Parameter and value rows you fill in', icon: <GridIcon fontSize="small" /> },
  { type: 'units', label: 'Unit IDs', desc: 'The units the runs were measured on', icon: <BadgeIcon fontSize="small" /> },
  { type: 'cover', label: 'Cover', desc: 'Product, period, units, operators, notes', icon: <ArticleIcon fontSize="small" /> },
  { type: 'page_break', label: 'Page break', desc: 'Start a new page', icon: <PageBreakIcon fontSize="small" /> },
]

const BLOCK_NAME: Record<ReportBlockType, string> = {
  cover: 'Cover', heading: 'Heading', text: 'Text', summary: 'Summary', entry: 'Test run',
  all_entries: 'All runs', page_break: 'Page break', image: 'Picture', params: 'Parameters', units: 'Unit IDs',
  chart: 'Chart',
}

/** Components resized by their right edge (pictures size from both). */
const RESIZABLE = new Set<ReportBlockType>(['summary', 'heading', 'text', 'entry', 'params', 'units'])

/** A picture's widths, as shares of the text width. */
const IMAGE_SIZES: Array<[string, number]> = [['S', 33], ['M', 50], ['L', 75], ['Full', 100]]

export function ReportsPage({ protocol, group }: TestPageProps) {
  const qc = useQueryClient()
  const { success, error } = useNotify()
  const [activeId, setActiveId] = usePersistedState<string>(STORAGE_KEYS.activeReport, '')

  const list = useQuery({ queryKey: ['reports'], queryFn: reportsApi.list })
  const templates = useQuery({ queryKey: ['report-templates'], queryFn: reportsApi.templates })
  const products = list.data ?? []
  const selectedId = products.some((p) => p.id === activeId) ? activeId : products[0]?.id ?? ''
  const report = useQuery({
    queryKey: ['report', selectedId], queryFn: () => reportsApi.get(selectedId), enabled: !!selectedId,
  })
  const prod = report.data && report.data.id === selectedId ? report.data : undefined

  // --- the document being edited --------------------------------------------
  // Local, so typing and dragging never wait on the network. Taken from the
  // server when another product is opened, or when the server's copy moved
  // on (a run added from a test page) while nothing here was unsaved.
  const [doc, setDoc] = useState<{ pid: string; version: string; blocks: ReportBlock[] } | null>(null)
  const [history, setHistory] = useState<ReportBlock[][]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [selId, setSelId] = useState<string | null>(null)
  if (prod && (doc?.pid !== prod.id || (doc.version !== prod.updated_at && saveState === 'saved'))) {
    if (doc?.pid !== prod.id) { setHistory([]); setSelId(null) }
    setDoc({ pid: prod.id, version: prod.updated_at, blocks: prod.blocks })
  }
  const blocks = doc && prod && doc.pid === prod.id ? doc.blocks : []

  const pending = useRef<{ pid: string; blocks: ReportBlock[] } | null>(null)
  const timer = useRef<number | null>(null)
  const flush = async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    const p = pending.current
    if (!p) return
    pending.current = null
    setSaveState('saving')
    try {
      const out = await reportsApi.setBlocks(p.pid, p.blocks)
      qc.setQueryData(['report', out.id], out)
      setDoc((d) => (d && d.pid === out.id ? { ...d, version: out.updated_at } : d))
      setSaveState(pending.current ? 'pending' : 'saved')
      void qc.invalidateQueries({ queryKey: ['reports'] })
    } catch {
      pending.current = pending.current ?? p
      setSaveState('error')
    }
  }
  // Whatever is still unsent goes when the page goes.
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush })
  useEffect(() => () => { void flushRef.current() }, [])

  // The document as last set, for changes that land after an await (a
  // picture upload): a render's `doc` would be stale by then.
  const docRef = useRef(doc)
  useEffect(() => { docRef.current = doc })
  const changeWith = (fn: (b: ReportBlock[]) => ReportBlock[], record = true) => {
    const d = docRef.current
    if (!d) return
    const next = fn(d.blocks)
    if (record) setHistory((h) => [...h.slice(-49), d.blocks])
    docRef.current = { ...d, blocks: next }
    setDoc(docRef.current)
    pending.current = { pid: d.pid, blocks: next }
    setSaveState('pending')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, 600)
  }
  const change = (next: ReportBlock[], record = true) => changeWith(() => next, record)
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    change(prev, false)
  }

  const insertAt = (index: number, b: ReportBlock) => {
    change([...blocks.slice(0, index), b, ...blocks.slice(index)])
    setSelId(b.id)
  }
  const update = (id: string, patch: Partial<ReportBlock>, record = true) =>
    change(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)), record)
  const remove = (id: string) => {
    change(blocks.filter((b) => b.id !== id))
    if (selId === id) setSelId(null)
  }
  const shift = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j >= 0 && j < blocks.length) change(move(blocks, i, j))
  }
  /** A component's width from its resize handle: the start of a drag is
   *  one undo step, the moves and the release are not more. */
  const resizeOf = (b: ReportBlock) => (width: number, phase: 'start' | 'move' | 'end') =>
    update(b.id, { width }, phase === 'start')

  /** A table row's fill, from the format bar: one undo step. */
  const setFill = (bid: string, key: string, color: string) => changeWith((bs) => bs.map((x) => {
    if (x.id !== bid) return x
    const labels = { ...x.labels }
    if (color) labels[`fill:${key}`] = color
    else delete labels[`fill:${key}`]
    return { ...x, labels }
  }))

  const setLabel = (b: ReportBlock) => (key: string, value: string) => {
    const labels = { ...b.labels }
    if (value) labels[key] = value
    else delete labels[key]
    update(b.id, { labels }, false)
  }

  // --- pictures -------------------------------------------------------------
  const [uploading, setUploading] = useState<Set<string>>(() => new Set())
  const busy = (id: string, on: boolean) => setUploading((s) => {
    const n = new Set(s)
    if (on) n.add(id)
    else n.delete(id)
    return n
  })
  /** Upload into an existing picture block. */
  const fillImage = async (bid: string, file: File) => {
    busy(bid, true)
    try {
      const { id } = await reportsApi.uploadImage(await prepareImage(file))
      changeWith((bs) => bs.map((x) => (x.id === bid ? { ...x, image_id: id } : x)))
    } catch (e) {
      error(`Could not add the picture: ${(e as Error).message}`)
    } finally {
      busy(bid, false)
    }
  }
  /** New picture blocks at `index`, each filled as its upload lands. */
  const insertImages = (files: File[], index: number) => {
    const made = files.map(() => newBlock('image'))
    changeWith((bs) => [...bs.slice(0, index), ...made, ...bs.slice(index)])
    setSelId(made[made.length - 1]?.id ?? null)
    made.forEach((b, i) => { void fillImage(b.id, files[i]) })
  }
  /** Where a pasted or dropped picture goes: into the selected empty
   *  picture block, else after the selected block, else at the end. */
  const placeImages = (files: File[], at?: string | null) => {
    const cur = docRef.current?.blocks ?? []
    const target = at ?? selId
    const sel = cur.find((b) => b.id === target)
    if (sel?.type === 'image' && !sel.image_id && files.length) {
      void fillImage(sel.id, files[0])
      if (files.length > 1) insertImages(files.slice(1), cur.indexOf(sel) + 1)
      return
    }
    insertImages(files, sel ? cur.indexOf(sel) + 1 : cur.length)
  }
  const pickFiles = useRef<HTMLInputElement>(null)

  // The logo on the cover and in the header: one for every report.
  const style = useQuery({ queryKey: ['report-style'], queryFn: reportsApi.style })
  const logoId = style.data?.logo_image_id ?? null
  const pickLogo = useRef<HTMLInputElement>(null)
  const setLogo = useMutation({
    mutationFn: async (file: File | null) => {
      const id = file ? (await reportsApi.uploadImage(await prepareImage(file))).id : null
      return reportsApi.setStyle({ logo_image_id: id })
    },
    onSuccess: (st) => qc.setQueryData(['report-style'], st),
    onError: (e: Error) => error(`Could not set the logo: ${e.message}`),
  })
  const [dropping, setDropping] = useState(false)

  // Ctrl+V with a picture on the clipboard, anywhere on the page while it is
  // on screen. A paste of text into a field is left alone.
  const active = usePageActive()
  const placeRef = useRef(placeImages)
  useEffect(() => { placeRef.current = placeImages })
  useEffect(() => {
    if (!active || !prod) return
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData)
      if (!files.length) return
      e.preventDefault()
      // Where you are: the block holding the text cursor, else the block
      // last clicked. (The selection alone missed a click into text, which
      // did not select its block, so the picture landed elsewhere.)
      const host = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-block-id]')
      placeRef.current(files, host?.dataset.blockId ?? null)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, prod])

  // The pages: measured blocks flowed onto A4 sheets (pageFlow.ts).
  const { heights, measure } = useBlockHeights()

  const dnd = useDragReorder(blocks.map((b) => b.id), (from, to) => change(move(blocks, from, to)))

  const open = (id: string) => {
    void flush()
    setActiveId(id)
  }

  // --- product and template actions ----------------------------------------
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<MenuState>(null)

  const createProduct = useMutation({
    mutationFn: ({ name, templateId }: { name: string; templateId: string | null }) => reportsApi.create(name, templateId),
    onSuccess: (p) => {
      qc.setQueryData(['report', p.id], p)
      void qc.invalidateQueries({ queryKey: ['reports'] })
      open(p.id)
      setDialog(null)
    },
    onError: (e: Error) => error(`Could not create the report: ${e.message}`),
  })
  const renameProduct = useMutation({
    mutationFn: (name: string) => reportsApi.update(selectedId, { name }),
    onSuccess: (p) => {
      qc.setQueryData(['report', p.id], p)
      void qc.invalidateQueries({ queryKey: ['reports'] })
      setDialog(null)
    },
  })
  const deleteProduct = useMutation({
    mutationFn: () => reportsApi.remove(selectedId),
    onSuccess: () => {
      pending.current = null
      qc.removeQueries({ queryKey: ['report', selectedId] })
      setActiveId('')
      setDialog(null)
      void qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
  const saveTemplate = useMutation({
    mutationFn: (name: string) => reportsApi.saveTemplate(name, blocks),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['report-templates'] })
      success(`Saved template "${t.name}"`)
      setDialog(null)
    },
  })
  const applyTemplate = useMutation({
    mutationFn: async (t: ReportTemplate) => { await flush(); return reportsApi.applyTemplate(selectedId, t.id) },
    onSuccess: (p) => {
      setHistory((h) => [...h.slice(-49), blocks])
      qc.setQueryData(['report', p.id], p)
      setDoc({ pid: p.id, version: p.updated_at, blocks: p.blocks })
      setDialog(null)
    },
  })
  const removeTemplate = useMutation({
    mutationFn: (id: string) => reportsApi.removeTemplate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report-templates'] }),
  })
  const exportDocx = useMutation({
    mutationFn: async () => { await flush(); return reportsApi.exportDocx(selectedId) },
    onSuccess: async ({ blob, filename }) => {
      if ((await saveBlob(blob, filename)) === 'saved') success(`Saved ${filename}`)
    },
    onError: (e: Error) => error(`Word export failed: ${e.message}`),
  })

  const entries = prod?.entries ?? []
  const byId = new Map(entries.map((e) => [e.id, e]))
  const number = documentOrder(blocks, entries)
  const ordered = [...number.keys()].map((id) => byId.get(id)).filter((e) => e !== undefined)

  const onCanvasKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [data-rich]')) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); remove(selId) }
    if (e.key === 'Escape') setSelId(null)
  }

  const addMenuAt = (index: number) => (ev: MouseEvent<HTMLElement>) =>
    setMenu({ kind: 'add', anchor: ev.currentTarget, index })
  const selIndex = selId ? blocks.findIndex((b) => b.id === selId) : -1
  const flow = layoutPages(
    blocks.map((b) => ({
      id: b.id, ownPage: b.type === 'cover', breakAfter: b.type === 'page_break', keepWithNext: b.type === 'heading',
    })),
    heights, TAIL_H,
  )
  const applying = typeof dialog === 'object' && dialog !== null ? dialog.apply : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Product reports"
        actions={
          <Tooltip title={prod ? '' : 'Create a report first'}>
            <span>
              <Button variant="contained" disabled={!prod || exportDocx.isPending}
                startIcon={exportDocx.isPending ? <KeySpinner /> : <DescriptionIcon />}
                onClick={() => exportDocx.mutate()} sx={actionSx(ACTION_W.wide)}>
                Export Word
              </Button>
            </span>
          </Tooltip>
        }
      />

      <PageBody width="fluid" scroll>
        {products.length === 0 && !list.isLoading ? (
          <EmptyState onNew={() => setDialog('new')} error={list.isError ? (list.error as Error).message : null} />
        ) : (
          <Box>
            {/* The toolbar: a translucent strip the page scrolls under, so it
                stays in reach without taking a band of its own. */}
            <Stack
              direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap"
              // The format bar stays below this: the page under it is out of view.
              data-format-ceiling=""
              sx={(t) => ({
                position: 'sticky', top: 0, zIndex: 5, mb: 2, px: 1.25, py: 1,
                borderRadius: '12px', border: 1, borderColor: 'divider',
                bgcolor: alpha(t.palette.background.paper, 0.72),
                backdropFilter: 'blur(20px) saturate(180%)',
                '@media (prefers-reduced-transparency: reduce)': {
                  bgcolor: t.palette.background.paper, backdropFilter: 'none',
                },
              })}
            >
              {/* The report's name is the switcher, as a document's title is
                  in Pages: the list of reports, new, rename and delete. */}
              <ButtonBase
                onClick={(e) => setMenu({ kind: 'more', anchor: e.currentTarget })}
                aria-label="Switch report"
                sx={(t) => ({
                  px: 1, py: 0.5, borderRadius: '8px', gap: 0.5, maxWidth: 360, minWidth: 0,
                  transition: 'background-color 120ms ease, transform 100ms ease-out',
                  '&:hover': { bgcolor: t.palette.action.hover },
                  ...PRESS_SX,
                })}
              >
                <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                  <Typography noWrap sx={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                    {prod?.name ?? 'Loading…'}
                  </Typography>
                  <Typography noWrap sx={{ ...TEXT.hint, color: 'text.secondary', lineHeight: 1.3 }}>
                    {entries.length} run{entries.length === 1 ? '' : 's'}
                    {' · '}{new Set(entries.map((e) => e.dut.mac).filter(Boolean)).size} unit{new Set(entries.map((e) => e.dut.mac).filter(Boolean)).size === 1 ? '' : 's'}
                  </Typography>
                </Box>
                <ChevronIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              </ButtonBase>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <MiniAction startIcon={<AddIcon />} disabled={!prod}
                onClick={addMenuAt(selIndex >= 0 ? selIndex + 1 : blocks.length)}>
                Add
              </MiniAction>
              <input ref={pickLogo} type="file" accept="image/*" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) setLogo.mutate(f)
                }} />
              <MiniAction startIcon={<PictureIcon />} disabled={!prod} onClick={() => pickFiles.current?.click()}>
                Picture
              </MiniAction>
              <input ref={pickFiles} type="file" accept="image/*" multiple hidden
                onChange={(e) => {
                  const f = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (f.length) placeImages(f)
                }} />
              <MiniAction startIcon={<TemplatesIcon />} disabled={!prod}
                onClick={(e) => setMenu({ kind: 'templates', anchor: e.currentTarget })}>
                Templates
              </MiniAction>
              <Tooltip title="Undo (Ctrl+Z)">
                <span>
                  <IconButton size="small" aria-label="Undo" disabled={history.length === 0} onClick={undo}>
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <SaveStatus state={saveState} onRetry={() => void flush()} />
            </Stack>

            {/* The page. Clicking the margin around blocks clears the
                selection; keys act on the selected block. */}
            <Box tabIndex={-1} onKeyDown={onCanvasKey} onPointerDown={() => setSelId(null)}
              sx={{ outline: 'none', pb: 4, overflowX: 'auto' }}>
              <Box
                // Files dropped anywhere on the page become pictures where the
                // selection is; the page outlines itself while they hover.
                onDragOver={(e) => { if (prod && dragHasFiles(e.dataTransfer)) { e.preventDefault(); setDropping(true) } }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false) }}
                onDrop={(e) => {
                  setDropping(false)
                  const f = imageFiles(e.dataTransfer)
                  if (!f.length) return
                  e.preventDefault()
                  placeImages(f)
                }}
                sx={{
                  // A stack of A4 sheets (794 x 1123 at 96 dpi), the blocks one
                  // column over them inside the 2.54 cm margins.
                  position: 'relative', width: SHEET.width, mx: 'auto', flexShrink: 0,
                  minHeight: prod && blocks.length ? flow.height : SHEET.height,
                  color: PAPER.ink, fontFamily: FONT.body,
                }}
              >
                <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {(prod && blocks.length ? flow.sheets : [{ top: 0, height: SHEET.height, cover: true }]).map((sh, k) => (
                    <Box key={k} sx={(t) => ({
                      position: 'absolute', left: 0, right: 0, top: sh.top, height: sh.height,
                      bgcolor: PAPER.bg, borderRadius: '2px',
                      transition: 'box-shadow 160ms ease',
                      boxShadow: [
                        dropping ? `0 0 0 2px ${t.palette.primary.main}` : null,
                        t.palette.mode === 'light'
                          ? '0 1px 2px rgba(0,0,0,0.06), 0 8px 28px rgba(0,0,0,0.08)'
                          : '0 1px 2px rgba(0,0,0,0.4), 0 12px 36px rgba(0,0,0,0.45)',
                      ].filter(Boolean).join(', '),
                    })}>
                      {/* Word's header and footer: on every page but the cover. */}
                      {!sh.cover && logoId && (
                        <Box component="img" src={reportsApi.imageUrl(logoId)} alt="" draggable={false}
                          sx={{ position: 'absolute', top: 47, left: SHEET.margin - 32, width: PAGE.headerLogo }} />
                      )}
                      {!sh.cover && (
                        <Typography sx={{
                          position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center',
                          fontFamily: FONT.body, fontSize: 13.3, color: PAPER.blue,
                        }}>
                          {k + 1}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ position: 'relative', zIndex: 1, px: `${SHEET.margin}px`, pt: `${SHEET.margin}px` }}>
                {!prod ? (
                  <Typography sx={{ ...PAPER_TYPE.body, color: PAPER.muted }}>Loading…</Typography>
                ) : blocks.length === 0 ? (
                  <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}>
                    <Typography sx={{ ...PAPER_TYPE.h2, color: PAPER.ink }}>This report is empty</Typography>
                    <Typography sx={{ ...PAPER_TYPE.small, color: PAPER.muted }}>
                      Add a cover, the summary, your runs and your own text.
                    </Typography>
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={addMenuAt(0)}>Add component</Button>
                  </Stack>
                ) : (
                  <>
                    {blocks.map((b, i) => {
                      const e = b.entry_id ? byId.get(b.entry_id) : undefined
                      const gap = flow.spacer.get(b.id)
                      return (
                        <Box key={b.id}>
                          {/* The rest of the page above, the gap between
                              sheets, and the next page's top margin. */}
                          {gap ? <Box sx={{ height: gap }} /> : null}
                          <Box ref={measure(b.id)}>
                          <Inserter onClick={addMenuAt(i)} hidden={!!dnd.draggingId} />
                          <BlockFrame
                            block={b}
                            index={i}
                            count={blocks.length}
                            selected={selId === b.id}
                            dragging={dnd.draggingId === b.id}
                            onSelect={() => setSelId(b.id)}
                            register={dnd.register(b.id)}
                            style={dnd.styleFor(b.id)}
                            handle={dnd.handleProps(b.id)}
                            onUp={() => shift(i, -1)}
                            onDown={() => shift(i, 1)}
                            onRemove={() => remove(b.id)}
                            onPatch={(p) => update(b.id, p)}
                          >
                            {b.type === 'cover' && (
                              <CoverView prod={prod} block={b} logoId={logoId} onPickLogo={() => pickLogo.current?.click()}
                                busy={uploading.has(b.id)} onFiles={(f) => { void fillImage(b.id, f[0]) }}
                                onResize={resizeOf(b)} labels={b.labels} onLabel={setLabel(b)} />
                            )}
                            {/* Every component that has a width of its own is
                                resized by dragging its right edge. */}
                            {RESIZABLE.has(b.type) && (
                              <Resizable width={b.width} onResize={resizeOf(b)}>
                                {b.type === 'summary' && (
                                  <SummaryView ordered={ordered} number={number} labels={b.labels} onLabel={setLabel(b)} />
                                )}
                                {b.type === 'heading' && (
                                  <PaperText value={b.text} placeholder="Heading" autoFocus={!b.text && selId === b.id}
                                    onChange={(v) => update(b.id, { text: v }, false)}
                                    sx={b.level === 1 ? PAPER_TYPE.h1 : PAPER_TYPE.h2} />
                                )}
                                {b.type === 'text' && (
                                  <PaperText multiline value={b.text} autoFocus={!b.text && selId === b.id}
                                    placeholder="Write something. A blank line starts a new paragraph."
                                    onChange={(v) => update(b.id, { text: v }, false)} sx={PAPER_TYPE.body} />
                                )}
                                {b.type === 'entry' && (e
                                  ? <EntryView e={e} n={number.get(e.id)} showSettings={b.show_settings} showNote={b.show_note}
                                      labels={b.labels} onLabel={setLabel(b)} />
                                  : <Typography sx={{ ...PAPER_TYPE.small, color: PAPER.muted }}>This run was removed from the report.</Typography>)}
                                {b.type === 'params' && (
                                  <ParamsView rows={b.rows} onRows={(rows, record) => update(b.id, { rows }, record)}
                                    labels={b.labels} onLabel={setLabel(b)} />
                                )}
                                {b.type === 'units' && <UnitsView prod={prod} labels={b.labels} onLabel={setLabel(b)} />}
                              </Resizable>
                            )}
                            {b.type === 'all_entries' && (
                              <AllRunsView runs={unplaced(blocks, entries)} number={number}
                                onPlace={(id) => insertAt(i + 1, newBlock('entry', { entry_id: id }))} />
                            )}
                            {b.type === 'page_break' && <PageBreakView />}
                            {b.type === 'chart' && (
                              <ChartView block={b} runs={ordered} number={number} selected={selId === b.id}
                                onPatch={(p, record) => update(b.id, p, record)} onResize={resizeOf(b)} />
                            )}
                            {b.type === 'image' && (
                              <ImageView imageId={b.image_id} width={b.width} caption={b.text}
                                busy={uploading.has(b.id)} onResize={resizeOf(b)}
                                onCaption={(v) => update(b.id, { text: v }, false)}
                                onFiles={(f) => { void fillImage(b.id, f[0]) }} />
                            )}
                          </BlockFrame>
                          </Box>
                        </Box>
                      )
                    })}
                    <Inserter onClick={addMenuAt(blocks.length)} hidden={!!dnd.draggingId} last />
                  </>
                )}
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </PageBody>
      <FormatBar onFill={setFill}
        fillOf={(bid, key) => blocks.find((x) => x.id === bid)?.labels[`fill:${key}`] ?? ''} />

      {/* --- menus --------------------------------------------------------- */}
      <Menu open={menu?.kind === 'add'} anchorEl={menu?.anchor} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 460 } } }}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Components</ListSubheader>
        {CATALOG.map((c) => (
          <MenuItem key={c.type} onClick={() => {
            if (menu?.kind === 'add') insertAt(menu.index, newBlock(c.type))
            setMenu(null)
          }}>
            <ListItemIcon>{c.icon}</ListItemIcon>
            <ListItemText primary={c.label} secondary={c.desc}
              slotProps={{ primary: { sx: TEXT.label }, secondary: { sx: TEXT.hint } }} />
          </MenuItem>
        ))}
        <ListSubheader sx={{ lineHeight: '32px' }}>Test runs</ListSubheader>
        {entries.length === 0 && (
          <MenuItem disabled>
            <ListItemText primary="No runs yet" secondary="Use Add to report on a test's results"
              slotProps={{ primary: { sx: TEXT.label }, secondary: { sx: TEXT.hint } }} />
          </MenuItem>
        )}
        {entries.map((e) => {
          const r = entryResult(e.summary)
          const placed = blocks.some((b) => b.type === 'entry' && b.entry_id === e.id)
          return (
            <MenuItem key={e.id} onClick={() => {
              if (menu?.kind === 'add') insertAt(menu.index, newBlock('entry', { entry_id: e.id }))
              setMenu(null)
            }}>
              <ListItemIcon><ScienceIcon fontSize="small" /></ListItemIcon>
              <ListItemText
                primary={e.title}
                secondary={`${unitLabel(e)}${r ? ` · ${r}` : ''}${placed ? ' · already placed' : ''}`}
                slotProps={{
                  primary: { sx: TEXT.label },
                  secondary: { sx: { ...TEXT.hint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                }} />
            </MenuItem>
          )
        })}
      </Menu>

      <Menu open={menu?.kind === 'more'} anchorEl={menu?.anchor} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 480 } } }}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Reports</ListSubheader>
        {products.map((p) => (
          <MenuItem key={p.id} selected={p.id === selectedId} onClick={() => { setMenu(null); open(p.id) }}>
            <ListItemIcon>{p.id === selectedId ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText primary={p.name}
              secondary={`${p.entry_count} run${p.entry_count === 1 ? '' : 's'} · ${p.units} unit${p.units === 1 ? '' : 's'}`}
              slotProps={{ primary: { sx: { ...TEXT.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, secondary: { sx: TEXT.hint } }} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { setMenu(null); setDialog('new') }}>
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>New report…
        </MenuItem>
        <MenuItem disabled={!prod} onClick={() => { setMenu(null); setDialog('rename') }}>
          <ListItemIcon><TitleIcon fontSize="small" /></ListItemIcon>Rename…
        </MenuItem>
        <Divider />
        <MenuItem disabled={!prod} onClick={() => { setMenu(null); setDialog('delete') }} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteIcon fontSize="small" /></ListItemIcon>Delete report…
        </MenuItem>
      </Menu>

      <Menu open={menu?.kind === 'templates'} anchorEl={menu?.anchor} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { width: 300 } } }}>
        <MenuItem onClick={() => { setMenu(null); setDialog('save-template') }}>
          <ListItemIcon><TemplatesIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Save this layout as a template" slotProps={{ primary: { sx: TEXT.label } }} />
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); pickLogo.current?.click() }}>
          <ListItemIcon><BrandIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={logoId ? 'Change the logo…' : 'Add a logo…'}
            secondary="On the cover and every page, for all reports"
            slotProps={{ primary: { sx: TEXT.label }, secondary: { sx: TEXT.hint } }} />
        </MenuItem>
        {logoId && (
          <MenuItem onClick={() => { setMenu(null); setLogo.mutate(null) }}>
            <ListItemIcon />
            <ListItemText primary="Remove the logo" slotProps={{ primary: { sx: TEXT.label } }} />
          </MenuItem>
        )}
        <Divider />
        <ListSubheader sx={{ lineHeight: '32px' }}>Apply a template</ListSubheader>
        {(templates.data ?? []).length === 0 && (
          <MenuItem disabled><ListItemText primary="No templates yet" slotProps={{ primary: { sx: TEXT.hint } }} /></MenuItem>
        )}
        {(templates.data ?? []).map((t) => (
          <MenuItem key={t.id} onClick={() => { setMenu(null); setDialog({ apply: t }) }}>
            <ListItemText primary={t.name} secondary={`${t.blocks.length} component${t.blocks.length === 1 ? '' : 's'}`}
              slotProps={{ primary: { sx: TEXT.label }, secondary: { sx: TEXT.hint } }} />
            <Tooltip title="Delete template">
              <IconButton size="small" edge="end" aria-label={`Delete template ${t.name}`}
                onClick={(ev) => { ev.stopPropagation(); removeTemplate.mutate(t.id) }}>
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </MenuItem>
        ))}
      </Menu>

      {/* --- dialogs ------------------------------------------------------- */}
      <NewReportDialog
        open={dialog === 'new'} templates={templates.data ?? []} pending={createProduct.isPending}
        onClose={() => setDialog(null)}
        onCreate={(name, templateId) => createProduct.mutate({ name, templateId })}
      />
      <NameDialog
        open={dialog === 'rename'} title="Rename report" label="Product name" initial={prod?.name ?? ''}
        submit="Save" pending={renameProduct.isPending}
        onClose={() => setDialog(null)} onSubmit={(n) => renameProduct.mutate(n)}
      />
      <NameDialog
        open={dialog === 'save-template'} title="Save as template" label="Template name" initial=""
        placeholder="e.g. Lab standard" submit="Save" pending={saveTemplate.isPending}
        note="Saved without its runs: the runs placed one by one become an All runs component, so the template fits any product."
        onClose={() => setDialog(null)} onSubmit={(n) => saveTemplate.mutate(n)}
      />
      <ModalShell
        open={dialog === 'delete'} onClose={() => setDialog(null)} title="Delete this report?" maxWidth="xs"
        footer={{
          secondary: <Button variant="outlined" color="inherit" onClick={() => setDialog(null)}>Cancel</Button>,
          primary: (
            <Button variant="contained" color="error" disabled={deleteProduct.isPending}
              startIcon={deleteProduct.isPending ? <KeySpinner /> : <DeleteIcon />} onClick={() => deleteProduct.mutate()}>
              Delete
            </Button>
          ),
        }}
      >
        <Typography sx={{ ...TEXT.label, fontWeight: 400 }}>
          "{prod?.name}", its layout and its {entries.length} run{entries.length === 1 ? '' : 's'} will be deleted.
          This cannot be undone. Word files already exported are not affected.
        </Typography>
      </ModalShell>
      <ModalShell
        open={!!applying} onClose={() => setDialog(null)} title="Apply this template?" maxWidth="xs"
        footer={{
          secondary: <Button variant="outlined" color="inherit" onClick={() => setDialog(null)}>Cancel</Button>,
          primary: (
            <Button variant="contained" disabled={applyTemplate.isPending}
              startIcon={applyTemplate.isPending ? <KeySpinner /> : undefined}
              onClick={() => applying && applyTemplate.mutate(applying)}>
              Apply
            </Button>
          ),
        }}
      >
        <Typography sx={{ ...TEXT.label, fontWeight: 400 }}>
          This report's layout is replaced by "{applying?.name}". Its runs stay, listed by the
          template's All runs. Undo brings the current layout back.
        </Typography>
      </ModalShell>
    </Box>
  )
}

// --- pieces ----------------------------------------------------------------

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const label = state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : 'Saving…'
  const color = state === 'error' ? 'error.main' : state === 'saved' ? 'success.main' : 'warning.main'
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} role="status" sx={{ minWidth: 92, justifyContent: 'flex-end' }}>
      <StatusDot color={color} />
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>{label}</Typography>
      {state === 'error' && <MiniAction onClick={onRetry}>Retry</MiniAction>}
    </Stack>
  )
}

/** The + in the gap between two blocks: a hairline and a key that appear
 *  under the pointer, so the page reads as a page until you reach for it. */
function Inserter({ onClick, hidden, last }: {
  onClick: (e: MouseEvent<HTMLElement>) => void
  hidden?: boolean
  last?: boolean
}) {
  return (
    <Box
      onPointerDown={(e) => e.stopPropagation()}
      sx={(t) => ({
        position: 'relative', height: last ? 44 : 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
        visibility: hidden ? 'hidden' : 'visible',
        '& .ins': { opacity: last ? 0.6 : 0, transition: 'opacity 120ms ease, transform 100ms ease-out' },
        '&:hover .ins, & .ins:focus-visible': { opacity: 1 },
        '&::before': {
          content: '""', position: 'absolute', left: 0, right: 0, top: '50%',
          borderTop: `1px solid ${alpha(t.palette.primary.main, 0.45)}`,
          opacity: 0, transition: 'opacity 120ms ease',
        },
        '&:hover::before': { opacity: last ? 0 : 1 },
        [REDUCED_MOTION]: { '& .ins, &::before': { transition: 'none' } },
      })}
    >
      <Box component="button" type="button" className="ins" aria-label="Add a component here" onClick={onClick}
        sx={(t) => ({
          position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 0.5,
          height: 24, px: last ? 1.25 : 0.5, borderRadius: '12px', cursor: 'pointer',
          border: `1px solid ${alpha(t.palette.primary.main, 0.5)}`, bgcolor: PAPER.bg, color: t.palette.primary.main,
          fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
          ...PRESS_SX,
        })}>
        <AddIcon sx={{ fontSize: 16 }} />
        {last && 'Add component'}
      </Box>
    </Box>
  )
}

function BlockFrame({
  block, index, count, selected, dragging, onSelect, register, style, handle, onUp, onDown, onRemove, onPatch, children,
}: {
  block: ReportBlock
  index: number
  count: number
  selected: boolean
  dragging: boolean
  onSelect: () => void
  register: (el: HTMLElement | null) => void
  style: React.CSSProperties
  handle: ReturnType<ReturnType<typeof useDragReorder>['handleProps']>
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onPatch: (p: Partial<ReportBlock>) => void
  children: ReactNode
}) {
  const runBlock = block.type === 'entry' || block.type === 'all_entries'
  return (
    <Box
      ref={register}
      style={style}
      data-block-id={block.id}
      // Capture, not bubble: a click into the block's text or a table cell
      // stops at the field, and must still select the block it is in.
      onPointerDownCapture={onSelect}
      onPointerDown={(e) => e.stopPropagation()}
      sx={(t) => ({
        position: 'relative', borderRadius: '6px', mx: -1.5, px: 1.5, py: 1,
        // An outline drawn as a shadow, so selecting takes no space and
        // nothing on the page moves.
        boxShadow: dragging
          ? `0 0 0 1px ${alpha(t.palette.primary.main, 0.4)}, 0 12px 32px rgba(0,0,0,0.18)`
          : selected ? `0 0 0 1.5px ${alpha(t.palette.primary.main, 0.7)}` : 'none',
        bgcolor: dragging ? PAPER.bg : undefined,
        '&:hover': selected || dragging ? undefined : { boxShadow: `0 0 0 1px ${alpha(t.palette.primary.main, 0.25)}` },
        '& .blk-chrome': { opacity: selected || dragging ? 1 : 0, transition: 'opacity 120ms ease' },
        '&:hover .blk-chrome': { opacity: 1 },
        [REDUCED_MOTION]: { '& .blk-chrome': { transition: 'none' } },
      })}
    >
      {/* Grab here to move. In the page's margin, beside the block. */}
      <Box
        className="blk-chrome"
        {...handle}
        role="button"
        aria-label={`Move ${BLOCK_NAME[block.type]}`}
        sx={(t) => ({
          position: 'absolute', left: -30, top: 8, width: 22, height: 28, borderRadius: '5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: PAPER.muted, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none',
          '&:hover': { bgcolor: alpha(t.palette.primary.main, 0.08), color: PAPER.ink },
        })}
      >
        <DragIcon sx={{ fontSize: 18 }} />
      </Box>

      {/* The block's own keys, floating just above it: clear of its first
          line, which they used to cover while it was being edited. */}
      <Stack
        className="blk-chrome"
        direction="row" alignItems="center" spacing={0.25}
        onPointerDown={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute', right: 4, bottom: 'calc(100% + 5px)', zIndex: 3, px: 0.5, height: 30,
          borderRadius: '9px',
          bgcolor: 'rgba(250, 250, 252, 0.86)', backdropFilter: 'blur(20px) saturate(180%)',
          border: '0.5px solid rgba(0, 0, 0, 0.12)',
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)',
          '@media (prefers-reduced-transparency: reduce)': { bgcolor: '#FAFAFC', backdropFilter: 'none' },
        }}
      >
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary', px: 0.75 }}>{BLOCK_NAME[block.type]}</Typography>
        {block.type === 'heading' && (
          <>
            <ChromeToggle on={block.level === 1} onClick={() => onPatch({ level: 1 })}>H1</ChromeToggle>
            <ChromeToggle on={block.level === 2} onClick={() => onPatch({ level: 2 })}>H2</ChromeToggle>
          </>
        )}
        {(block.type === 'image' || (block.type === 'cover' && block.image_id)) && (
          <>
            {IMAGE_SIZES.map(([name, w]) => (
              <ChromeToggle key={name} on={block.width === w} onClick={() => onPatch({ width: w })}>{name}</ChromeToggle>
            ))}
            {block.image_id && <ChromeToggle on={false} onClick={() => onPatch({ image_id: null })}>Replace</ChromeToggle>}
          </>
        )}
        {runBlock && (
          <>
            <ChromeToggle on={block.show_settings} onClick={() => onPatch({ show_settings: !block.show_settings })}>Settings</ChromeToggle>
            <ChromeToggle on={block.show_note} onClick={() => onPatch({ show_note: !block.show_note })}>Note</ChromeToggle>
          </>
        )}
        <Tooltip title="Move up">
          <span><IconButton size="small" aria-label="Move up" disabled={index === 0} onClick={onUp}>
            <ArrowUpIcon sx={{ fontSize: 18 }} />
          </IconButton></span>
        </Tooltip>
        <Tooltip title="Move down">
          <span><IconButton size="small" aria-label="Move down" disabled={index === count - 1} onClick={onDown}>
            <ArrowDownIcon sx={{ fontSize: 18 }} />
          </IconButton></span>
        </Tooltip>
        <Tooltip title="Remove (Delete)">
          <IconButton size="small" aria-label={`Remove ${BLOCK_NAME[block.type]}`} onClick={onRemove}>
            <DeleteIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {children}
    </Box>
  )
}

function ChromeToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Box component="button" type="button" aria-pressed={on} onClick={onClick}
      sx={(t) => ({
        height: 24, px: 0.9, borderRadius: '6px', border: 0, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 12, fontWeight: 600,
        color: on ? t.palette.primary.main : t.palette.text.secondary,
        bgcolor: on ? alpha(t.palette.primary.main, 0.12) : 'transparent',
        transition: 'background-color 120ms ease, transform 100ms ease-out', ...PRESS_SX,
        '&:hover': { bgcolor: on ? alpha(t.palette.primary.main, 0.18) : t.palette.action.hover },
      })}>
      {children}
    </Box>
  )
}

function EmptyState({ onNew, error }: { onNew: () => void; error: string | null }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 10, textAlign: 'center' }}>
      <Box sx={(t) => ({
        width: 64, height: 80, borderRadius: '6px', bgcolor: PAPER.bg, mb: 1,
        boxShadow: t.palette.mode === 'light' ? '0 6px 20px rgba(0,0,0,0.10)' : '0 8px 28px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      })}>
        <DescriptionIcon sx={{ color: alpha(PAPER.ink, 0.35), fontSize: 30 }} />
      </Box>
      <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {error ? 'Could not load reports' : 'Build your first report'}
      </Typography>
      <Typography sx={{ ...TEXT.label, fontWeight: 400, color: 'text.secondary', maxWidth: 440 }}>
        {error ?? 'A report is a document per product: a cover, a summary, the test runs you add from each test\'s results, and your own headings and text. Arrange it once and save it as a template.'}
      </Typography>
      {!error && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={onNew} sx={{ ...actionSx(ACTION_W.wide), mt: 1 }}>
          New report
        </Button>
      )}
    </Stack>
  )
}

function NameDialog({ open, title, label, initial, placeholder, submit, pending, note, onClose, onSubmit }: {
  open: boolean
  title: string
  label: string
  initial: string
  placeholder?: string
  submit: string
  pending: boolean
  note?: string
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  return (
    <ModalShell open={open} onClose={onClose} title={title} maxWidth="xs"
      footer={{
        secondary: <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>,
        primary: (
          <Button variant="contained" type="submit" form="name-dialog" disabled={pending}
            startIcon={pending ? <KeySpinner /> : undefined}>
            {submit}
          </Button>
        ),
      }}
    >
      {/* Mounted per opening, so each starts from `initial`. */}
      {open && (
        <Box component="form" id="name-dialog" onSubmit={(e) => {
          e.preventDefault()
          const v = String(new FormData(e.currentTarget).get('name') ?? '').trim()
          if (v) onSubmit(v)
        }}>
          <Stack spacing={1.5}>
            <LabeledField name="name" autoFocus label={label} defaultValue={initial} placeholder={placeholder} />
            {note && <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>{note}</Typography>}
          </Stack>
        </Box>
      )}
    </ModalShell>
  )
}

function NewReportDialog({ open, templates, pending, onClose, onCreate }: {
  open: boolean
  templates: ReportTemplate[]
  pending: boolean
  onClose: () => void
  onCreate: (name: string, templateId: string | null) => void
}) {
  const [start, setStart] = useState('')
  return (
    <ModalShell open={open} onClose={onClose} title="New report" maxWidth="xs"
      footer={{
        secondary: <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>,
        primary: (
          <Button variant="contained" type="submit" form="new-report" disabled={pending}
            startIcon={pending ? <KeySpinner /> : <AddIcon />}>
            Create
          </Button>
        ),
      }}
    >
      {open && (
        <Box component="form" id="new-report" onSubmit={(e) => {
          e.preventDefault()
          const v = String(new FormData(e.currentTarget).get('name') ?? '').trim()
          if (v) onCreate(v, start || null)
        }}>
          <Stack spacing={2}>
            <LabeledField name="name" autoFocus label="Product name" placeholder="e.g. Sonata 2 IL rev B" />
            <LabeledField select label="Start from" value={start} onChange={(e) => setStart(e.target.value)}
              hint={templates.length ? undefined : 'save a layout as a template to see it here'}>
              <MenuItem value="">Standard: cover, summary, all runs</MenuItem>
              {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </LabeledField>
          </Stack>
        </Box>
      )}
    </ModalShell>
  )
}
