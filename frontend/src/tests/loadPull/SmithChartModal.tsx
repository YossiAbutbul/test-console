import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import {
  Box, ButtonBase, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Popover, Stack,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ContentCopyIcon from '@mui/icons-material/ContentCopyRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import TuneIcon from '@mui/icons-material/TuneRounded'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { useAppPalette, useThemeMode } from '../../context/ThemeModeContext'
import { MONO, MiniAction, PRESS_SX, SegmentedChoice, TEXT } from '../../ui'
import { TOP_BAR_H } from '../../ui/tokens'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { Z0, VCC, RAMP, reflection, dbmToW, efficiency, rampColor, chartRows } from './smith'
import { pointStats, type Extreme, type MetricStats, type PointStats } from './smithStats'

interface Pt {
  x: number; y: number
  gr: number; gi: number
  idx: number // index in the whole run, so idx + 1 matches the results table's #
  row: LoadPullResultRow
  eff: number | null // drain efficiency (fraction), null if not computable
}

/** How the chart is drawn, kept between sessions. */
interface SmithStyle {
  /** The trombone path joining each attenuator setting's points. */
  lines: boolean
  /** The constant-R and constant-X circles. */
  grid: boolean
  dot: 's' | 'm' | 'l'
  /** Efficiency ramp, or one colour per attenuator setting. */
  color: 'eff' | 'att'
}
const STYLE_DEFAULT: SmithStyle = { lines: true, grid: true, dot: 'm', color: 'eff' }
/** Dot radius at rest; a hovered dot grows by the same 2.5. */
const DOT_R = { s: 3, m: 4.5, l: 6.5 } as const

/**
 * One titled group of a settings sheet: a caption over a tinted, rounded
 * block whose rows are parted by hairlines inset to the label's edge.
 */
function SheetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const pal = useAppPalette()
  return (
    <Box sx={{ '& + &': { mt: 1.5 } }}>
      <Typography
        sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', color: 'text.secondary', px: 1, mb: 0.5 }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          borderRadius: '10px', bgcolor: alpha(pal.sidebar.text, 0.045),
          '& > * + *': {
            position: 'relative',
            '&::before': {
              content: '""', position: 'absolute', top: 0, left: 12, right: 0,
              height: '1px', bgcolor: alpha(pal.sidebar.text, 0.08),
            },
          },
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** A sheet row: label left, control right, one height whatever the control.
 *  With `htmlFor` the whole row is the label, so the text toggles a switch. */
function SheetRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <Box
      component={htmlFor ? 'label' : 'div'}
      htmlFor={htmlFor}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
        minHeight: 40, pl: 1.5, pr: 1, cursor: htmlFor ? 'pointer' : 'default',
      }}
    >
      <Typography sx={{ fontSize: 13 }}>{label}</Typography>
      {children}
    </Box>
  )
}

/** The readings the stats card sums up: label, unit, and how a value is
 *  printed. */
const STAT_COLS = [
  { key: 'pout', label: 'Pout', unit: 'dBm', fmt: (v: number) => v.toFixed(1) },
  { key: 'eff', label: 'Eff', unit: '%', fmt: (v: number) => (v * 100).toFixed(1) },
  { key: 'cc', label: 'CC', unit: 'mA', fmt: (v: number) => (v * 1000).toFixed(0) },
] as const
type StatKey = (typeof STAT_COLS)[number]['key']

/** Width of the detail column: the point card and, under it, Statistics. */
const DETAIL_W = 340
/** Label, range bar, then Min / Avg / Max: one grid for the head and rows,
 *  sized so the bar keeps ~90 px inside DETAIL_W. */
const STAT_GRID = '52px minmax(0, 1fr) 40px 40px 40px'

/**
 * Min, average and max of one reading at a time, for everything on the chart
 * and then per attenuator setting.
 *
 * One reading at a time, picked above the rows, rather than all three side
 * by side: nine columns of figures had to be read cell by cell to compare
 * anything. Each row's bar spans its min to max, with a tick at the average,
 * all on one scale, so how the settings spread and shift reads before any
 * number does. A min or max names the point it came from and, hovered, lights
 * that dot -- the best and worst loads are what the figures are read for.
 */
