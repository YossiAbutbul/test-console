/**
 * Product reports: the report as a workbook, drawn as a spreadsheet.
 *
 * One sheet per test type, one table each, the same sheets "Export Excel"
 * writes (backend/reports/sheets.py builds both, so the page and the file
 * cannot drift). Runs of one test type share a table: the unit's MAC, which
 * run it was, when, and the run's settings are columns in front of the
 * results, so rows from different units or settings sit side by side. The
 * first sheet is the Summary: the product's facts and one row per run.
 *
 * The grid is FortuneSheet, read-only: column letters, row numbers, the
 * formula bar and the sheet tabs along the bottom, because the operator asked
 * for a page that looks like Excel. Runs are removed from the report's menu.
 *
 * This replaced the Word document editor. A report's stored layout (its
 * blocks) is kept untouched in its file, so nothing an older report held is
 * lost; it is just no longer shown.
 *
 * Runs still arrive from each test's "Add to report" (components/reports).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, ButtonBase, Divider, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem,
  Stack, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/AddRounded'
import TitleIcon from '@mui/icons-material/TitleRounded'
import ChevronIcon from '@mui/icons-material/ExpandMoreRounded'
import CheckIcon from '@mui/icons-material/CheckRounded'
import DeleteIcon from '@mui/icons-material/DeleteRounded'
import RemoveRunIcon from '@mui/icons-material/PlaylistRemoveRounded'
import GridIcon from '@mui/icons-material/GridOnRounded'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { entryResult, reportsApi, type ReportEntry, type ReportSheets } from '../../api/reports'
import { saveBlob } from '../../lib/download'
import { useNotify } from '../../context/NotifyContext'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { ACTION_W, KeySpinner, MiniAction, ModalShell, PageBody, PRESS_SX, TEXT, actionSx } from '../../ui'
import type { TestPageProps } from '../types'
import { SHEET_FONT_PT, toWorkbook } from './sheetView'
import { EXCEL_SX } from './sheetChrome'

type Dialog = null | 'new' | 'rename' | 'delete' | 'runs' | { removeRun: ReportEntry }

export function ReportsPage({ protocol, group }: TestPageProps) {
  const qc = useQueryClient()
  const { success, error } = useNotify()
  const [activeId, setActiveId] = usePersistedState<string>(STORAGE_KEYS.activeReport, '')

  const list = useQuery({ queryKey: ['reports'], queryFn: reportsApi.list })
  const products = list.data ?? []
  const selectedId = products.some((p) => p.id === activeId) ? activeId : products[0]?.id ?? ''
  const report = useQuery({
    queryKey: ['report', selectedId], queryFn: () => reportsApi.get(selectedId), enabled: !!selectedId,
  })
  // Under ['report', id]: "Add to report" invalidates that key, which takes
  // the sheets along with it.
  const sheets = useQuery({
    queryKey: ['report', selectedId, 'sheets'], queryFn: () => reportsApi.sheets(selectedId), enabled: !!selectedId,
  })
  const prod = report.data && report.data.id === selectedId ? report.data : undefined
  const entries = prod?.entries ?? []
  const units = new Set(entries.map((e) => e.dut.mac).filter(Boolean)).size
  const rs = sheets.data

  const [dialog, setDialog] = useState<Dialog>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)

  const refresh = (pid: string) => {
    void qc.invalidateQueries({ queryKey: ['reports'] })
    void qc.invalidateQueries({ queryKey: ['report', pid] })
  }

  const createProduct = useMutation({
    mutationFn: (name: string) => reportsApi.create(name),
    onSuccess: (p) => {
      qc.setQueryData(['report', p.id], p)
      void qc.invalidateQueries({ queryKey: ['reports'] })
      setActiveId(p.id)
      setDialog(null)
    },
    onError: (e: Error) => error(`Could not create the report: ${e.message}`),
  })
  const renameProduct = useMutation({
    mutationFn: (name: string) => reportsApi.update(selectedId, { name }),
    onSuccess: (p) => { refresh(p.id); setDialog(null) },
  })
  const deleteProduct = useMutation({
    mutationFn: () => reportsApi.remove(selectedId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['report', selectedId] })
      setActiveId('')
      setDialog(null)
      void qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
  const removeRun = useMutation({
    mutationFn: (e: ReportEntry) => reportsApi.removeEntry(selectedId, e.id),
    // Back to the list, for the next one.
    onSuccess: (p) => { refresh(p.id); setDialog(p.entries.length ? 'runs' : null) },
    onError: (e: Error) => error(`Could not remove the run: ${e.message}`),
  })
  const exportXlsx = useMutation({
    mutationFn: () => reportsApi.exportXlsx(selectedId),
    onSuccess: async ({ blob, filename }) => {
      if ((await saveBlob(blob, filename)) === 'saved') success(`Saved ${filename}`)
    },
    onError: (e: Error) => error(`Excel export failed: ${e.message}`),
  })

  const removing = typeof dialog === 'object' && dialog !== null ? dialog.removeRun : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Product reports"
        actions={
          <Tooltip title={prod ? '' : 'Create a report first'}>
            <span>
              <Button variant="contained" disabled={!prod || exportXlsx.isPending}
                startIcon={exportXlsx.isPending ? <KeySpinner /> : <GridIcon />}
                onClick={() => exportXlsx.mutate()} sx={actionSx(ACTION_W.wide)}>
                Export Excel
              </Button>
            </span>
          </Tooltip>
        }
      />

      <PageBody width="fluid" grow>
        {products.length === 0 && !list.isLoading ? (
          <EmptyState onNew={() => setDialog('new')} error={list.isError ? (list.error as Error).message : null} />
        ) : (
          <Stack spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
              {/* The report's name is the switcher: the list of reports,
                  new, remove a run, rename and delete. */}
              <ButtonBase
                onClick={(e) => setMenu(e.currentTarget)}
                aria-label="Switch report"
                sx={(t) => ({
                  px: 1, py: 0.5, borderRadius: '8px', gap: 0.5, maxWidth: 420, minWidth: 0,
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
                    {' · '}{units} unit{units === 1 ? '' : 's'}
                    {' · '}{rs?.sheets.length ?? 0} test type{rs?.sheets.length === 1 ? '' : 's'}
                  </Typography>
                </Box>
                <ChevronIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              </ButtonBase>
              <MiniAction startIcon={<RemoveRunIcon />} disabled={!prod || entries.length === 0}
                onClick={() => setDialog('runs')}>
                Remove results
              </MiniAction>
            </Stack>

            {sheets.isError ? (
              <Typography sx={{ ...TEXT.label, color: 'error.main' }}>
                Could not load the report's tables: {(sheets.error as Error).message}
              </Typography>
            ) : !rs || !prod ? (
              <Typography sx={{ ...TEXT.label, color: 'text.secondary' }}>Loading…</Typography>
            ) : (
              <SheetGrid rs={rs} version={`${prod.id}:${prod.updated_at}`} />
            )}
          </Stack>
        )}
      </PageBody>

      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 480 } } }}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Reports</ListSubheader>
        {products.map((p) => (
          <MenuItem key={p.id} selected={p.id === selectedId} onClick={() => { setMenu(null); setActiveId(p.id) }}>
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
        <MenuItem disabled={!prod || entries.length === 0} onClick={() => { setMenu(null); setDialog('runs') }}>
          <ListItemIcon><RemoveRunIcon fontSize="small" /></ListItemIcon>Remove results…
        </MenuItem>
        <MenuItem disabled={!prod} onClick={() => { setMenu(null); setDialog('rename') }}>
          <ListItemIcon><TitleIcon fontSize="small" /></ListItemIcon>Rename…
        </MenuItem>
        <Divider />
        <MenuItem disabled={!prod} onClick={() => { setMenu(null); setDialog('delete') }} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteIcon fontSize="small" /></ListItemIcon>Delete report…
        </MenuItem>
      </Menu>

      <NameDialog
        open={dialog === 'new'} title="New report" label="Product name" initial=""
        placeholder="e.g. Sonata 2 IL rev B" submit="Create" pending={createProduct.isPending}
        onClose={() => setDialog(null)} onSubmit={(n) => createProduct.mutate(n)}
      />
      <NameDialog
        open={dialog === 'rename'} title="Rename report" label="Product name" initial={prod?.name ?? ''}
        submit="Save" pending={renameProduct.isPending}
        onClose={() => setDialog(null)} onSubmit={(n) => renameProduct.mutate(n)}
      />
      <RunsDialog
        open={dialog === 'runs'} entries={entries} sheets={rs} onClose={() => setDialog(null)}
        onRemove={(e) => setDialog({ removeRun: e })}
      />
      <Confirm
        open={dialog === 'delete'} title="Delete this report?" pending={deleteProduct.isPending}
        onClose={() => setDialog(null)} onConfirm={() => deleteProduct.mutate()}
      >
        "{prod?.name}" and its {entries.length} run{entries.length === 1 ? '' : 's'} will be deleted.
        This cannot be undone. Workbooks already exported are not affected.
      </Confirm>
      <Confirm
        open={!!removing} title="Remove this run?" pending={removeRun.isPending}
        onClose={() => setDialog('runs')} onConfirm={() => removing && removeRun.mutate(removing)}
      >
        Run {removing ? entries.indexOf(removing) + 1 : ''}, {removing?.title} on {removing?.dut.mac || 'no MAC'},
        is removed from this report. This cannot be undone; the test's own exports are not affected.
      </Confirm>
    </Box>
  )
}

// --- the spreadsheet ---------------------------------------------------------

/** FortuneSheet's toolbar, less what has no place in a test report (images,
 *  screenshots, links, data validation, the ¥ currency key). */
const TOOLBAR = [
  'undo', 'redo', 'format-painter', 'clear-format', '|',
  'percentage-format', 'number-decrease', 'number-increase', 'format', '|',
  'font', '|', 'font-size', '|', 'bold', 'italic', 'strike-through', 'underline', '|',
  'font-color', 'background', 'border', 'merge-cell', '|',
  'horizontal-align', 'vertical-align', 'text-wrap', '|',
  'freeze', 'conditionFormat', 'filter', 'quick-formula', 'search',
]
const CELL_MENU = [
  'copy', 'paste', '|', 'insert-row', 'insert-column', 'delete-row', 'delete-column', 'hide-row', 'hide-column',
  'set-row-height', 'set-column-width', '|', 'clear', 'sort', 'orderAZ', 'orderZA', 'filter', 'cell-format',
]
const HEADER_MENU = [
  'copy', 'paste', '|', 'insert-row', 'insert-column', 'delete-row', 'delete-column', 'hide-row', 'hide-column',
  'set-row-height', 'set-column-width', '|', 'clear', 'sort', 'orderAZ', 'orderZA',
]

/** The report's sheets in a read-only spreadsheet. FortuneSheet takes its
 *  data once, when it mounts, so a new version of the report (a run added or
 *  removed, another report opened) mounts a fresh one. */
function SheetGrid({ rs, version }: { rs: ReportSheets; version: string }) {
  const data = useMemo(() => toWorkbook(rs), [rs])
  // FortuneSheet sizes its canvas from the window, on the window's resize
  // event only: a pane opening beside the page, or the sidebar folding, left
  // the grid drawn at its old width. Its box changing size is told to it as
  // a window resize.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    })
    ro.observe(el)
    return () => { cancelAnimationFrame(frame); ro.disconnect() }
  }, [])
  return (
    <Box ref={box} sx={{
      flexGrow: 1, minHeight: 420, position: 'relative', borderRadius: '8px',
      // Not clipped: the toolbar's tooltips, menus and colour pickers open
      // past the box's edges, and were cut off.
      overflow: 'visible',
      border: 1, borderColor: 'divider',
      // Excel's own face whatever the app's theme: FortuneSheet has no dark
      // mode, and a spreadsheet is read on white.
      bgcolor: '#FFFFFF', colorScheme: 'light',
      ...EXCEL_SX,
    }}>
      <Workbook
        key={version}
        data={data}
        // Works like Excel: select, copy, sort, filter, type a formula,
        // format, resize. A scratch pad over the report: nothing typed here is
        // saved, and the next version of the report (or a reload) starts
        // from its data again.
        allowEdit
        showToolbar
        showFormulaBar
        showSheetTabs
        lang="en"
        currency="$"
        defaultFontSize={SHEET_FONT_PT}
        defaultRowHeight={20}
        toolbarItems={TOOLBAR}
        cellContextMenu={CELL_MENU}
        headerContextMenu={HEADER_MENU}
        // Sheets are the test types: renaming, deleting or adding one here
        // would only confuse what the export writes.
        sheetTabContextMenu={[]}
        filterContextMenu={['sort-by-asc', 'sort-by-desc', '|', 'filter-by-color', '|', 'filter-by-value']}
      />
    </Box>
  )
}

