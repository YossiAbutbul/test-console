/**
 * A chart block: the chart as it prints, and -- while the block is selected --
 * an inspector that says what it plots. The inspector floats under the chart
 * over the page rather than in it, so choosing a chart never moves the page
 * or re-flows its sheets; Word gets only the chart (a Word chart of the same
 * numbers, backend/reports/chart_docx.py).
 */
import type { ReactNode } from 'react'
import { Box, ButtonBase, InputBase, MenuItem, Select, Typography } from '@mui/material'
import type { ReportBlock, ReportEntry } from '../../api/reports'
import { SegmentedChoice } from '../../ui'
import { defaultAxes, numericColumns } from './chartData'
import { ReportChart } from './ReportChart'
import { Resizable } from './Resizable'
import { PAPER, PAPER_TYPE as T, SERIES } from './paperStyle'

const KINDS = [
  { value: 'line' as const, label: 'Line' },
  { value: 'scatter' as const, label: 'Points' },
  { value: 'bar' as const, label: 'Bars' },
]

/** A control's well: white, a hairline, the focus ring of the system. */
const WELL = {
  height: 32, borderRadius: '8px', bgcolor: '#FFFFFF', fontSize: 13, color: '#1D1D1F',
  boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 0.5px 1px rgba(0, 0, 0, 0.05)',
  transition: 'box-shadow 120ms ease',
  '&.Mui-focused': { boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 0 0 3px rgba(0, 113, 227, 0.28)' },
  '& .MuiSelect-select, & input': { px: 1.25, py: 0, lineHeight: '32px', minHeight: 0 },
} as const

function Field({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0, flex: grow ? 1 : undefined }}>
      <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, color: '#6E6E73', letterSpacing: '0.01em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

export function ChartView({ block, runs, number, selected, onPatch, onResize }: {
  block: ReportBlock
  /** The product's runs, in print order. */
  runs: ReportEntry[]
  number: Map<string, number>
  selected: boolean
  onPatch: (p: Partial<ReportBlock>, record?: boolean) => void
  onResize: (width: number, phase: 'start' | 'move' | 'end') => void
}) {
  const e = runs.find((r) => r.id === block.entry_id)
  const nums = e ? numericColumns(e) : []
  const plottable = nums.filter((i) => i !== block.x)
  const runName = (r: ReportEntry) => `${number.get(r.id) ?? '–'}. ${r.title}`
  const menu = { slotProps: { paper: { sx: { borderRadius: '10px', mt: 0.5 } } } }

  const inspector = (
    <Box
      // Clicks here set the chart; they must not start a block drag.
      onPointerDown={(ev) => ev.stopPropagation()}
      sx={{
        position: 'absolute', left: 0, right: 0, top: 'calc(100% + 10px)', zIndex: 6,
        display: 'grid', gap: 1.5, p: 1.5,
        borderRadius: '14px',
        bgcolor: 'rgba(246, 246, 248, 0.86)',
        backdropFilter: 'blur(20px) saturate(180%)',
        border: '0.5px solid rgba(0, 0, 0, 0.1)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        transformOrigin: '50% 0%',
        animation: 'chartInspectorIn 180ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        '@keyframes chartInspectorIn': { from: { opacity: 0, transform: 'translateY(-4px) scale(0.98)' }, to: { opacity: 1, transform: 'none' } },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: '#F6F6F8', backdropFilter: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="Run" grow>
          <Select variant="standard" disableUnderline displayEmpty value={e ? e.id : ''} sx={{ ...WELL, minWidth: 200 }}
            MenuProps={menu}
            renderValue={(v) => (v ? runName(runs.find((r) => r.id === v)!) : <Box component="span" sx={{ color: '#8E8E93' }}>Choose a run</Box>)}
            onChange={(ev) => {
              const r = runs.find((x) => x.id === ev.target.value)
              if (!r) return
              const a = defaultAxes(r)
              onPatch({ entry_id: r.id, x: a.x, ys: a.ys, text: block.text || r.title })
            }}>
            {runs.length === 0 && <MenuItem disabled value="">No runs in this report yet</MenuItem>}
            {runs.map((r) => <MenuItem key={r.id} value={r.id} sx={{ fontSize: 13 }}>{runName(r)}</MenuItem>)}
          </Select>
        </Field>
        {e && (
          <>
            <Field label="Across">
              <Select variant="standard" disableUnderline value={block.x} sx={{ ...WELL, minWidth: 140 }} MenuProps={menu}
                onChange={(ev) => onPatch({ x: Number(ev.target.value) })}>
                {e.columns.map((c, i) => <MenuItem key={i} value={i} sx={{ fontSize: 13 }}>{c}</MenuItem>)}
              </Select>
            </Field>
            <Field label="Style">
              <SegmentedChoice text size="md" aria-label="Chart style" value={block.kind} options={KINDS}
                onChange={(kind) => onPatch({ kind })} />
            </Field>
          </>
        )}
      </Box>
      {e && (
        <>
          <Field label="Title">
            <InputBase value={block.text} placeholder="No title" sx={WELL}
              onChange={(ev) => onPatch({ text: ev.target.value }, false)} />
          </Field>
          <Field label="Plotted">
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {plottable.map((i) => {
                const on = block.ys.includes(i)
                const color = on ? SERIES[block.ys.indexOf(i) % SERIES.length] : '#C7C7CC'
                return (
                  <ButtonBase key={i} disableRipple aria-pressed={on}
                    onClick={() => onPatch({ ys: on ? block.ys.filter((y) => y !== i) : [...block.ys, i] })}
                    sx={{
                      height: 28, px: 1.25, gap: 0.75, borderRadius: '14px', fontSize: 12.5, fontWeight: 500,
                      color: on ? '#1D1D1F' : '#6E6E73',
                      bgcolor: on ? `${color}1F` : '#FFFFFF',
                      boxShadow: on ? `inset 0 0 0 1px ${color}55` : 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.16)',
                      transition: 'background-color 140ms ease, box-shadow 140ms ease, transform 100ms ease',
                      '&:hover': { bgcolor: on ? `${color}29` : '#F2F2F7' },
                      '&:active': { transform: 'scale(0.96)' },
                    }}>
                    <Box sx={{
                      width: 9, height: 9, borderRadius: '50%', bgcolor: on ? color : 'transparent',
                      boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${color}`, transition: 'background-color 140ms ease',
                    }} />
                    {e.columns[i]}
                  </ButtonBase>
                )
              })}
              {!plottable.length && (
                <Typography sx={{ fontSize: 12.5, color: '#6E6E73' }}>This run has no other number columns</Typography>
              )}
            </Box>
          </Field>
        </>
      )}
    </Box>
  )

  return (
    <Box sx={{ position: 'relative' }}>
      {e ? (
        <Resizable width={block.width} onResize={onResize} align="center" min={30}>
          <ReportChart entry={e} x={block.x} ys={block.ys} kind={block.kind} title={block.text} svgId={block.id} />
        </Resizable>
      ) : (
        <Box sx={{ border: '1.5px dashed #C7C7CC', borderRadius: '10px', bgcolor: '#FAFAFB', py: 4, textAlign: 'center' }}>
          <Typography sx={{ ...T.body, fontWeight: 600 }}>Chart</Typography>
          <Typography sx={{ ...T.small, color: PAPER.muted }}>
            {selected ? 'Choose the run to plot below' : 'Select this chart, then choose the run to plot'}
          </Typography>
        </Box>
      )}
      {selected && inspector}
    </Box>
  )
}