function StatsCard({
  groups, results, onHover,
}: {
  groups: Array<{ key: string; label: string; color: string; stats: PointStats }>
  results: LoadPullResultRow[]
  onHover: (idx: number | null) => void
}) {
  const pal = useAppPalette()
  const [key, setKey] = useState<StatKey>('pout')
  const col = STAT_COLS.find((c) => c.key === key) ?? STAT_COLS[0]
  const metric = (g: (typeof groups)[number]): MetricStats | null => g.stats[key]
  // One scale for every row: the widest of them.
  const all = groups.map(metric).filter((m): m is MetricStats => m != null)
  const lo = all.length ? Math.min(...all.map((m) => m.min.v)) : 0
  const hi = all.length ? Math.max(...all.map((m) => m.max.v)) : 1
  const pct = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100)

  const num = {
    fontFamily: MONO, fontSize: 12, textAlign: 'right' as const, whiteSpace: 'nowrap' as const,
    fontVariantNumeric: 'tabular-nums',
  }
  const extreme = (e: Extreme | undefined) => {
    if (!e) return <Box sx={{ ...num, color: 'text.disabled' }}>—</Box>
    const r = results[e.idx]
    return (
      <Box
        title={`#${e.idx + 1}${r ? ` · ${r.pos_mm.toFixed(1)} mm` : ''}${r?.att_db != null ? ` · ${r.att_db} dB` : ''}`}
        onMouseEnter={() => onHover(e.idx)}
        onMouseLeave={() => onHover(null)}
        sx={{
          ...num, cursor: 'default', borderRadius: '4px', mx: -0.5, px: 0.5,
          '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.07), color: 'primary.main' },
        }}
      >
        {col.fmt(e.v)}
      </Box>
    )
  }

  return (
    <Box sx={{ mt: 1.5, p: 2, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.25 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flexGrow: 1 }}>
          Statistics
        </Typography>
        <SegmentedChoice
          text aria-label="Reading" value={key}
          options={STAT_COLS.map((c) => ({ value: c.key, label: c.label }))}
          onChange={(v) => setKey(v)}
        />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: STAT_GRID, columnGap: 1, alignItems: 'center' }}>
        {/* Head: the unit under the bar, so the figures carry none. */}
        <Box />
        <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{col.unit}</Typography>
        {['Min', 'Avg', 'Max'].map((h) => (
          <Typography key={h} sx={{ fontSize: 11, color: 'text.disabled', textAlign: 'right' }}>{h}</Typography>
        ))}

        {groups.map((g, i) => {
          const m = metric(g)
          const first = i === 0
          // The first row is the summary: weightier, and parted from the
          // per-setting rows by one hairline across the whole grid (a border
          // per cell broke at every column gap).
          const rowSx = { minHeight: 28, display: 'flex', alignItems: 'center' }
          return (
            <Box key={g.key} sx={{ display: 'contents' }}>
              {i === 1 && <Box sx={{ gridColumn: '1 / -1', height: '1px', bgcolor: 'divider', my: 0.5 }} />}
              <Box sx={rowSx}>
                <Typography
                  sx={{ fontSize: 12, fontWeight: first ? 600 : 400, color: first ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}
                >
                  {g.label}
                </Typography>
              </Box>
              <Box sx={rowSx}>
                <Box sx={{ position: 'relative', width: '100%', height: 6, borderRadius: 3, bgcolor: alpha(pal.sidebar.text, 0.07) }}>
                  {m && (
                    <>
                      <Box
                        sx={{
                          position: 'absolute', top: 0, bottom: 0, borderRadius: 3,
                          left: `${pct(m.min.v)}%`,
                          // A setting whose points all read the same still shows.
                          width: `max(6px, ${pct(m.max.v) - pct(m.min.v)}%)`,
                          bgcolor: alpha(g.color, first ? 0.85 : 0.55),
                        }}
                      />
                      <Box
                        title={`avg ${col.fmt(m.avg)} ${col.unit} over ${m.n} points`}
                        sx={{
                          position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1,
                          left: `calc(${pct(m.avg)}% - 1px)`, bgcolor: 'text.primary',
                        }}
                      />
                    </>
                  )}
                </Box>
              </Box>
              <Box sx={{ ...rowSx, justifyContent: 'flex-end' }}>{extreme(m?.min)}</Box>
              <Box sx={{ ...rowSx, justifyContent: 'flex-end' }}>
                <Box sx={{ ...num, color: m ? 'text.secondary' : 'text.disabled' }}>{m ? col.fmt(m.avg) : '—'}</Box>
              </Box>
              <Box sx={{ ...rowSx, justifyContent: 'flex-end' }}>{extreme(m?.max)}</Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** Point-list rows rendered beyond each edge of the view. */
const LIST_OVERSCAN = 10
/** Height of one point-list row before the first is measured. */
const LIST_ROW_H_GUESS = 26

/**
 * One plotted point.
 *
 * Memoised, as is ListRow: the dialog stays open through a run to watch it
 * live, and each new row used to rebuild every dot and every list row --
 * 233 ms a row at 890 rows, and growing -- which piled garbage on a tab that
 * then crashed mid-run. Now a new row adds one dot, and the rest re-render
 * only when their own colour or hover changes.
 */
const Dot = memo(function Dot({
  x, y, idx, r, fill, stroke, hover, onHover,
}: {
  x: number; y: number; idx: number; r: number; fill: string; stroke: string; hover: boolean
  onHover: (idx: number | null) => void
}) {
  return (
    <circle
      cx={x} cy={y}
      r={hover ? r + 2.5 : r}
      fill={fill}
      stroke={stroke}
      strokeWidth={hover ? 2 : 0.8}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(idx)}
    />
  )
})

/** Shared by every list row, so they resolve to one class between them. */
const LIST_ROW_SX = {
  px: 1.25, py: 0.5, cursor: 'default',
  fontFamily: MONO, fontSize: 12,
  '&:hover': { bgcolor: 'action.hover' },
  '&[data-on="true"]': { bgcolor: 'action.selected' },
} as const

/** One row of the point list. See Dot for why it is memoised. */
const ListRow = memo(function ListRow({
  pt, color, hasAtt, on, onHover, rowRef,
}: {
  pt: Pt; color: string; hasAtt: boolean; on: boolean
  onHover: (idx: number | null) => void
  rowRef?: Ref<HTMLDivElement>
}) {
  return (
    <Stack
      ref={rowRef}
      direction="row"
      data-on={on}
      onMouseEnter={() => onHover(pt.idx)}
      onMouseLeave={() => onHover(null)}
      sx={LIST_ROW_SX}
    >
      <Box sx={{ width: 26, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {/* The same colour the point carries on the chart, so a row and
            its dot are findable from each other. A plain style: the colour
            changes with the efficiency range, and in `sx` every new value
            would be a generated class. */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
        }} />
        {pt.idx + 1}
      </Box>
      <Box sx={{ flex: 1, textAlign: 'left' }}>{pt.row.pos_mm.toFixed(1)}</Box>
      {/* Every attenuation is on the chart at once, so the
          list is where a dot says which cycle it came from. */}
      {hasAtt && (
        <Box sx={{ flex: 0.8, textAlign: 'left' }}>
          {pt.row.att_db == null ? '—' : pt.row.att_db}
        </Box>
      )}
      <Box sx={{ flex: 1.2, textAlign: 'left' }}>
        {pt.row.r_ohm == null || pt.row.x_ohm == null
          ? '—'
          : `${pt.row.r_ohm.toFixed(0)}${pt.row.x_ohm >= 0 ? '+' : '−'}j${Math.abs(pt.row.x_ohm).toFixed(0)}`}
      </Box>
      <Box sx={{ flex: 1, textAlign: 'left' }}>
        {pt.row.power_dbm == null ? '—' : pt.row.power_dbm.toFixed(1)}
      </Box>
      <Box sx={{ flex: 0.9, textAlign: 'left' }}>
        {pt.eff == null ? '—' : `${(pt.eff * 100).toFixed(1)}%`}
      </Box>
    </Stack>
  )
})

/**
 * One view control: a caption, then the value.
 *
 * The caption sits beside the select rather than floating above it. A floating
 * MUI label notches the outline and reserves a row of space for two words,
 * which is what made the header top-heavy.
 */
function Picker({
  label, unit, value, options, onChange,
}: {
  label: string
  unit: string
  value: number | null
  options: number[]
  onChange: (v: number) => void
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <TextField
        select
        size="small"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        inputProps={{ 'aria-label': `${label} (${unit})` }}
        sx={{
          minWidth: 96,
          '& .MuiInputBase-root': { height: 32 },
          '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5, py: 0.5 },
        }}
      >
        {/* Bare numbers — the unit is stated once, after the control. */}
        {options.map((o) => (
          <MenuItem key={o} value={o} sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            {o}
          </MenuItem>
        ))}
      </TextField>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>{unit}</Typography>
    </Stack>
  )
}

/**
 * Which attenuator settings are on the chart, as a checklist. Every setting
 * belongs on one chart (sweeping it is what moves the load), but with a dozen
 * trajectories overlaid, comparing two or three of them meant reading
 * through the rest.
 */
function AttPicker({
  options, hidden, onChange,
}: {
  options: number[]
  hidden: ReadonlySet<number>
  onChange: (hidden: Set<number>) => void
}) {
  const shown = options.filter((o) => !hidden.has(o))
  const label = shown.length === options.length ? 'All'
    : shown.length === 0 ? 'None'
    : shown.join(', ')
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        Att
      </Typography>
      <TextField
        select
        size="small"
        // The value is the settings shown; `renderValue` writes them out.
        value={shown}
        SelectProps={{
          multiple: true,
          renderValue: () => label,
          MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } },
        }}
        onChange={(e) => {
          const v = e.target.value as unknown as Array<number | 'all' | 'none'>
          // "All" and "None" are rows of the list, so they arrive as values.
          if (v.includes('all')) return onChange(new Set())
          if (v.includes('none')) return onChange(new Set(options))
          const on = new Set(v as number[])
          onChange(new Set(options.filter((o) => !on.has(o))))
        }}
        inputProps={{ 'aria-label': 'Attenuator settings shown (dB)' }}
        sx={{
          minWidth: 96, maxWidth: 220,
          '& .MuiInputBase-root': { height: 32 },
          '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5, py: 0.5 },
        }}
      >
        {/* A rule under these rather than a Divider, which a select's
            list takes for one more option. The settings carry the theme's
            own tick when shown. */}
        <MenuItem value="all" dense sx={{ fontSize: 12.5 }}>Show all</MenuItem>
        <MenuItem value="none" dense sx={{ fontSize: 12.5, borderBottom: 1, borderColor: 'divider', mb: 0.5 }}>
          Hide all
        </MenuItem>
        {options.map((o) => (
          <MenuItem key={o} value={o} dense sx={{ fontFamily: MONO, fontSize: 12.5 }}>
            {o}
          </MenuItem>
        ))}
      </TextField>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>dB</Typography>
    </Stack>
  )
}

export function SmithChartModal({
  open, onClose, results, keepToolbar,
}: {
  open: boolean
  onClose: () => void
  results: LoadPullResultRow[]
  /** Stop below the toolbar instead of covering it -- pass while a run is on. */
  keepToolbar?: boolean
}) {
  // Grid, ink and ground come from the theme like every other chart, rather
  // than blue-grey values of the chart's own that read as a different product.
  const pal = useAppPalette()
  const { mode } = useThemeMode()
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Point list windowing: only the rows in view are rendered.
  const listRef = useRef<HTMLDivElement | null>(null)
  const listRowRef = useRef<HTMLDivElement | null>(null)
  const [listTop, setListTop] = useState(0)
  const [listH, setListH] = useState(400)
  const [listRowH, setListRowH] = useState(LIST_ROW_H_GUESS)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null)
  const [savedStyle, setStyle] = usePersistedState<SmithStyle>(STORAGE_KEYS.smithStyle, STYLE_DEFAULT)
  // Spread over the defaults, so a style saved before a field existed reads it.
  const style = { ...STYLE_DEFAULT, ...savedStyle }
  const isDefaultStyle = (Object.keys(STYLE_DEFAULT) as Array<keyof SmithStyle>)
    .every((k) => style[k] === STYLE_DEFAULT[k])
  const setStyleOpt = <K extends keyof SmithStyle>(k: K, v: SmithStyle[K]) => setStyle({ ...style, [k]: v })
  // Which slice of the run to plot. A run sweeps frequency and power at every
  // trombone position, and plotting all of them at once would put several
  // unrelated load-pull contours on one chart.
  const [pickedFreq, setPickedFreq] = useState<number | null>(null)
  const [pickedPower, setPickedPower] = useState<number | null>(null)

  const freqs = useMemo(
    () => [...new Set(results.map((r) => r.freq_mhz).filter((f): f is number => f != null))]
      .sort((a, b) => a - b),
    [results],
  )
  const powers = useMemo(
    () => [...new Set(results.map((r) => r.power_dbm_setting).filter((p): p is number => p != null))]
      .sort((a, b) => a - b),
    [results],
  )
  /** Present only when the run swept the attenuator; drives the extra column. */
  const hasAtt = useMemo(() => results.some((r) => r.att_db != null), [results])
  const atts = useMemo(
    () => [...new Set(results.map((r) => r.att_db).filter((a): a is number => a != null))]
      .sort((a, b) => a - b),
    [results],
  )
  // The settings taken off, rather than those kept, so a setting a run
  // reaches after the filter was set still shows up.
  const [hiddenAtt, setHiddenAtt] = useState<ReadonlySet<number>>(() => new Set())

  // Default to the first of each once results arrive, and re-anchor if the
  // current pick is not in the data (a new run, or an imported file).
  const freq = pickedFreq != null && freqs.includes(pickedFreq) ? pickedFreq : freqs[0] ?? null
  const power = pickedPower != null && powers.includes(pickedPower) ? pickedPower : powers[0] ?? null

  // Each row keeps its index in the whole run, so "Step N" here is "#N" in
  // the results table. The filtering rules are documented on chartRows.
  const shown = useMemo(
    () => chartRows(results, freq, power, hiddenAtt),
    [results, freq, power, hiddenAtt],
  )
  // Everything shown, then each attenuator setting shown -- the same slice
  // as the chart, so the figures are of the dots on it.
  const statSlices = useMemo(() => {
    const out: Array<{ key: string; label: string; att: number | null; stats: PointStats }> = [
      { key: 'all', label: atts.length > 1 ? 'All shown' : 'All', att: null, stats: pointStats(shown) },
    ]
    if (atts.length > 1) {
      for (const a of atts) {
        if (hiddenAtt.has(a)) continue
        out.push({ key: `att-${a}`, label: `${a} dB`, att: a, stats: pointStats(shown.filter(({ row }) => row.att_db === a)) })
      }
    }
    return out
  }, [shown, atts, hiddenAtt])

  const S = 520
  const R = S / 2 - 24
  const cx = S / 2
  const cy = S / 2

  const points: Pt[] = useMemo(() => {
    const out: Pt[] = []
    shown.forEach(({ row, idx }) => {
      if (row.r_ohm == null || row.x_ohm == null) return
      const { gr, gi } = reflection(row.r_ohm, row.x_ohm)
      if (!Number.isFinite(gr) || !Number.isFinite(gi)) return
      out.push({
        x: cx + gr * R, y: cy - gi * R,
        gr, gi, idx, row, eff: efficiency(row),
      })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  // Efficiency color domain from the finite values present.
  const effDomain = useMemo(() => {
    const vals = points.map((p) => p.eff).filter((e): e is number => e != null)
    if (vals.length === 0) return null
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [points])

  /**
   * Points grouped into the runs that are actually continuous.
   *
   * The trombone travels from one end to the other once per attenuator setting,
   * so consecutive points share a path only while the setting does.
   */
  const traces = useMemo(() => {
    const out: Array<{ key: string; pts: Pt[] }> = []
    for (const pt of points) {
      const key = pt.row.att_db == null ? 'single' : `att-${pt.row.att_db}`
      const last = out[out.length - 1]
      if (last && last.key === key) last.pts.push(pt)
      else out.push({ key, pts: [pt] })
    }
    return out
  }, [points])

  const pathC = pal.sidebar.textDim
  const effSpan = effDomain ? effDomain.max - effDomain.min : 0
  // Three points that differ only in the noise still print the same figure
  // at both ends, and a full colour ramp between two identical numbers reads
  // as though the colours mean something. Compare the rendered values.
  const effFlat = effDomain != null
    && (effDomain.min * 100).toFixed(1) === (effDomain.max * 100).toFixed(1)

  const effColor = (eff: number | null): string => {
    if (eff == null || !effDomain) return pal.sidebar.successOff
    // Every point measured the same: colour carries no information, so use one
    // neutral tone rather than painting them all at the ramp's cold end.
    if (effSpan === 0 || effFlat) return rampColor(0.5)
    return rampColor((eff - effDomain.min) / effSpan)
  }
  // By attenuator only when there is more than one setting to tell apart.
  // Each setting keeps its colour (its place among all the run's settings)
  // whichever are filtered off, so 4 dB is the same colour alone as among
  // the rest.
  const byAtt = style.color === 'att' && atts.length > 1
  const attColor = (att: number | null | undefined): string =>
    att == null ? pathC : pal.chart.series[Math.max(0, atts.indexOf(att)) % pal.chart.series.length]
  const colorOf = (pt: Pt): string => (byAtt ? attColor(pt.row.att_db) : effColor(pt.eff))
  const shownAtts = atts.filter((a) => !hiddenAtt.has(a))

  const grid = pal.chart.grid
  const axis = pal.chart.axis

  const rCircles = [0, 0.2, 0.5, 1, 2, 5].map((r) => ({
    cx: cx + (r / (1 + r)) * R, cy, rr: (1 / (1 + r)) * R,
  }))
  const xArcs = [0.2, 0.5, 1, 2, 5].flatMap((x) => [x, -x]).map((x) => ({
    cx: cx + 1 * R, cy: cy - (1 / x) * R, rr: Math.abs(1 / x) * R,
  }))

  /**
   * Copy the chart and its efficiency scale to the clipboard as a PNG.
   *
   * The point list and the formula card are deliberately left out — they are
   * reading aids for this dialog, not part of the figure someone pastes into a
   * report.
   *
   * The chart is SVG and the scale is HTML, so the two are composed onto a
   * canvas here rather than screenshotted: the scale is redrawn from the same
   * RAMP the dots are coloured from, which keeps them in step.
   */
  const copyChart = async () => {
    const svg = svgRef.current
    if (!svg) return
    const SCALE = 2                       // for a legible paste on a HiDPI screen
    const LEGEND_H = 34
    try {
      const xml = new XMLSerializer().serializeToString(svg)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('could not rasterise the chart'))
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
      })

      const canvas = document.createElement('canvas')
      canvas.width = S * SCALE
      canvas.height = (S + LEGEND_H) * SCALE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.scale(SCALE, SCALE)
      // Opaque: a transparent PNG pasted onto a dark slide loses the grid.
      ctx.fillStyle = pal.paper
      ctx.fillRect(0, 0, S, S + LEGEND_H)
      ctx.drawImage(img, 0, 0, S, S)

      // The legend, mirroring what the dialog shows.
      const ink = pal.sidebar.textDim
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      const y = S + LEGEND_H / 2
      ctx.fillStyle = ink
      ctx.fillText(byAtt ? 'Att (dB)' : 'Efficiency', 8, y)
      if (byAtt) {
        let lx = 76
        for (const a of shownAtts) {
          ctx.fillStyle = attColor(a)
          ctx.beginPath()
          ctx.arc(lx + 4, y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = ink
          ctx.fillText(String(a), lx + 12, y)
          lx += 12 + ctx.measureText(String(a)).width + 14
        }
      } else if (effDomain == null) {
        ctx.fillText('not computable', 76, y)
      } else if (effFlat) {
        ctx.fillText(`${(effDomain.min * 100).toFixed(1)}% at every point`, 76, y)
      } else {
        const lo = `${(effDomain.min * 100).toFixed(1)}%`
        const hi = `${(effDomain.max * 100).toFixed(1)}%`
        const barX = 76 + ctx.measureText(lo).width + 8
        const barW = S - barX - ctx.measureText(hi).width - 16
        ctx.fillText(lo, 76, y)
        const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0)
        RAMP.forEach((c, i) => grad.addColorStop(i / (RAMP.length - 1), c))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(barX, y - 5, barW, 10, 5)
        ctx.fill()
        ctx.fillStyle = ink
        ctx.fillText(hi, barX + barW + 8, y)
      }

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('could not encode the image')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied('done')
    } catch {
      // Clipboard writes need a secure context and permission; say so rather
      // than looking like nothing happened.
      setCopied('failed')
    }
    window.setTimeout(() => setCopied('idle'), 2000)
  }

  const hp = hover != null ? points.find((p) => p.idx === hover) ?? null : null

  // Row and view heights, measured rather than assumed.
  useLayoutEffect(() => {
    const h = listRowRef.current?.getBoundingClientRect().height
    if (h && Math.abs(h - listRowH) > 0.5) setListRowH(h)
    const vh = listRef.current?.clientHeight
    if (vh && vh !== listH) setListH(vh)
  }, [listRowH, listH, points.length, open])
  // The scroll position is taken from each new list as it mounts. Closing the
  // dialog unmounts the list but kept `listTop`, so a list scrolled before
  // closing reopened at the top while the window still drew rows from further
  // down: blank until a scroll caught `listTop` up. Reading it on `open` was
  // too early -- the dialog's portal mounts its contents a commit later.
  const attachList = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el
    if (el) setListTop(el.scrollTop)
  }, [])
  const listFirst = Math.max(0, Math.floor(listTop / listRowH) - LIST_OVERSCAN)
  const listLast = Math.min(points.length, listFirst + Math.ceil(listH / listRowH) + LIST_OVERSCAN * 2)
  const dotStroke = mode === 'light' ? alpha(pal.sidebar.text, 0.35) : pal.paper
  const fmtPct = (e: number | null) => (e == null ? '—' : `${(e * 100).toFixed(1)} %`)

  return (
    <Dialog
      open={open} onClose={onClose} maxWidth="lg" fullWidth
      // Below the toolbar, scrim included, while a run is on: a scrim over
      // the whole window hid E-STOP and Stop behind it. Focus is not held
      // inside either, so the keyboard can reach them too. With no run the
      // scrim covers the toolbar like any dialog -- an undimmed strip read as
      // the dialog having missed it.
      sx={{ top: keepToolbar ? TOP_BAR_H : 0 }}
      disableEnforceFocus={keepToolbar}
      slotProps={{
        // A little past "lg" (1200): list, chart and the detail column with
        // its Statistics card side by side, without squeezing the chart.
        paper: { sx: { height: '88vh', maxWidth: 1280 } },
        backdrop: { sx: { top: keepToolbar ? TOP_BAR_H : 0 } },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography sx={TEXT.dialog}>Smith chart</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {points.length} point{points.length === 1 ? '' : 's'} · Z₀ = {Z0} Ω
          </Typography>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        {/* The dialog's one action, so accent; fixed width so the three
            labels it cycles through never move the close key beside it. */}
        <Tooltip title="Graph options">
          <IconButton
            size="small" onClick={(e) => setStyleAnchor(e.currentTarget)}
            aria-label="Graph options" sx={{ mr: 0.5 }}
          >
            <TuneIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        {/* A settings sheet in the macOS manner: inset groups of uniform
            rows, the label on the left and its control on the right, so the
            eye runs down one edge for names and the other for values. It was
            switches glued to their labels on the left and the pickers on the
            right, two alignments in one short list. Grows from the key that
            opened it. */}
        <Popover
          open={!!styleAnchor}
          anchorEl={styleAnchor}
          onClose={() => setStyleAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              sx: {
                mt: 0.75, width: 300, p: 1.5, borderRadius: '12px',
                border: 1, borderColor: 'divider',
                boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
              },
            },
          }}
        >
          <Stack direction="row" alignItems="center" sx={{ px: 0.5, mb: 1.25 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Graph options</Typography>
            {/* Quiet, and only live when there is something to reset. */}
            <ButtonBase
              onClick={() => setStyle(STYLE_DEFAULT)}
              disabled={isDefaultStyle}
              sx={{
                ...PRESS_SX, fontSize: 12, fontWeight: 500, borderRadius: '6px', px: 0.75, py: 0.25,
                color: 'primary.main', '&.Mui-disabled': { color: 'text.disabled' },
                '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.06) },
              }}
            >
              Reset
            </ButtonBase>
          </Stack>

          <SheetGroup title="Display">
            <SheetRow label="Connecting lines" htmlFor="smith-opt-lines">
              <Switch
                id="smith-opt-lines" size="small" checked={style.lines}
                onChange={(_e, c) => setStyleOpt('lines', c)}
              />
            </SheetRow>
            <SheetRow label="Grid" htmlFor="smith-opt-grid">
              <Switch
                id="smith-opt-grid" size="small" checked={style.grid}
                onChange={(_e, c) => setStyleOpt('grid', c)}
              />
            </SheetRow>
          </SheetGroup>

          <SheetGroup title="Points">
            <SheetRow label="Size">
              <SegmentedChoice
                text aria-label="Dot size" value={style.dot}
                options={[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]}
                onChange={(v) => setStyleOpt('dot', v)}
              />
            </SheetRow>
            {/* Attenuator only means something on a run that swept it. */}
            <SheetRow label="Colour by">
              <SegmentedChoice
                text aria-label="Colour by" value={atts.length > 1 ? style.color : 'eff'}
                options={[{ value: 'eff', label: 'Efficiency' }, { value: 'att', label: 'Att' }]}
                onChange={(v) => setStyleOpt('color', v)}
                disabled={atts.length < 2}
              />
            </SheetRow>
          </SheetGroup>
        </Popover>
        <MiniAction
          startIcon={copied === 'done' ? <CheckRoundedIcon /> : <ContentCopyIcon />}
          onClick={() => void copyChart()}
          disabled={points.length === 0}
          color={copied === 'failed' ? 'error' : 'primary'}
          sx={{ mr: 1, width: 112, justifyContent: 'flex-start' }}
        >
          {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy chart'}
        </MiniAction>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      {/* View controls, on their own strip rather than crammed into the title.
          Captions sit beside each control instead of floating above it: a
          floating label notches the outline and makes the header taller than
          the two words it holds. */}
      {(freqs.length > 1 || powers.length > 1 || atts.length > 1) && (
        <Stack
          direction="row"
          spacing={2.5}
          alignItems="center"
          sx={{ px: 3, py: 1.25, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap' }}
        >
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            Showing
          </Typography>
          {freqs.length > 1 && (
            <Picker
              label="Freq" unit="MHz" value={freq}
              options={freqs} onChange={setPickedFreq}
            />
          )}
          {powers.length > 1 && (
            <Picker
              label="Power" unit="dBm" value={power}
              options={powers} onChange={setPickedPower}
            />
          )}
          {atts.length > 1 && (
            <AttPicker options={atts} hidden={hiddenAtt} onChange={setHiddenAtt} />
          )}

          <Box sx={{ flexGrow: 1 }} />

        </Stack>
      )}

      <DialogContent
        dividers
        sx={{ bgcolor: 'action.hover', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {points.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 6, textAlign: 'center' }}>
            No R/J data to plot. Run the test first.
          </Typography>
        ) : (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={3}
            justifyContent="center"
            alignItems="flex-start"
            sx={{ flexGrow: 1, minHeight: 0 }}
          >
            {/* Point list, on the opposite side from the hover card.
                Stacked under the card it moved every time the card grew from
                the placeholder to a measurement, so the row under the cursor
                slid out from under it. Its own column cannot be pushed. */}
            {points.length > 0 && (
              <Box sx={{
                width: 290, flexShrink: 0,
                // Grows with the list and stops at the row's height — a short
                // run gets a short box, a long one fills the dialog and scrolls
                // inside. Fixing the height instead left rows at the top of an
                // otherwise empty panel.
                maxHeight: '100%',
                display: 'flex', flexDirection: 'column', minHeight: 0,
                borderRadius: 1.5, border: 1, borderColor: 'divider',
                bgcolor: 'background.paper', overflow: 'hidden',
              }}>
                <Stack
                  direction="row"
                  sx={{
                    px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider',
                    ...TEXT.micro, color: 'text.disabled', fontWeight: 700,
                  }}
                >
                  <Box sx={{ width: 26 }}>#</Box>
                  <Box sx={{ flex: 1, textAlign: 'left' }}>Pos</Box>
                  {hasAtt && <Box sx={{ flex: 0.8, textAlign: 'left' }}>Att</Box>}
                  <Box sx={{ flex: 1.2, textAlign: 'left' }}>Z (Ω)</Box>
                  <Box sx={{ flex: 1, textAlign: 'left' }}>Pout</Box>
                  <Box sx={{ flex: 0.9, textAlign: 'left' }}>Eff</Box>
                </Stack>
                {/* No height of its own: it is as tall as its rows, and the
                    cap above turns that into a scroll once the dialog runs out
                    of room. Scrolling beats losing the chart to a table. */}
                <Box
                  ref={attachList}
                  onScroll={(e) => setListTop(e.currentTarget.scrollTop)}
                  sx={{ minHeight: 0, overflowY: 'auto' }}
                >
                  {/* Only the rows in view; the spacers stand in for the rest
                      so the scrollbar is the whole list's. */}
                  <div style={{ height: listFirst * listRowH }} />
                  {points.slice(listFirst, listLast).map((pt, j) => (
                    <ListRow
                      key={pt.idx}
                      pt={pt}
                      color={colorOf(pt)}
                      hasAtt={hasAtt}
                      on={pt.idx === hover}
                      onHover={setHover}
                      rowRef={j === 0 ? listRowRef : undefined}
                    />
                  ))}
                  <div style={{ height: (points.length - listLast) * listRowH }} />
                </Box>
              </Box>
            )}

            {/* Chart + legend */}
            <Box sx={{ flexShrink: 0 }}>
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                width={S} height={S} viewBox={`0 0 ${S} ${S}`}
                style={{ maxWidth: '100%' }}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <clipPath id="smith-clip"><circle cx={cx} cy={cy} r={R} /></clipPath>
                </defs>
                <g clipPath="url(#smith-clip)" fill="none" strokeWidth={1}>
                  {style.grid && rCircles.map((c, i) => <circle key={`r${i}`} cx={c.cx} cy={c.cy} r={c.rr} stroke={grid} />)}
                  {style.grid && xArcs.map((c, i) => <circle key={`x${i}`} cx={c.cx} cy={c.cy} r={c.rr} stroke={grid} />)}
                  <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={axis} strokeWidth={1.25} />
                </g>
                <circle cx={cx} cy={cy} r={R} fill="none" stroke={axis} strokeWidth={1.75} />

                {/* Trajectory — one line per attenuator setting.
                    Each setting is its own trombone cycle, so a single polyline
                    joined the end of one cycle to the start of the next and drew
                    a chord straight across the chart that no measurement made. */}
                {style.lines && traces.map((trace) => (
                  <polyline
                    key={trace.key}
                    points={trace.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke={byAtt ? attColor(trace.pts[0].row.att_db) : pathC}
                    strokeWidth={1.25} strokeOpacity={0.6}
                  />
                ))}

                {/* points colored by efficiency */}
                {points.map((p) => {
                  const isHover = p.idx === hover
                  return (
                    <Dot
                      key={p.idx}
                      x={p.x} y={p.y} idx={p.idx} r={DOT_R[style.dot]}
                      fill={colorOf(p)}
                      // On white the paper-coloured edge vanished and the pale
                      // yellow end of the ramp went with it; a faint ink edge
                      // keeps every dot findable whatever its colour.
                      stroke={isHover ? pal.sidebar.text : dotStroke}
                      hover={isHover}
                      onHover={setHover}
                    />
                  )
                })}
                <circle cx={cx} cy={cy} r={2} fill={axis} />
              </svg>

              {/* Efficiency legend.
                  A single point — or several that all measured the same — has
                  no range to ramp across, and printing "1.2% ——— 1.2%" invited
                  the reading that the colours meant something here. Say the one
                  value instead. */}
              {/* One line tall whichever legend, so switching the colouring
                  does not move the chart. */}
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, px: 0.5, minHeight: 18 }}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {byAtt ? 'Att' : 'Efficiency'}
                </Typography>
                {byAtt ? (
                  <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, overflow: 'hidden' }}>
                    {shownAtts.map((a) => (
                      <Stack key={a} direction="row" alignItems="center" spacing={0.5}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: attColor(a) }} />
                        <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                          {a}
                        </Typography>
                      </Stack>
                    ))}
                    <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>dB</Typography>
                  </Stack>
                ) : effDomain == null ? (
                  <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
                    not computable — needs power and current
                  </Typography>
                ) : effFlat ? (
                  <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                    {(effDomain.min * 100).toFixed(1)}% at every point
                  </Typography>
                ) : (
                  <>
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                      {(effDomain.min * 100).toFixed(1)}%
                    </Typography>
                    <Box sx={{
                      flexGrow: 1, height: 10, borderRadius: 5,
                      background: `linear-gradient(to right, ${RAMP.join(', ')})`,
                    }} />
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                      {(effDomain.max * 100).toFixed(1)}%
                    </Typography>
                  </>
                )}
              </Stack>

            </Box>

            {/* Detail column: the hovered point in full, then every plotted
                point in brief. The list is the reason this dialog is wide —
                the chart shows the shape of the contour, but the numbers behind
                each point were previously reachable one hover at a time. */}
            {/* Wider than the list opposite: it carries the Statistics card
                too, whose bars want room to read as ranges. */}
            <Box sx={{ width: DETAIL_W, flexShrink: 0 }}>
              {/* Both layouts are always laid out in one cell, the idle one
                  hidden, so the card is the measurement's height from the
                  start and does not grow and shrink as the cursor crosses
                  points. */}
              <Box sx={{
                p: 2, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
                display: 'grid',
              }}>
                <Box sx={{ gridArea: '1 / 1', visibility: hp ? 'visible' : 'hidden' }} aria-hidden={!hp}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                    Measurement
                  </Typography>
                  <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>
                    {hp ? `Step ${hp.idx + 1} · pos ${hp.row.pos_mm.toFixed(2)} mm` : '—'}
                  </Typography>
                  <Stack spacing={0.75}>
                    <Row label="Efficiency" value={fmtPct(hp?.eff ?? null)} strong color={hp ? effColor(hp.eff) : undefined} />
                    <Row label="Pout" value={hp?.row.power_dbm == null ? '—' : `${hp.row.power_dbm.toFixed(2)} dBm`} />
                    <Row label="Pout (W)" value={hp?.row.power_dbm == null ? '—' : dbmToW(hp.row.power_dbm).toFixed(3)} />
                    <Row label="Icc" value={hp?.row.current_a == null ? '—' : `${(hp.row.current_a * 1000).toFixed(1)} mA`} />
                    <Row label="Z" value={hp?.row.r_ohm == null || hp.row.x_ohm == null ? '—'
                      : `${hp.row.r_ohm.toFixed(1)} ${hp.row.x_ohm >= 0 ? '+' : '−'} j${Math.abs(hp.row.x_ohm).toFixed(1)} Ω`} />
                    <Row label="|S11|" value={hp?.row.s11_db == null ? '—' : `${hp.row.s11_db.toFixed(2)} dB`} />
                    <Row label="Γ" value={hp ? `${hp.gr.toFixed(3)} ${hp.gi >= 0 ? '+' : '−'} j${Math.abs(hp.gi).toFixed(3)}` : '—'} />
                    {/* Reserved for the whole run once any row has one, so
                        moving between cycles does not add and drop a line. */}
                    {hasAtt && (
                      <Row label="Attenuator" value={hp?.row.att_db == null ? '—' : `${hp.row.att_db} dB`} />
                    )}
                    <Row label="Pos (pulses)" value={hp ? hp.row.pos_pulses.toLocaleString() : '—'} />
                  </Stack>
                  {hp?.row.error && (
                    <Typography sx={{ fontSize: 12, color: 'error.main', mt: 1 }}>{hp.row.error}</Typography>
                  )}
                </Box>
                <Box sx={{ gridArea: '1 / 1', visibility: hp ? 'hidden' : 'visible' }} aria-hidden={!!hp}>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
                    Hover a point to see its measurement. Color = efficiency:
                  </Typography>
                  <EfficiencyFormula vcc={VCC} />
                </Box>
              </Box>

              {/* Under the point card: the figures for the whole slice beside
                  the one for the point under the cursor, the two read
                  together. Bars in each setting's own colour when the chart
                  is coloured by it, so a row and its dots are matched by eye. */}
              <StatsCard
                groups={statSlices.map((g) => ({
                  ...g, color: byAtt && g.att != null ? attColor(g.att) : pal.actions.primary.bg,
                }))}
                results={results}
                onHover={setHover}
              />

            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  )
}

const FORMULA_SERIF = '"Cambria Math", "Latin Modern Math", Cambria, Georgia, "Times New Roman", serif'

const Sub = ({ children }: { children: string }) => (
  <Box component="span" sx={{ fontSize: '0.62em', verticalAlign: 'sub', fontStyle: 'normal' }}>{children}</Box>
)

/** η = P_out / (V_cc · I_cc), rendered as a stacked fraction like a math editor. */
function EfficiencyFormula({ vcc }: { vcc: number }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      fontFamily: FORMULA_SERIF, fontStyle: 'italic',
      fontSize: 22, color: 'text.primary',
      px: 1, py: 0.5,
    }}>
      <Box component="span" sx={{ fontStyle: 'normal' }}>eff</Box>
      <Box component="span" sx={{ fontStyle: 'normal' }}>=</Box>
      {/* fraction */}
      <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
        <Box component="span" sx={{ px: 0.75, whiteSpace: 'nowrap' }}>
          P<Sub>out</Sub>
          <Box component="span" sx={{ fontStyle: 'normal', fontSize: '0.6em', ml: 0.5 }}>[W]</Box>
        </Box>
        <Box sx={{ width: '100%', borderTop: 1, borderColor: 'text.primary', my: 0.25 }} />
        <Box component="span" sx={{ px: 0.75, whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ fontStyle: 'normal' }}>{vcc}</Box>
          <Box component="span" sx={{ fontStyle: 'normal', fontSize: '0.6em', mx: 0.25 }}>[V]</Box>
          <Box component="span" sx={{ fontStyle: 'normal', mx: 0.5 }}>·</Box>
          I<Sub>cc</Sub>
          <Box component="span" sx={{ fontStyle: 'normal', fontSize: '0.6em', ml: 0.5 }}>[A]</Box>
        </Box>
      </Box>
    </Box>
  )
}

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={2}>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{
        fontSize: strong ? 14 : 12.5, fontWeight: strong ? 700 : 500,
        fontFamily: MONO,
        color: color ?? 'text.primary',
      }}>
        {value}
      </Typography>
    </Stack>
  )
}
