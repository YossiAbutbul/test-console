/**
 * The report as it will print, in the lab's RF report style: each block
 * drawn the way backend/reports/docx_export.py writes it -- navy Calibri
 * headings, tables with a light blue header row and black rules, the cover
 * with the logo and the product in large navy type -- so the canvas is a
 * preview, not a form about a document.
 *
 * Paper stays paper in the dark themes, as a document does in Pages: these
 * colours are the printed page's, not the app's (paperStyle.ts).
 */
import { useRef, useState, type ReactNode } from 'react'
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography, type SxProps, type Theme } from '@mui/material'
import ImageIcon from '@mui/icons-material/AddPhotoAlternateRounded'
import CloseIcon from '@mui/icons-material/CloseRounded'
import AddIcon from '@mui/icons-material/AddRounded'
import { entryResult, reportsApi, type ReportBlock, type ReportEntry, type ReportProduct } from '../../api/reports'
import { dragHasFiles, imageFiles } from './images'
import { Resizable } from './Resizable'
import { RichText } from './RichText'
import { plain } from './rich'
import { PAGE, PAPER, PAPER_TYPE as T, dotDate, resultColor, unitLabel, when } from './paperStyle'

// --- tables --------------------------------------------------------------------

/** The report's table: black rules, a light blue header row, centred cells
 *  in the table face; a parameter table's first column left (and bold). */