/** Every run in the report, by test sheet as the tabs show them, to remove
 *  one. A run is what one "Add to report" put in: its rows leave its sheet
 *  and its line leaves the Summary. */
function RunsDialog({ open, entries, sheets, onClose, onRemove }: {
  open: boolean
  entries: ReportEntry[]
  sheets: ReportSheets | undefined
  onClose: () => void
  onRemove: (e: ReportEntry) => void
}) {
  const number = new Map(entries.map((e, i) => [e.id, i + 1]))
  const byId = new Map(entries.map((e) => [e.id, e]))
  // The sheets' grouping; before it has loaded, one list in report order.
  const groups = sheets?.sheets.length
    ? sheets.sheets.map((s) => ({ name: s.name, runs: s.entry_ids.flatMap((id) => byId.get(id) ?? []) }))
    : [{ name: '', runs: entries }]
  return (
    <ModalShell open={open} onClose={onClose} title="Remove test results" maxWidth="sm"
      footer={{ primary: <Button variant="outlined" color="inherit" onClick={onClose}>Done</Button> }}>
      <Stack spacing={2}>
        {groups.filter((g) => g.runs.length).map((g) => (
          <Box key={g.name}>
            {g.name && (
              <Typography sx={{ ...TEXT.label, fontWeight: 600, mb: 0.5 }}>
                {g.name}
                <Box component="span" sx={{ ...TEXT.hint, color: 'text.secondary', ml: 1 }}>
                  {g.runs.length} run{g.runs.length === 1 ? '' : 's'}
                </Box>
              </Typography>
            )}
            <Stack divider={<Divider />} sx={{ border: 1, borderColor: 'divider', borderRadius: '8px', px: 1.5 }}>
              {g.runs.map((e) => {
                const r = entryResult(e.summary)
                const n = number.get(e.id)
                return (
                  <Stack key={e.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.75 }}>
                    <Typography sx={{ ...TEXT.label, width: 28, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                      {n}
                    </Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ ...TEXT.label, fontFamily: 'monospace' }}>
                        {e.dut.mac || 'no MAC'}
                        {e.dut.nickname && (
                          <Box component="span" sx={{ fontFamily: 'inherit', color: 'text.secondary', ml: 1 }}>
                            {e.dut.nickname}
                          </Box>
                        )}
                      </Typography>
                      <Typography noWrap sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                        {[e.added_at.replace('T', ' '), `${e.summary.points} point${e.summary.points === 1 ? '' : 's'}`, r]
                          .filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    <Tooltip title="Remove this run's results from the report">
                      <IconButton size="small" aria-label={`Remove run ${n}`} onClick={() => onRemove(e)}>
                        <DeleteIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )
              })}
            </Stack>
          </Box>
        ))}
      </Stack>
    </ModalShell>
  )
}

