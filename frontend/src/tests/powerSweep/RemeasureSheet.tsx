import { useMemo, useRef, useState } from 'react'
import { Box, Button, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../../context/ThemeModeContext'
import { MONO, PRESS_SX, SegmentedChoice, TEXT } from '../../ui'
import { formatDuration } from '../../lib/async'
import type { ResultRow } from '../../types/models'
import { configsInTabs, tabCounts, type SweepConfigPoint } from './remeasure'

const PA_OPTIONS = [
  { value: '0' as const, label: 'Off' },
  { value: '1' as const, label: 'On' },
  { value: '2' as const, label: 'Auto' },
]

/** Height of the tallest bar in the strip. */
const BAR_MAX_H = 44

/**
 * Remeasure part of a sweep by the power it measured: pick a span of the
 * export's per-level tabs and run just those configurations again, usually
 * with the PA on -- swept with it off, the power the sweep measured is the
 * power that will go into the PA, so limiting it there limits the PA's input.
 *
 * A sheet off the toolbar key, laid out as the other settings sheets: the
 * tabs as a strip of bars (how many configurations each holds), the chosen
 * span lit in the accent; the span as two whole-dBm fields; the PA mode;
 * then one line of what will run and the key that runs it. Click a bar for
 * one tab, or drag across bars for a span.
 */
export function RemeasureSheet({
  anchor, onClose, rows, source, defaultPaMode, estimateMs, onRun,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  rows: ResultRow[]
  /** Where the rows came from, for the Run sheet: a file name or "previous run". */
  source: string
  defaultPaMode: number
  /** Planned duration of a run of this many steps. */
  estimateMs: (steps: number) => number
  onRun: (configs: SweepConfigPoint[], range: { from: number; to: number }, paMode: number) => void
}) {
  const pal = useAppPalette()
  const tabs = useMemo(() => tabCounts(rows), [rows])
  const minTab = tabs[0]?.tab ?? 0
  const maxTab = tabs[tabs.length - 1]?.tab ?? 0
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [paMode, setPaMode] = useState<string | null>(null)
  // Defaults follow the rows: the whole measured span, PA on.
  const lo = Math.max(minTab, Math.min(from ?? minTab, maxTab))
  const hi = Math.max(minTab, Math.min(to ?? maxTab, maxTab))
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  const pa = paMode ?? String(defaultPaMode === 0 ? 1 : defaultPaMode)
  const configs = useMemo(() => configsInTabs(rows, a, b), [rows, a, b])
  const countByTab = new Map(tabs.map((t) => [t.tab, t.count]))
  const peak = Math.max(1, ...tabs.map((t) => t.count))
  const allTabs = tabs.length ? Array.from({ length: maxTab - minTab + 1 }, (_, i) => minTab + i) : []

  // Drag across the strip: the press fixes one end, the bars crossed move
  // the other. Pointer capture would pin events to the first bar, so the
  // bars listen for entry while the button is held instead.
  const dragFrom = useRef<number | null>(null)
  const press = (t: number) => { dragFrom.current = t; setFrom(t); setTo(t) }
  const cross = (t: number, buttons: number) => {
    if (dragFrom.current == null || !(buttons & 1)) return
    setFrom(Math.min(dragFrom.current, t))
    setTo(Math.max(dragFrom.current, t))
  }

  const field = (label: string, value: number, set: (v: number) => void) => (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <Typography sx={{ ...TEXT.label, color: 'text.secondary' }}>{label}</Typography>
      <TextField
        size="small" type="number" value={value}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value))
          if (Number.isFinite(v)) set(v)
        }}
        inputProps={{ step: 1, min: minTab, max: maxTab, 'aria-label': `${label} (dBm)` }}
        sx={{
          width: 76, '& .MuiInputBase-root': { height: 30 },
          '& input': { fontFamily: MONO, fontSize: 12.5, py: 0.5, px: 1, textAlign: 'right' },
        }}
      />
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>dBm</Typography>
    </Stack>
  )

  return (
    <Popover
      open={!!anchor}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            mt: 0.75, width: 420, p: 2, borderRadius: '12px', border: 1, borderColor: 'divider',
            boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
          },
        },
      }}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
        Remeasure by measured power
      </Typography>
      <Typography noWrap sx={{ ...TEXT.micro, color: 'text.secondary', mb: 1.75 }}>
        Configurations from {source}, by the export’s per-level tabs
      </Typography>

      {/* The tabs, as bars. Labels under every bar would crowd past a dozen
          tabs, so only the ends and the chosen span's ends are numbered. */}
      <Box
        sx={{ borderRadius: '10px', bgcolor: alpha(pal.sidebar.text, 0.045), px: 1.25, pt: 1.25, pb: 0.75, userSelect: 'none' }}
        onPointerUp={() => { dragFrom.current = null }}
        onPointerLeave={() => { dragFrom.current = null }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: BAR_MAX_H }}>
          {allTabs.map((t) => {
            const n = countByTab.get(t) ?? 0
            const on = t >= a && t <= b
            return (
              <Tooltip key={t} title={`${t} dBm · ${n} configuration${n === 1 ? '' : 's'}`} placement="top" disableInteractive>
                <Box
                  onPointerDown={(e) => { e.preventDefault(); press(t) }}
                  onPointerEnter={(e) => cross(t, e.buttons)}
                  sx={{
                    flex: 1, minWidth: 0, cursor: 'pointer', height: '100%',
                    display: 'flex', alignItems: 'flex-end',
                  }}
                >
                  <Box sx={{
                    width: '100%', borderRadius: '3px 3px 1px 1px',
                    height: n ? Math.max(4, (n / peak) * BAR_MAX_H) : 2,
                    bgcolor: on ? pal.actions.primary.bg : alpha(pal.sidebar.text, n ? 0.22 : 0.1),
                    transition: 'background-color 120ms ease-out',
                  }} />
                </Box>
              </Tooltip>
            )
          })}
        </Box>
        <Box sx={{ display: 'flex', gap: '3px', mt: 0.5 }}>
          {allTabs.map((t) => (
            <Typography
              key={t}
              sx={{
                flex: 1, minWidth: 0, textAlign: 'center', fontFamily: MONO, fontSize: 10, lineHeight: '14px',
                color: t === a || t === b ? 'text.primary' : 'text.disabled',
                fontWeight: t === a || t === b ? 600 : 400,
                visibility: t === minTab || t === maxTab || t === a || t === b ? 'visible' : 'hidden',
              }}
            >
              {t}
            </Typography>
          ))}
        </Box>
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
        {field('From', a, (v) => setFrom(v))}
        {field('To', b, (v) => setTo(v))}
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
        <Typography sx={{ ...TEXT.label, color: 'text.secondary' }}>PA mode</Typography>
        <SegmentedChoice text aria-label="PA mode for the remeasure" value={pa as '0' | '1' | '2'} options={PA_OPTIONS} onChange={setPaMode} />
      </Stack>

      <Box sx={{ mt: 1.75, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 13 }}>
          <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>{configs.length}</Box>
          {' '}configuration{configs.length === 1 ? '' : 's'} measured {a} to {b} dBm
          {configs.length > 0 && (
            <Box component="span" sx={{ color: 'text.secondary' }}> · ≈ {formatDuration(estimateMs(configs.length))}</Box>
          )}
        </Typography>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mt: 0.25 }}>
          The rerun replaces the results table. Export it first to keep it.
        </Typography>
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
          <Button size="small" onClick={onClose} sx={{ ...PRESS_SX, height: 32 }}>Cancel</Button>
          <Button
            size="small" variant="contained" disableElevation
            disabled={configs.length === 0}
            onClick={() => onRun(configs, { from: a, to: b }, Number(pa))}
            sx={{ ...PRESS_SX, height: 32, minWidth: 132 }}
          >
            Remeasure {configs.length || ''}
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