function Grid({ columns, rows, failRows, colorCol, maxRows, firstLeft, firstBold, widths, fill }: {
  columns: ReactNode[]
  rows: ReactNode[][]
  failRows?: boolean[]
  colorCol?: (row: number, col: number) => string | undefined
  maxRows?: number
  firstLeft?: boolean
  firstBold?: boolean
  widths?: string[]
  /** The table's name and its block's labels: a row filled from the format
   *  bar is labels["fill:<name>:<row>"] ("fill:<name>_h" the header), and
   *  each row says which it is (data-fill-key) for the bar to find. */
  fill?: { name: string; labels: Record<string, string> }
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows
  /** A row's chosen fill: a colour, 'none' for none at all, or undefined
   *  for the row's own (the header's blue, a failed row's red). */
  const fillOf = (key: string) => (fill ? fill.labels[`fill:${key}`] || undefined : undefined)
  const bg = (key: string | undefined, own: string | undefined) => {
    const v = key ? fillOf(key) : undefined
    return v === 'none' ? 'transparent' : v ?? own
  }
  const headKey = fill ? `${fill.name}_h` : undefined
  const cell: SxProps<Theme> = {
    ...T.cell, px: 1, py: 0.9, border: `1px solid ${PAPER.line}`, textAlign: 'center', verticalAlign: 'middle',
  }
  return (
    <Box sx={{ overflowX: 'auto', mb: 2 }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>}
        <thead>
          <tr data-fill-key={headKey}>
            {columns.map((c, i) => (
              <Box component="th" key={i} sx={{ ...cell, fontWeight: 700, bgcolor: bg(headKey, PAPER.headFill) }}>{c}</Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <Box component="tr" key={ri} data-fill-key={fill ? `${fill.name}:${ri}` : undefined}
              sx={{ bgcolor: bg(fill && `${fill.name}:${ri}`, failRows?.[ri] ? PAPER.failFill : undefined) }}>
              {r.map((v, ci) => {
                const color = colorCol?.(ri, ci)
                const first = ci === 0 && firstLeft
                return (
                  <Box component="td" key={ci} sx={{
                    ...cell, textAlign: first ? 'left' : 'center',
                    fontWeight: (ci === 0 && firstBold) || color ? 700 : 400,
                    ...(color ? { color } : null),
                  }}>
                    {v}
                  </Box>
                )
              })}
            </Box>
          ))}
        </tbody>
      </Box>
      {maxRows && rows.length > maxRows && (
        <Typography sx={{ ...T.small, mt: 0.5 }}>
          {rows.length - maxRows} more row{rows.length - maxRows === 1 ? '' : 's'}, all of them in the Word file
        </Typography>
      )}
    </Box>
  )
}

// --- editable words ----------------------------------------------------------

/** Words that edit in place: the block is its own text box. */
export function PaperText({ value, onChange, placeholder, sx, multiline, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  sx: SxProps<Theme>
  multiline?: boolean
  autoFocus?: boolean
}) {
  return (
    <RichText value={value} onChange={onChange} placeholder={placeholder} multiline={multiline}
      autoFocus={autoFocus} label={placeholder} sx={sx} />
  )
}

/** The block's own words, by key, and how to change one. */
export interface Labels {
  labels: Record<string, string>
  onLabel: (key: string, value: string) => void
}

/** A value changed from what the run measured: a faint underline, on screen
 *  only, so a reworded cell can be told from a measured one. */
const EDITED = { textDecoration: 'underline dotted rgba(0, 113, 227, 0.6)', textUnderlineOffset: '3px' } as const

/**
 * One of the page's fixed words -- "Summary:", "Results:", a field name, a
 * table cell -- that the operator may reword or format. It reads as the
 * printed word, not a field: only a soft tint under the pointer says it can
 * be typed into. Emptied, it goes back to its default, which is also what
 * Word prints for it.
 */
export function Label({ k, fallback, labels, onLabel, sx, align, multiline, inline }: Labels & {
  k: string
  fallback: string
  sx: SxProps<Theme>
  align?: 'left' | 'center'
  multiline?: boolean
  inline?: boolean
}) {
  const own = labels[k]
  const edited = own !== undefined && own !== fallback
  return (
    <RichText
      value={own ?? fallback} multiline={multiline} align={align} inline={inline}
      label={`${fallback.split('\n')[0] || k} (editable)`}
      onChange={(v) => onLabel(k, v)}
      onBlur={(v) => { if (!plain(v).trim()) onLabel(k, '') }}
      sx={{ ...(sx as object), ...(edited ? EDITED : null) }}
    />
  )
}

/** A table cell's value, editable: it takes the cell's colour and weight. */
function CellText({ k, fallback, labels, onLabel, align = 'center' }: Labels & { k: string; fallback: string; align?: 'left' | 'center' }) {
  return (
    <Label k={k} fallback={fallback} labels={labels} onLabel={onLabel} align={align} multiline
      sx={{ ...T.cell, color: 'inherit', fontWeight: 'inherit' }} />
  )
}

/** A word that sizes to its text, for a label followed by its value on one
 *  line ("Tested By: Yossi"). */
function InlineLabel({ k, fallback, labels, onLabel, sx }: Labels & { k: string; fallback: string; sx: SxProps<Theme> }) {
  return (
    <Box sx={{ flexShrink: 0 }}>
      <Label k={k} fallback={fallback} labels={labels} onLabel={onLabel} sx={sx} inline />
    </Box>
  )
}

// --- pages ---------------------------------------------------------------------

/** The logo in the header of every page after the cover, in the margin as
 *  the Word file places it. */
export function HeaderLogo({ logoId }: { logoId: string | null | undefined }) {
  if (!logoId) return null
  return (
    <Box component="img" src={reportsApi.imageUrl(logoId)} alt="Logo" draggable={false}
      sx={{ display: 'block', width: PAGE.headerLogo, ml: '-32px', mb: 2 }} />
  )
}

/** Where a page ends early. The sheets draw the page edges themselves; this
 *  marks the break, so it can be selected, moved or removed. */
export function PageBreakView() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
      <Box sx={{ flex: 1, borderTop: `1px dashed ${PAPER.soft}` }} />
      <Typography sx={{ ...T.small, color: '#8E8E93', letterSpacing: '0.02em' }}>Page break</Typography>
      <Box sx={{ flex: 1, borderTop: `1px dashed ${PAPER.soft}` }} />
    </Box>
  )
}

// --- cover -------------------------------------------------------------------