// --- pieces ----------------------------------------------------------------

function EmptyState({ onNew, error }: { onNew: () => void; error: string | null }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 10, textAlign: 'center' }}>
      <GridIcon sx={{ color: 'text.secondary', fontSize: 40, mb: 1 }} />
      <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {error ? 'Could not load reports' : 'Build your first report'}
      </Typography>
      <Typography sx={{ ...TEXT.label, fontWeight: 400, color: 'text.secondary', maxWidth: 440 }}>
        {error ?? 'A report gathers the test runs you add from each test\'s results, for one product: a sheet per test type, one table each, exported as an Excel workbook.'}
      </Typography>
      {!error && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={onNew} sx={{ ...actionSx(ACTION_W.wide), mt: 1 }}>
          New report
        </Button>
      )}
    </Stack>
  )
}

function Confirm({ open, title, pending, onClose, onConfirm, children }: {
  open: boolean
  title: string
  pending: boolean
  onClose: () => void
  onConfirm: () => void
  children: React.ReactNode
}) {
  return (
    <ModalShell
      open={open} onClose={onClose} title={title} maxWidth="xs"
      footer={{
        secondary: <Button variant="outlined" color="inherit" onClick={onClose}>Cancel</Button>,
        primary: (
          <Button variant="contained" color="error" disabled={pending}
            startIcon={pending ? <KeySpinner /> : <DeleteIcon />} onClick={onConfirm}>
            {title.startsWith('Delete') ? 'Delete' : 'Remove'}
          </Button>
        ),
      }}
    >
      <Typography sx={{ ...TEXT.label, fontWeight: 400 }}>{children}</Typography>
    </ModalShell>
  )
}

function NameDialog({ open, title, label, initial, placeholder, submit, pending, onClose, onSubmit }: {
  open: boolean
  title: string
  label: string
  initial: string
  placeholder?: string
  submit: string
  pending: boolean
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
          <LabeledField name="name" autoFocus label={label} defaultValue={initial} placeholder={placeholder} />
        </Box>
      )}
    </ModalShell>
  )
}
