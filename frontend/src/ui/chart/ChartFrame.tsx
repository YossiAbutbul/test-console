/**
 * The shared chart frame: a sized host for a Recharts chart, and the toolbar
 * that exports it and edits its view options.
 *
 * Both TX automation's results graph and the Mode Sweep's best-settings curve
 * used to carry their own copy of this — one with a PNG export and axis
 * controls, the other with neither — and their colours were hardcoded for the
 * light theme. One frame keeps the two in step.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Box, Divider, FormControlLabel, IconButton, Popover, Stack, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import DownloadIcon from '@mui/icons-material/Download'
import { ResponsiveContainer } from 'recharts'
import { parseBound } from './chartOptions'
import type { ChartHandle } from './useChart'

interface ChartFrameProps {
  chart: ChartHandle
  /** A Recharts chart element (`<LineChart>` etc.). */
  children: ReactElement
  /** Fixed height in px. Omit to fill the remaining height of a flex column. */
  height?: number
}

/** Hosts the chart at full width and gives the PNG export its DOM handle. */
export function ChartFrame({ chart, children, height }: ChartFrameProps) {
  // Registered from an effect rather than passing `chart.attach` as the ref:
  // the React Compiler lint reads a ref prop taken off an object as a ref
  // read during render and rejects it.
  const box = useRef<HTMLDivElement | null>(null)
  const { attach } = chart
  useEffect(() => {
    attach(box.current)
    return () => attach(null)
  }, [attach])
  return (
    <Box
      ref={box}
      sx={height != null ? { height } : { flexGrow: 1, minHeight: 0 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </Box>
  )
}

/** A labelled switch styled like the frame's own Grid/Legend toggles, for
 *  chart-specific options passed through `ChartToolbar`'s `toggles`. */
export function ChartSwitch({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <FormControlLabel
      control={<Switch size="small" checked={checked} onChange={(_, c) => onChange(c)} />}
      label={<Typography sx={{ fontSize: 13 }}>{label}</Typography>}
    />
  )
}

interface ChartToolbarProps {
  chart: ChartHandle
  /** Usually `() => chart.exportPng(name, legend)`; the caller owns the file
   *  name and which series are worth naming. */
  onDownload: () => void | Promise<void>
  /** Disable the export, e.g. with nothing plotted. */
  disabled?: boolean
  /** Hide the Legend switch on a chart that draws no legend. */
  legendToggle?: boolean
  /** Extra controls shown under the Y range (sliders and the like). */
  controls?: ReactNode
  /** Extra switches shown after Grid / Legend — use `ChartSwitch`. */
  toggles?: ReactNode
  /** Called by "Reset to defaults" after the frame's own options reset, so
   *  the caller can reset the extras too. */
  onReset?: () => void
}

/** Download-as-PNG and graph-options buttons, sized for a dialog title row. */
export function ChartToolbar({
  chart, onDownload, disabled, legendToggle = true, controls, toggles, onReset,
}: ChartToolbarProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { opts, setOpt } = chart

  return (
    <>
      <Tooltip title="Download as PNG">
        {/* span: a disabled button fires no events, so the tooltip needs a
            live element to hang from. */}
        <span>
          <IconButton
            size="small"
            onClick={() => { void onDownload() }}
            disabled={disabled}
            aria-label="Download as PNG"
          >
            <DownloadIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Graph options">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Graph options">
          <TuneIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 2, width: 280 } } }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
          Graph options
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" type="number" label="Y min"
              value={opts.yMin ?? ''}
              placeholder="auto"
              onChange={(e) => setOpt('yMin', parseBound(e.target.value))}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small" type="number" label="Y max"
              value={opts.yMax ?? ''}
              placeholder="auto"
              onChange={(e) => setOpt('yMax', parseBound(e.target.value))}
              sx={{ flex: 1 }}
            />
          </Stack>

          {controls}

          <Divider />

          <ChartSwitch label="Grid" checked={opts.showGrid} onChange={(c) => setOpt('showGrid', c)} />
          {legendToggle && (
            <ChartSwitch label="Legend" checked={opts.showLegend} onChange={(c) => setOpt('showLegend', c)} />
          )}
          {toggles}

          <Divider />
          <Box>
            <Typography
              component="button"
              onClick={() => { chart.reset(); onReset?.() }}
              sx={{
                fontSize: 12, color: 'primary.main', textAlign: 'left',
                background: 'none', border: 0, cursor: 'pointer', p: 0,
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Reset to defaults
            </Typography>
          </Box>
        </Stack>
      </Popover>
    </>
  )
}