export function CoverView({ prod, block, logoId, onPickLogo, onFiles, onResize, busy, labels, onLabel }: Labels & {
  prod: ReportProduct
  block: ReportBlock
  logoId: string | null | undefined
  onPickLogo: () => void
  onFiles: (files: File[]) => void
  onResize: (width: number, phase: 'start' | 'move' | 'end') => void
  busy: boolean
}) {
  const ops = [...new Set(prod.entries.map((e) => e.operator).filter(Boolean))]
  const dates = prod.entries.map((e) => e.added_at).sort()
  const date = dates.length ? dotDate(dates[dates.length - 1]) : dotDate(new Date().toISOString())
  const name = labels.title ?? prod.name
  const size = plain(name).length <= 16 ? T.title.fontSize : plain(name).length <= 26 ? (46 * 4) / 3 : (36 * 4) / 3
  const lines: Array<[string, string, string]> = [['tested_by', 'Tested By:', ops.join(', ') || '-'], ['date', 'Date:', date]]
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ textAlign: 'center', mt: 0.5, mb: 4 }}>
        {logoId ? (
          <Box component="img" src={reportsApi.imageUrl(logoId)} alt="Logo" draggable={false}
            sx={{ width: PAGE.coverLogo, maxWidth: '100%' }} />
        ) : (
          <Button variant="outlined" startIcon={<ImageIcon />} onPointerDown={(e) => e.stopPropagation()} onClick={onPickLogo}>
            Add your logo
          </Button>
        )}
      </Box>
      <Label k="title" fallback={prod.name} labels={labels} onLabel={onLabel} multiline align="center"
        sx={{ ...T.title, fontSize: size }} />
      <Box sx={{ mt: 0.5, mb: 2 }}>
        <Label k="subtitle" fallback="RF Test Report" labels={labels} onLabel={onLabel} sx={T.subtitle} align="center" />
      </Box>
      <Box sx={{ mb: 3 }}>
        <ImageView compact imageId={block.image_id} width={block.width} caption="" onCaption={() => {}}
          noCaption onFiles={onFiles} onResize={onResize} busy={busy} prompt="Add a cover photo" />
      </Box>
      {lines.map(([k, label, value]) => (
        <Box key={k} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <InlineLabel k={`${k}_label`} fallback={label} labels={labels} onLabel={onLabel}
            sx={{ ...T.coverLine, fontWeight: 700 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Label k={k} fallback={value} labels={labels} onLabel={onLabel} sx={T.coverLine} />
          </Box>
        </Box>
      ))}
      {prod.notes.trim() && (
        <Typography sx={{ ...T.body, mt: 2, whiteSpace: 'pre-wrap' }}>{prod.notes}</Typography>
      )}
    </Box>
  )
}

// --- runs ----------------------------------------------------------------------

export function SummaryView({ ordered, number, labels, onLabel }: Labels & { ordered: ReportEntry[]; number: Map<string, number> }) {
  return (
    <Box>
      <Box sx={{ mb: 1 }}><Label k="title" fallback="Summary:" labels={labels} onLabel={onLabel} sx={T.h2} /></Box>
      {ordered.length === 0 ? (
        <Typography sx={{ ...T.small, mb: 2 }}>No runs in this report yet.</Typography>
      ) : (
        <Grid
          columns={['#', 'Test', 'Unit', 'Added', 'Points', 'Pass', 'Fail', 'Result'].map((h, ci) => (
            <CellText key={ci} k={`sum_h:${ci}`} fallback={h} labels={labels} onLabel={onLabel} />
          ))}
          widths={['5%', '21%', '24%', '19%', '8%', '7%', '7%', '9%']}
          rows={ordered.map((e, ri) => {
            const r = entryResult(e.summary)
            return [number.get(e.id) ?? '', e.title, unitLabel(e), when(e.added_at),
              e.summary.points, e.summary.passed, e.summary.failed, r ?? '-'].map((v, ci) => (
              <CellText key={ci} k={`sum:${ri}:${ci}`} fallback={String(v)} labels={labels} onLabel={onLabel} />
            ))
          })}
          failRows={ordered.map((e) => entryResult(e.summary) === 'Fail')}
          fill={{ name: 'sum', labels }}
          colorCol={(i, c) => (c === 7 ? resultColor(entryResult(ordered[i].summary)) : undefined)}
        />
      )}
    </Box>
  )
}

export function EntryView({ e, n, showSettings, showNote, labels, onLabel }: Labels & {
  e: ReportEntry
  n: number | undefined
  showSettings: boolean
  showNote: boolean
}) {
  const r = entryResult(e.summary)
  const vi = e.columns.findIndex((c) => c.trim().toLowerCase() === 'verdict')
  const verdictOf = (row: ReportEntry['rows'][number]) => String(row[vi] ?? '').trim().toLowerCase()
  const meta = [`Unit: ${unitLabel(e)}`, `Added: ${when(e.added_at)}`, e.operator && `Operator: ${e.operator}`].filter(Boolean)
  return (
    <Box>
      {/* The number is the document's; the title is the block's to reword. */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        {n ? <Typography component="span" sx={{ ...T.h1, flexShrink: 0 }}>{n}.</Typography> : null}
        <Label k="title" fallback={e.title} labels={labels} onLabel={onLabel} sx={T.h1} />
      </Box>
      <Box sx={{ mt: 1 }}>
        <Label k="meta" fallback={meta.join('    ·    ')} labels={labels} onLabel={onLabel} sx={T.small} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 1 }}>
        <InlineLabel k="result_label" fallback="Result:" labels={labels} onLabel={onLabel} sx={{ ...T.body, fontWeight: 700 }} />
        <InlineLabel k="result" fallback={r ?? 'not judged'} labels={labels} onLabel={onLabel}
          sx={{ ...T.body, fontWeight: 700, color: resultColor(r) }} />
        <Box sx={{ flex: 1, minWidth: 0, pl: 1.5 }}>
          <Label k="result_detail" labels={labels} onLabel={onLabel} sx={T.body}
            fallback={`${e.summary.points} point${e.summary.points === 1 ? '' : 's'}`
              + (e.summary.passed || e.summary.failed ? `, ${e.summary.passed} pass, ${e.summary.failed} fail` : '')} />
        </Box>
      </Box>
      {showNote && e.note.trim() && (
        <Box sx={{ mt: 1 }}>
          <Label k="note" fallback={e.note.trim()} labels={labels} onLabel={onLabel} multiline sx={{ ...T.body, fontStyle: 'italic' }} />
        </Box>
      )}
      {showSettings && e.settings.length > 0 && (
        <>
          <Box sx={{ mt: 1.5, mb: 1 }}><Label k="settings" fallback="Settings:" labels={labels} onLabel={onLabel} sx={T.h2} /></Box>
          <Grid
            columns={['Parameter', 'Value'].map((h, ci) => (
              <CellText key={ci} k={`set_h:${ci}`} fallback={h} labels={labels} onLabel={onLabel} />
            ))}
            widths={['36%', '64%']} firstLeft firstBold fill={{ name: 'set', labels }}
            rows={e.settings.map(([k, v], ri) => [
              <CellText key="k" k={`set:${ri}:0`} fallback={k} labels={labels} onLabel={onLabel} align="left" />,
              <CellText key="v" k={`set:${ri}:1`} fallback={v} labels={labels} onLabel={onLabel} />,
            ])} />
        </>
      )}
      <Box sx={{ mt: 1.5, mb: 1 }}><Label k="results" fallback="Results:" labels={labels} onLabel={onLabel} sx={T.h2} /></Box>
      <Grid
        columns={e.columns.map((c, ci) => (
          <CellText key={ci} k={`res_h:${ci}`} fallback={c} labels={labels} onLabel={onLabel} />
        ))}
        rows={e.rows.map((row, ri) => e.columns.map((_, i) => {
          const v = row[i]
          const text = i === vi && v != null
            ? String(v).charAt(0).toUpperCase() + String(v).slice(1)
            : v == null ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)
          return <CellText key={i} k={`res:${ri}:${i}`} fallback={text} labels={labels} onLabel={onLabel} />
        }))}
        failRows={e.rows.map((row) => vi >= 0 && verdictOf(row).startsWith('fail'))}
        fill={{ name: 'res', labels }}
        colorCol={(i, c) => {
          if (c !== vi) return undefined
          const v = verdictOf(e.rows[i])
          return v.startsWith('pass') ? PAPER.pass : v.startsWith('fail') ? PAPER.fail : undefined
        }}
      />
    </Box>
  )
}

export function AllRunsView({ runs, number, onPlace }: {
  runs: ReportEntry[]
  number: Map<string, number>
  /** Place this run as a block of its own, where all of it can be edited. */
  onPlace: (entryId: string) => void
}) {
  return (
    <Box>
      <Typography sx={{ ...T.small, mb: 1 }}>
        All runs: every run not placed on its own, each on its own page. Runs added later appear here.
      </Typography>
      {runs.length === 0 ? (
        <Typography sx={{ ...T.body, color: PAPER.muted }}>No runs yet.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          {runs.map((e) => {
            const r = entryResult(e.summary)
            return (
              <Box key={e.id} sx={{
                display: 'flex', alignItems: 'baseline', gap: 1.5, px: 1.25, py: 0.9,
                border: `1px solid ${PAPER.soft}`, borderLeft: `3px solid ${PAPER.navy}`, borderRadius: '4px',
                bgcolor: r === 'Fail' ? PAPER.failFill : undefined,
              }}>
                <Typography sx={{ ...T.body, color: PAPER.navy, fontWeight: 700 }}>
                  {number.get(e.id)}. {e.title}
                </Typography>
                <Typography sx={{ ...T.small, flex: 1, minWidth: 0 }} noWrap>
                  {unitLabel(e)} · {when(e.added_at)} · {e.summary.points} points
                </Typography>
                <Typography sx={{ ...T.small, fontWeight: 700, color: resultColor(r) }}>{r ?? 'not judged'}</Typography>
                <Button size="small" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onPlace(e.id)}
                  sx={{ minWidth: 0, py: 0, fontSize: 12, alignSelf: 'center' }}>
                  Edit on its own
                </Button>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

// --- tables of the intro -----------------------------------------------------------

/** A Parameter / Value table the operator fills in, cell by cell. Rows
 *  left empty are not printed. */
export function ParamsView({ rows, onRows, labels, onLabel }: Labels & {
  rows: string[][]
  onRows: (rows: string[][], record: boolean) => void
}) {
  const cellInput = (ri: number, ci: number, bold: boolean, placeholder: string) => (
    <RichText
      multiline value={rows[ri]?.[ci] ?? ''} placeholder={placeholder} label={`${placeholder} ${ri + 1}`}
      align={ci === 0 ? 'left' : 'center'}
      onChange={(v) => onRows(rows.map((r, k) => (k === ri ? (ci === 0 ? [v, r[1] ?? ''] : [r[0] ?? '', v]) : r)), false)}
      sx={{ ...T.cell, fontWeight: bold ? 700 : 400 }}
    />
  )
  return (
    <Box>
      <Grid
        columns={[
          <Label key="c1" k="col1" fallback="Parameter" labels={labels} onLabel={onLabel} sx={{ ...T.cell, fontWeight: 700 }} align="center" />,
          <Label key="c2" k="col2" fallback="Value" labels={labels} onLabel={onLabel} sx={{ ...T.cell, fontWeight: 700 }} align="center" />,
        ]}
        widths={['43%', '57%']}
        firstLeft
        fill={{ name: 'par', labels }}
        rows={rows.map((_, ri) => [
          cellInput(ri, 0, true, 'Parameter'),
          <Box key="v" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, '&:hover .row-x': { opacity: 1 } }}>
            {cellInput(ri, 1, false, 'Value')}
            <Tooltip title="Remove row">
              <IconButton className="row-x" size="small" aria-label={`Remove row ${ri + 1}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRows(rows.filter((_, k) => k !== ri), true)}
                sx={{ opacity: 0, transition: 'opacity 120ms ease', p: 0.25 }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>,
        ])}
      />
      <Button size="small" startIcon={<AddIcon />} onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRows([...rows, ['', '']], true)} sx={{ mt: -1, mb: 1 }}>
        Add row
      </Button>
    </Box>
  )
}

/** The units the runs were measured on: one cell, one per line, as the
 *  lab's reports list their unit IDs. Follows the runs; nothing to type. */
export function UnitsView({ prod, labels, onLabel }: Labels & { prod: ReportProduct }) {
  const units = [...new Set(prod.entries.map(unitLabel))]
  return (
    <Grid
      columns={[
        <Label key="c1" k="col1" fallback="Parameter" labels={labels} onLabel={onLabel} sx={{ ...T.cell, fontWeight: 700 }} align="center" />,
        <Label key="c2" k="col2" fallback="Value" labels={labels} onLabel={onLabel} sx={{ ...T.cell, fontWeight: 700 }} align="center" />,
      ]}
      widths={['43%', '57%']}
      firstLeft
      fill={{ name: 'units', labels }}
      rows={[[
        <Label key="r" k="row" fallback="Unit IDs" labels={labels} onLabel={onLabel} sx={T.cell} />,
        <CellText key="u" k="units" fallback={units.join('\n') || 'Units appear here as runs are added'} labels={labels} onLabel={onLabel} />,
      ]]}
    />
  )
}

// --- pictures --------------------------------------------------------------------

/**
 * A picture on the page. Empty, it is a drop target that also takes a paste
 * and offers the file picker; filled, the picture at its share of the text
 * width with its caption under it, as Word will print it.
 */
export function ImageView({ imageId, width, caption, onCaption, onFiles, onResize, busy, compact, noCaption, prompt = 'Add a picture' }: {
  imageId: string | null | undefined
  width: number
  /** Drag either edge to size the picture (it stays centred). */
  onResize?: (width: number, phase: 'start' | 'move' | 'end') => void
  caption: string
  onCaption: (v: string) => void
  onFiles: (files: File[]) => void
  busy: boolean
  compact?: boolean
  noCaption?: boolean
  prompt?: string
}) {
  const pick = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const input = (
    <input ref={pick} type="file" accept="image/*" hidden
      onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f) }} />
  )
  if (!imageId) {
    return (
      <Box
        onDragOver={(e) => { if (dragHasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const f = imageFiles(e.dataTransfer)
          if (!f.length) return
          e.preventDefault(); e.stopPropagation(); setOver(false); onFiles(f.slice(0, 1))
        }}
        sx={{
          border: `1.5px dashed ${over ? '#0071E3' : '#C7C7CC'}`, borderRadius: '10px',
          bgcolor: over ? 'rgba(0, 113, 227, 0.05)' : '#FAFAFB',
          py: compact ? 2 : 4, px: 2, textAlign: 'center', transition: 'background-color 120ms ease, border-color 120ms ease',
        }}
      >
        {input}
        {busy ? (
          <CircularProgress size={22} sx={{ color: PAPER.muted }} />
        ) : (
          <>
            {!compact && <ImageIcon sx={{ fontSize: 30, color: PAPER.muted, mb: 0.5 }} />}
            <Typography sx={{ ...T.body, fontWeight: 600 }}>{prompt}</Typography>
            <Typography sx={{ ...T.small, mb: 1.25 }}>Paste it with Ctrl+V, drop a file here, or choose one</Typography>
            <Button size="small" variant="outlined" onPointerDown={(e) => e.stopPropagation()}
              onClick={() => pick.current?.click()}>
              Choose file…
            </Button>
          </>
        )}
      </Box>
    )
  }
  return (
    <Box sx={{ textAlign: 'center' }}>
      {input}
      {onResize ? (
        <Resizable width={width} onResize={onResize} align="center" min={10}>
          <Box component="img" src={reportsApi.imageUrl(imageId)} alt={caption || 'Picture'} draggable={false}
            sx={{ display: 'block', width: '100%', height: 'auto' }} />
        </Resizable>
      ) : (
        <Box component="img" src={reportsApi.imageUrl(imageId)} alt={caption || 'Picture'} draggable={false}
          sx={{ display: 'block', mx: 'auto', width: `${width}%`, height: 'auto' }} />
      )}
      {!noCaption && (
        <Box sx={{ mt: 0.75, '& input': { textAlign: 'center' } }}>
          <PaperText value={caption} onChange={onCaption} placeholder="Caption (optional)" sx={T.caption} />
        </Box>
      )}
    </Box>
  )
}
