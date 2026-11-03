import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref,
} from 'react'
import {
  Box, Button, ButtonBase, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Popover, Stack,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ContentCopyIcon from '@mui/icons-material/ContentCopyRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import TuneIcon from '@mui/icons-material/TuneRounded'
import AdsClickIcon from '@mui/icons-material/AdsClickRounded'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { useAppPalette, useThemeMode } from '../../context/ThemeModeContext'
import {
  ActivityIndicator, MONO, MiniAction, PRESS_SX, REDUCED_MOTION, SegmentedChoice, TEXT, useHeldFlag,
} from '../../ui'
import { TOP_BAR_H } from '../../ui/tokens'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import {
  Z0, VCC, EFF_BANDS, reflection, dbmToW, efficiency, rampColor, bandColor, bandOf, chartRows, deembedRows,
} from './smith'
import { SmithGrid } from './SmithGrid'
import { pointStats, type Extreme, type MetricStats, type PointStats } from './smithStats'
import { AreaFigure, type AreaView } from './AreaFigure'
import { AREA_GRID, type Quantity } from './areaCompute'
import { useWorkingArea } from './useWorkingArea'
import {
  cellGamma, impedance, type Area, type Bound, type Limits, type Sample,
} from './workingArea'

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
/** The efficiency scale in its bands, hard stops between them, as a CSS
 *  background: the point chart's legend and the working area's colour bar
 *  then step alike. */
const BANDED_GRADIENT = `linear-gradient(to right, ${Array.from({ length: EFF_BANDS }, (_, b) =>
  `${bandColor(b)} ${((b / EFF_BANDS) * 100).toFixed(2)}% ${(((b + 1) / EFF_BANDS) * 100).toFixed(2)}%`).join(', ')})`

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
/*
 * Memoised, with its groups built once per change of data: it is the
 * costliest part of the dialog to draw (~20-30 ms a pass in development),
 * and every hover, tab switch and new row used to draw it again unchanged.
 */
const StatsCard = memo(function StatsCard({
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
})

/** Stands in for `onRemeasure` when there is none, so the memoised dots and
 *  rows are handed the same function every render. */
const NO_PICK = () => {}

/** An empty reading in the point card. */
const DASH_TXT = '—'

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
  x, y, idx, r, fill, stroke, hoverStroke, hovered, onPick,
}: {
  x: number; y: number; idx: number; r: number; fill: string; stroke: string; hoverStroke: string
  /** The hovered point, held outside React state: see the dialog's
   *  `hoverStore`. Each dot asks only whether it is the one. */
  hovered: CursorStore
  onPick: (idx: number) => void
}) {
  const hover = useSyncExternalStore(hovered.subscribe, () => hovered.get() === idx)
  return (
    <circle
      cx={x} cy={y}
      r={hover ? r + 2.5 : r}
      fill={fill}
      stroke={hover ? hoverStroke : stroke}
      strokeWidth={hover ? 2 : 0.8}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => hovered.set(idx)}
      onDoubleClick={() => onPick(idx)}
    />
  )
})

/**
 * The hovered point in full. Its own component, subscribed to the hover
 * store, so moving between points redraws this card and nothing else.
 */
const PointCard = memo(function PointCard({
  hovered, points, hasAtt, effColor,
}: {
  hovered: CursorStore
  points: Pt[]
  hasAtt: boolean
  effColor: (eff: number | null) => string
}) {
  const pal = useAppPalette()
  const hover = useSyncExternalStore(hovered.subscribe, hovered.get)
  const byIdx = useMemo(() => new Map(points.map((p) => [p.idx, p])), [points])
  const hp = hover != null ? byIdx.get(hover) ?? null : null
  return (
    <>
              {/* Both layouts are always laid out in one cell, the idle one
                  hidden, so the card is the measurement's height from the
                  start and does not grow and shrink as the cursor crosses
                  points. */}
              <Box sx={{
                p: 1.75, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
                display: 'grid',
              }}>
                {/* Compact on purpose: it was nine stacked label/value rows,
                    a third of the column's height for one point. Now a
                    header, the two figures read first (efficiency in its
                    ramp colour, Pout with its watts), and the rest as a
                    captioned two-by-two grid. */}
                <Box sx={{ gridArea: '1 / 1', visibility: hp ? 'visible' : 'hidden' }} aria-hidden={!hp}>
                  <Stack direction="row" alignItems="baseline" spacing={1}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', flexGrow: 1 }}>
                      {hp ? `Step ${hp.idx + 1}` : DASH_TXT}
                    </Typography>
                    {/* Reserved for the whole run once any row has one, so
                        moving between cycles does not add and drop it. */}
                    {hasAtt && (
                      <Typography sx={{ ...TEXT.micro, color: 'text.secondary', fontFamily: MONO }}>
                        att {hp?.row.att_db == null ? DASH_TXT : `${hp.row.att_db} dB`}
                      </Typography>
                    )}
                  </Stack>
                  <Typography sx={{ ...TEXT.micro, color: 'text.secondary', fontFamily: MONO, mb: 1.25 }}>
                    {hp ? `${hp.row.pos_mm.toFixed(2)} mm · ${hp.row.pos_pulses.toLocaleString()} pulses` : DASH_TXT}
                  </Typography>

                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1.5, mb: 1.25 }}>
                    <Box>
                      <Typography
                        sx={{
                          fontFamily: MONO, fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em',
                          color: hp ? effColor(hp.eff) : 'text.disabled',
                        }}
                      >
                        {hp?.eff == null ? DASH_TXT : `${(hp.eff * 100).toFixed(1)}%`}
                      </Typography>
                      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>efficiency</Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                        {hp?.row.power_dbm == null ? DASH_TXT : hp.row.power_dbm.toFixed(2)}
                        <Box component="span" sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary', ml: 0.5 }}>dBm</Box>
                      </Typography>
                      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>
                        Pout{hp?.row.power_dbm == null ? '' : ` · ${dbmToW(hp.row.power_dbm).toFixed(3)} W`}
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1.5, rowGap: 0.75,
                      pt: 1, borderTop: 1, borderColor: 'divider',
                    }}
                  >
                    {([
                      ['Icc', hp?.row.current_a == null ? DASH_TXT : `${(hp.row.current_a * 1000).toFixed(1)} mA`],
                      ['|S11|', hp?.row.s11_db == null ? DASH_TXT : `${hp.row.s11_db.toFixed(2)} dB`],
                      ['Z', hp?.row.r_ohm == null || hp.row.x_ohm == null ? DASH_TXT
                        : `${hp.row.r_ohm.toFixed(1)} ${hp.row.x_ohm >= 0 ? '+' : '−'} j${Math.abs(hp.row.x_ohm).toFixed(1)} Ω`],
                      ['Γ', hp ? `${hp.gr.toFixed(3)} ${hp.gi >= 0 ? '+' : '−'} j${Math.abs(hp.gi).toFixed(3)}` : DASH_TXT],
                    ] as const).map(([k, v]) => (
                      <Box key={k} sx={{ minWidth: 0 }}>
                        <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>{k}</Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  {hp?.row.error && (
                    <Typography sx={{ ...TEXT.micro, color: 'error.main', mt: 1 }}>{hp.row.error}</Typography>
                  )}
                </Box>
                {/* The idle state shares the measurement's cell, so it has
                    that height to fill: what to do, centred, then the colour
                    key as a quiet inset at the foot -- rather than a sentence
                    at the top, the formula as the largest thing in the card,
                    and empty space under both. */}
                <Box
                  sx={{
                    gridArea: '1 / 1', visibility: hp ? 'hidden' : 'visible',
                    display: 'flex', flexDirection: 'column', gap: 1.5,
                  }}
                  aria-hidden={!!hp}
                >
                  <Stack alignItems="center" justifyContent="center" spacing={0.5} sx={{ flexGrow: 1, textAlign: 'center' }}>
                    <Box
                      sx={{
                        width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center',
                        bgcolor: alpha(pal.sidebar.text, 0.06), color: 'text.secondary', mb: 0.5,
                      }}
                    >
                      <AdsClickIcon sx={{ fontSize: 18 }} />
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Hover a point</Typography>
                    <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                      to see its measurement. Double-click to remeasure.
                    </Typography>
                  </Stack>
                  <Box sx={{ borderRadius: '10px', bgcolor: alpha(pal.sidebar.text, 0.04), px: 1.25, py: 1 }}>
                    <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mb: 0.25 }}>Colour = efficiency</Typography>
                    <EfficiencyFormula vcc={VCC} />
                  </Box>
                </Box>
              </Box>
    </>
  )
})

const TAB_OPTIONS = [{ value: 'points' as const, label: 'Points' }, { value: 'area' as const, label: 'Working area' }]
const DOT_OPTIONS = [{ value: 's' as const, label: 'S' }, { value: 'm' as const, label: 'M' }, { value: 'l' as const, label: 'L' }]
const COLOUR_BY_OPTIONS = [{ value: 'eff' as const, label: 'Efficiency' }, { value: 'att' as const, label: 'Att' }]

/**
 * The dialog's title bar: name, point count, the tab switch, graph options
 * and Copy chart. Memoised, with stable callbacks: it redrew with every
 * change in the dialog -- a hover, a live row, a style switch -- at 10-15 ms
 * a time in development, for a bar that changes only with its own props.
 */
const SmithTitle = memo(function SmithTitle({
  nPoints, tauPs, tab, onTab, style, onStyle, attsCount, copied, onCopy, onClose,
}: {
  nPoints: number
  tauPs: number
  tab: 'points' | 'area'
  onTab: (v: 'points' | 'area') => void
  style: SmithStyle
  onStyle: (next: SmithStyle | ((prev: SmithStyle) => SmithStyle)) => void
  attsCount: number
  copied: 'idle' | 'done' | 'failed'
  onCopy: () => void
  onClose: () => void
}) {
  const pal = useAppPalette()
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null)
  const isDefaultStyle = (Object.keys(STYLE_DEFAULT) as Array<keyof SmithStyle>)
    .every((k) => style[k] === STYLE_DEFAULT[k])
  const setStyleOpt = <K extends keyof SmithStyle>(k: K, v: SmithStyle[K]) =>
    onStyle((p) => ({ ...STYLE_DEFAULT, ...p, [k]: v }))
  return (
  <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1.5 }}>
    <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
      <Typography sx={TEXT.dialog}>Smith chart</Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {nPoints} point{nPoints === 1 ? '' : 's'} · Z₀ = {Z0} Ω
        {tauPs ? ` · at the PA, τ = ${tauPs} ps` : ''}
      </Typography>
    </Stack>
    <Box sx={{ ml: 2.5 }}>
      <SegmentedChoice
        text aria-label="View" value={tab}
        options={TAB_OPTIONS}
        onChange={onTab}
      />
    </Box>
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
          onClick={() => onStyle(STYLE_DEFAULT)}
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
            options={DOT_OPTIONS}
            onChange={(v) => setStyleOpt('dot', v)}
          />
        </SheetRow>
        {/* Attenuator only means something on a run that swept it. */}
        <SheetRow label="Colour by">
          <SegmentedChoice
            text aria-label="Colour by" value={attsCount > 1 ? style.color : 'eff'}
            options={COLOUR_BY_OPTIONS}
            onChange={(v) => setStyleOpt('color', v)}
            disabled={attsCount < 2}
          />
        </SheetRow>
      </SheetGroup>
    </Popover>
    <MiniAction
      startIcon={copied === 'done' ? <CheckRoundedIcon /> : <ContentCopyIcon />}
      onClick={onCopy}
      disabled={nPoints === 0}
      color={copied === 'failed' ? 'error' : 'primary'}
      sx={{ mr: 1, width: 112, justifyContent: 'flex-start' }}
    >
      {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy chart'}
    </MiniAction>
    <IconButton size="small" onClick={onClose} aria-label="Close">
      <CloseIcon sx={{ fontSize: 18 }} />
    </IconButton>
  </DialogTitle>
  )
})

/** Shared by every list row, so they resolve to one class between them. */
const LIST_ROW_SX = {
  px: 1.25, py: 0.5, cursor: 'default',
  fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
  display: 'grid', columnGap: '6px', alignItems: 'center',
  '&:hover': { bgcolor: 'action.hover' },
  '&[data-on="true"]': { bgcolor: 'action.selected' },
} as const

/** Width of the point list. */
const LIST_W = 320

/**
 * The point list's columns, shared by its head and every row: #, Pos, Att
 * (with a sweep), Z, Pout, Eff. Fixed widths, the figures right-aligned in
 * tabular digits; only Z takes what is left, and cuts with an ellipsis.
 *
 * They were flex shares sized by their content, so the columns drifted row
 * to row: a three-digit step ran into its position ("13" and "3.9" read as
 * "133.9"), and a long impedance pushed Pout and Eff along.
 */
const listCols = (hasAtt: boolean) =>
  `40px 42px ${hasAtt ? '22px ' : ''}minmax(0, 1fr) 36px 44px`

/** A list cell: numbers right, one line, cut rather than overflowing. */
const cellSx = (align: 'left' | 'right') => ({
  textAlign: align, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
}) as const
const NUM_SX = cellSx('right')
const TXT_SX = cellSx('left')

/** One row of the point list. See Dot for why it is memoised. */
const ListRow = memo(function ListRow({
  pt, color, hasAtt, hovered, onPick, rowRef,
}: {
  pt: Pt; color: string; hasAtt: boolean
  hovered: CursorStore
  onPick: (idx: number) => void
  rowRef?: Ref<HTMLDivElement>
}) {
  const on = useSyncExternalStore(hovered.subscribe, () => hovered.get() === pt.idx)
  return (
    <Stack
      ref={rowRef}
      direction="row"
      data-on={on}
      onMouseEnter={() => hovered.set(pt.idx)}
      onMouseLeave={() => hovered.set(null)}
      onDoubleClick={() => onPick(pt.idx)}
      sx={LIST_ROW_SX}
      style={{ gridTemplateColumns: listCols(hasAtt) }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
        {/* The same colour the point carries on the chart, so a row and
            its dot are findable from each other. A plain style: the colour
            changes with the efficiency range, and in `sx` every new value
            would be a generated class. */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
        }} />
        {pt.idx + 1}
      </Box>
      <Box sx={NUM_SX}>{pt.row.pos_mm.toFixed(1)}</Box>
      {/* Every attenuation is on the chart at once, so the
          list is where a dot says which cycle it came from. */}
      {hasAtt && (
        <Box sx={NUM_SX}>
          {pt.row.att_db == null ? '—' : pt.row.att_db}
        </Box>
      )}
      <Box sx={{ ...TXT_SX, pl: 0.75 }} title={pt.row.r_ohm == null || pt.row.x_ohm == null ? undefined
        : `${pt.row.r_ohm.toFixed(1)} ${pt.row.x_ohm >= 0 ? '+' : '−'} j${Math.abs(pt.row.x_ohm).toFixed(1)} Ω`}
      >
        {pt.row.r_ohm == null || pt.row.x_ohm == null
          ? '—'
          : `${pt.row.r_ohm.toFixed(0)}${pt.row.x_ohm >= 0 ? '+' : '−'}j${Math.abs(pt.row.x_ohm).toFixed(0)}`}
      </Box>
      <Box sx={NUM_SX}>
        {pt.row.power_dbm == null ? '—' : pt.row.power_dbm.toFixed(1)}
      </Box>
      <Box sx={NUM_SX}>
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
const Picker = memo(function Picker({
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
})

/**
 * Which attenuator settings are on the chart. Every setting belongs on one
 * chart (sweeping it is what moves the load), but with a dozen trajectories
 * overlaid, comparing two or three of them meant reading through the rest.
 *
 * The field is the same select as Freq beside it; it opens a small sheet,
 * not a list. The list was a tall column of rows each tinted blue with a
 * tick -- nine identical loud rows that said "all on" by shouting -- with All
 * and None as two more rows of it. Here the settings are chips in a grid, a
 * shown one softly filled and ticked, a hidden one plain and dimmed; All and
 * None are quiet keys in the sheet's head. Double-click a chip for only that
 * setting. With the chart coloured by attenuator each chip carries its dot.
 */
const AttPicker = memo(function AttPicker({
  options, hidden, onChange, colorOf,
}: {
  options: number[]
  hidden: ReadonlySet<number>
  onChange: (hidden: Set<number>) => void
  /** The setting's colour on the chart, when the chart is coloured by it. */
  colorOf?: (att: number) => string
}) {
  const pal = useAppPalette()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const shown = options.filter((o) => !hidden.has(o))
  const label = shown.length === options.length ? 'All'
    : shown.length === 0 ? 'None'
    : shown.join(', ')
  const toggle = (o: number) => {
    const next = new Set(hidden)
    if (next.has(o)) next.delete(o)
    else next.add(o)
    onChange(next)
  }
  const quietKey = (text: string, onClick: () => void, disabled: boolean) => (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        ...PRESS_SX, fontSize: 12, fontWeight: 500, borderRadius: '6px', px: 0.75, py: 0.25,
        color: 'primary.main', '&.Mui-disabled': { color: 'text.disabled' },
        '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.06) },
      }}
    >
      {text}
    </ButtonBase>
  )
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        Att
      </Typography>
      <TextField
        select
        size="small"
        value="shown"
        SelectProps={{
          // Never opens its own list: the sheet below is the menu.
          open: false,
          onOpen: (e) => setAnchor((e.currentTarget as HTMLElement).closest('.MuiInputBase-root') as HTMLElement),
          renderValue: () => label,
        }}
        inputProps={{ 'aria-label': 'Attenuator settings shown (dB)' }}
        sx={{
          minWidth: 96, maxWidth: 220,
          '& .MuiInputBase-root': { height: 32 },
          '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5, py: 0.5 },
        }}
      >
        <MenuItem value="shown">{label}</MenuItem>
      </TextField>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>dB</Typography>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75, p: 1.25, width: 232, borderRadius: '12px', border: 1, borderColor: 'divider',
              boxShadow: '0 12px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.08)',
            },
          },
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ px: 0.5, mb: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Attenuator</Typography>
          {quietKey('All', () => onChange(new Set()), hidden.size === 0)}
          {quietKey('None', () => onChange(new Set(options)), shown.length === 0)}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5 }}>
          {options.map((o) => {
            const on = !hidden.has(o)
            return (
              <ButtonBase
                key={o}
                aria-pressed={on}
                aria-label={`${o} dB`}
                onClick={() => toggle(o)}
                onDoubleClick={() => onChange(new Set(options.filter((x) => x !== o)))}
                sx={{
                  ...PRESS_SX,
                  height: 30, borderRadius: '8px', gap: 0.5,
                  fontFamily: MONO, fontSize: 12.5, fontWeight: on ? 600 : 400,
                  color: on ? 'text.primary' : 'text.disabled',
                  bgcolor: on ? alpha(pal.sidebar.text, 0.08) : 'transparent',
                  boxShadow: on ? 'none' : `inset 0 0 0 1px ${alpha(pal.sidebar.text, 0.1)}`,
                  '&:hover': { bgcolor: alpha(pal.sidebar.text, on ? 0.12 : 0.05) },
                }}
              >
                {colorOf ? (
                  <Box
                    component="span"
                    sx={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      bgcolor: on ? colorOf(o) : 'transparent',
                      boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${colorOf(o)}`,
                    }}
                  />
                ) : on && <CheckRoundedIcon sx={{ fontSize: 13, color: 'primary.main' }} />}
                {o}
              </ButtonBase>
            )
          })}
        </Box>
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', px: 0.5, mt: 1 }}>
          Double-click a setting to show only it
        </Typography>
      </Popover>
    </Stack>
  )
})

/** The working area's limits as typed, kept between sessions. Text rather
 *  than numbers so a half-typed "-" or "28." survives a re-render. */
interface AreaSettings {
  pout: [string, string]
  icc: [string, string]
  eff: [string, string]
  /** Every frequency at once (a load must pass at each), or the one shown. */
  allFreqs: boolean
}
const AREA_DEFAULT: AreaSettings = { pout: ['', ''], icc: ['', ''], eff: ['', ''], allFreqs: true }
/**
 * The grid cell under the cursor, kept out of React state: it changes on
 * every mouse move, and as dialog state each move redrew the whole dialog.
 * Only the readout that shows it subscribes.
 */
function createCursorStore() {
  let cell: number | null = null
  const subs = new Set<() => void>()
  return {
    get: () => cell,
    set: (c: number | null) => {
      if (c === cell) return
      cell = c
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => {
      subs.add(f)
      return () => { subs.delete(f) }
    },
  }
}
type CursorStore = ReturnType<typeof createCursorStore>

/** How the working area is drawn: which quantity the contours trace and
 *  which the region is coloured by. */
interface AreaView2 { contours: Quantity; colour: Quantity }
const AREA_VIEW_DEFAULT: AreaView2 = { contours: 'pout', colour: 'eff' }
const QUANTITY_OPTIONS: Array<{ value: Quantity; label: string }> = [
  { value: 'pout', label: 'Pout' }, { value: 'icc', label: 'Icc' }, { value: 'eff', label: 'Eff' },
]

const LIMIT_ROWS = [
  { key: 'pout', label: 'Pout', unit: 'dBm' },
  { key: 'icc', label: 'Icc', unit: 'mA' },
  { key: 'eff', label: 'Efficiency', unit: '%' },
] as const

/** Blank is no limit; anything else that is not a number is an error. */
const limitNum = (s: string): number | null | undefined => {
  const t = s.trim()
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : undefined
}
const toBound = ([lo, hi]: [string, string]): Bound => [limitNum(lo) ?? null, limitNum(hi) ?? null]

type AreaReading = { gr: number; gi: number; pout: number; icc: number; eff: number }

/** The figure's star, as a glyph for the card that names its load. */
const StarGlyph = () => (
  <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden style={{ flexShrink: 0, marginRight: 6 }}>
    <polygon
      points={Array.from({ length: 10 }, (_, k) => {
        const a = (Math.PI / 5) * k - Math.PI / 2
        const r = k % 2 ? 2.4 : 5.6
        return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
      }).join(' ')}
      fill="#F05A28"
    />
  </svg>
)

/**
 * One load, read: its impedance as the line the eye lands on, then Pout,
 * Icc and efficiency in three even columns, each with its unit beside it.
 *
 * It was one row of four cramped cells -- Z cut to "10.4 − j10.9…", the
 * units in a footnote under the card, efficiency printed twice -- so the
 * impedance, the one figure the operator carries to the tuner, was the one
 * that did not fit. On an inset block, as the settings sheets are, with a
 * fixed layout whether it holds a reading or dashes.
 */
function LoadReading({
  title, icon, status, statusColor, pt, effColor,
}: {
  title: string
  icon?: React.ReactNode
  status?: string
  statusColor?: string
  pt: AreaReading | null
  effColor: (effPct: number) => string
}) {
  const pal = useAppPalette()
  const stat = (k: string, v: string | null, unit: string, swatch?: string) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>{k}</Typography>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
        {swatch && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: swatch, flexShrink: 0 }} />}
        <Typography noWrap sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: v ? 'text.primary' : 'text.disabled' }}>
          {v ?? DASH_TXT}
          {v && <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 11, ml: 0.5 }}>{unit}</Box>}
        </Typography>
      </Stack>
    </Box>
  )
  return (
    <Box sx={{ borderRadius: '10px', bgcolor: alpha(pal.sidebar.text, 0.045), px: 1.5, pt: 1, pb: 1.25 }}>
      <Stack direction="row" alignItems="center" sx={{ minHeight: 18 }}>
        {icon}
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flexGrow: 1 }}>{title}</Typography>
        {status && <Typography sx={{ ...TEXT.micro, color: statusColor ?? 'text.disabled' }}>{status}</Typography>}
      </Stack>
      {(() => {
        const z = (
          <Typography
            noWrap
            sx={{
              fontFamily: MONO, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3,
              color: pt ? 'text.primary' : 'text.disabled',
            }}
          >
            {pt ? fmtZ(pt.gr, pt.gi) : DASH_TXT}
          </Typography>
        )
        return (
          <Box sx={{ mt: 0.25, mb: 0.75 }}>
            {z}
          </Box>
        )
      })()}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 1 }}>
        {stat('Pout', pt ? pt.pout.toFixed(1) : null, 'dBm')}
        {stat('Icc', pt ? pt.icc.toFixed(0) : null, 'mA')}
        {stat('Efficiency', pt ? pt.eff.toFixed(1) : null, '%', pt ? effColor(pt.eff) : undefined)}
      </Box>
    </Box>
  )
}

/** The interpolated readings under the cursor: the one part of the panel
 *  that follows the mouse, so the one part that subscribes to it. */
function CursorReadout({
  store, area, effColor,
}: { store: CursorStore; area: Area | null; effColor: (effPct: number) => string }) {
  const cursor = useSyncExternalStore(store.subscribe, store.get)
  const at = area && cursor != null && area.measured[cursor]
    ? { ...cellGamma(area.n, cursor), pout: area.pout[cursor], icc: area.icc[cursor], eff: area.eff[cursor] }
    : null
  const inArea = at != null && cursor != null && !!area?.ok[cursor]
  return (
    <LoadReading
      title="At the cursor"
      status={at ? (inArea ? 'in the area' : 'outside the limits') : cursor != null ? 'not measured here' : 'hover the chart'}
      statusColor={inArea ? 'success.main' : undefined}
      pt={at} effColor={effColor}
    />
  )
}

function fmtZ(gr: number, gi: number) {
  const z = impedance(gr, gi)
  return `${z.r.toFixed(1)} ${z.x >= 0 ? '+' : '−'} j${Math.abs(z.x).toFixed(1)} Ω`
}

/**
 * The working area's loading sheet: a small frosted panel over the figure,
 * an activity indicator and what is happening, in the manner of a macOS
 * progress sheet rather than a spinner stuck on the chart.
 *
 * It sits over the figure's title, which during the wait describes the
 * result being replaced. Centred on the chart it landed on whatever was
 * there -- the optimum's label poked out beside it and read as drawn over
 * it -- and hid the data the operator was waiting to see.
 *
 * Always mounted, so it can arrive and leave: in, it fades down a few
 * pixels, settles from 96 % and comes into focus; out, it simply fades,
 * quicker than it came -- blurring on the way out smeared it over the chart.
 * Above the figure in its own layer. HTML over the SVG, not drawn in it, so
 * Copy chart never pastes it.
 */
function AreaBusy({ show }: { show: boolean }) {
  const pal = useAppPalette()
  return (
    <Box
      aria-live="polite"
      sx={{
        position: 'absolute', left: '50%', top: 4, zIndex: 2, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.125, borderRadius: '12px',
        color: 'text.secondary',
        bgcolor: alpha(pal.paper, 0.72),
        backdropFilter: 'blur(14px) saturate(170%)',
        border: `1px solid ${alpha(pal.sidebar.text, 0.08)}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
        opacity: show ? 1 : 0,
        transform: show ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, -6px) scale(0.96)',
        transition: show
          ? 'opacity 200ms ease-out, transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          : 'opacity 120ms ease-in',
        [REDUCED_MOTION]: { transform: 'translate(-50%, 0)', transition: 'opacity 160ms ease' },
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none' },
      }}
    >
      {show && <ActivityIndicator size={16} label="Working out the area" />}
      <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap' }}>
        Working out the area…
      </Typography>
    </Box>
  )
}

/**
 * The working-area tab's column: the limits, then what they leave.
 *
 * Limits as a sheet of min/max pairs, blank for no limit. Under it, how much
 * of the measured area passes, the best load in it, and the interpolated
 * readings under the cursor -- the area is a map, and the cursor is how a
 * spot on it is read. Every part keeps its height whatever it shows.
 */
const AreaPanel = memo(function AreaPanel({
  settings, onChange, delay, onDelay, onActivity, area, cursor, pending, busy, nFields, nFreqs, effColor,
}: {
  settings: AreaSettings
  onChange: (s: AreaSettings) => void
  /** The operator changed something: show the work, even if the answer is
   *  already to hand (see the dialog's `pulseBusy`). */
  onActivity: () => void
  /** Electrical delay of the PA-to-tuner cable, ps, as typed. */
  delay: string
  onDelay: (v: string) => void
  area: Area | null
  /** The grid cell under the cursor. */
  cursor: CursorStore
  /** A new area is being worked out. */
  pending: boolean
  /** ...and has been for long enough to say so. */
  busy: boolean
  /** How many frequencies the area is the worst case of. */
  nFields: number
  /** How many the run has; the switch shows only when there is a choice. */
  nFreqs: number
  effColor: (effPct: number) => string
}) {
  const pal = useAppPalette()
  // The fields type into a draft and Apply hands it up. Applied as typed,
  // each change started a new area while the operator was still typing, and
  // the dialog felt stuck under them; now nothing moves until they say so,
  // and Apply shows the work while it runs.
  // The limits and the delay wait for Apply. The frequency switch does not:
  // it is a switch, like Contours and Colour, and waiting for a key it gave
  // no sign of having been pressed at all.
  const [draft, setDraft] = useState(settings)
  const [draftDelay, setDraftDelay] = useState(delay)
  const apply = (next: AreaSettings) => setDraft(next)
  const limitsDirty = LIMIT_ROWS.some(({ key }) => draft[key][0] !== settings[key][0] || draft[key][1] !== settings[key][1])
  const dirty = limitsDirty || draftDelay.trim() !== delay.trim()
  const delayBad = !Number.isFinite(Number(draftDelay.trim() || 0))
  const invalid = delayBad || LIMIT_ROWS.some(({ key }) => draft[key].some((v) => limitNum(v) === undefined))
  const commit = () => {
    if (!dirty || invalid) return
    onActivity()
    if (limitsDirty) onChange({ ...draft, allFreqs: settings.allFreqs })
    if (draftDelay.trim() !== delay.trim()) onDelay(draftDelay.trim())
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit() }
  const isDefault = LIMIT_ROWS.every(({ key }) => draft[key][0] === '' && draft[key][1] === '')
  const setLimit = (key: (typeof LIMIT_ROWS)[number]['key'], side: 0 | 1, v: string) => {
    const next: [string, string] = [...draft[key]]
    next[side] = v
    apply({ ...draft, [key]: next })
  }
  const card = {
    p: 1.75, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
  } as const
  const pct = area && area.measuredCells > 0 ? (area.okCells / area.measuredCells) * 100 : null
  const firstLoad = area == null && pending
  const firstBusy = area == null && busy

  return (
    <Stack spacing={1.5}>
      <Box sx={card}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Limits</Typography>
          <ButtonBase
            onClick={() => apply({ ...AREA_DEFAULT, allFreqs: draft.allFreqs })}
            disabled={isDefault}
            sx={{
              ...PRESS_SX, fontSize: 12, fontWeight: 500, borderRadius: '6px', px: 0.75, py: 0.25,
              color: 'primary.main', '&.Mui-disabled': { color: 'text.disabled' },
              '&:hover': { bgcolor: alpha(pal.sidebar.text, 0.06) },
            }}
          >
            Clear
          </ButtonBase>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 84px 84px', columnGap: 1, rowGap: 0.75, alignItems: 'center' }}>
          <Box />
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', pl: 0.5 }}>Min</Typography>
          <Typography sx={{ ...TEXT.micro, color: 'text.disabled', pl: 0.5 }}>Max</Typography>
          {LIMIT_ROWS.map(({ key, label, unit }) => (
            <Box key={key} sx={{ display: 'contents' }}>
              <Typography sx={{ fontSize: 13 }}>
                {label}
                <Box component="span" sx={{ color: 'text.disabled', ml: 0.5, fontSize: 12 }}>[{unit}]</Box>
              </Typography>
              {([0, 1] as const).map((side) => (
                <TextField
                  key={side}
                  size="small"
                  value={draft[key][side]}
                  onChange={(e) => setLimit(key, side, e.target.value)}
                  error={limitNum(draft[key][side]) === undefined}
                  onKeyDown={onEnter}
                  inputProps={{
                    inputMode: 'decimal', 'aria-label': `${label} ${side ? 'max' : 'min'} (${unit})`,
                  }}
                  sx={{
                    '& .MuiInputBase-root': { height: 30 },
                    '& input': { fontFamily: MONO, fontSize: 12.5, py: 0.5, px: 1, textAlign: 'right' },
                  }}
                />
              ))}
            </Box>
          ))}
        </Box>
        {nFreqs > 1 && (
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: 13 }}>Frequencies</Typography>
            <SegmentedChoice
              text aria-label="Frequencies" value={settings.allFreqs ? 'all' : 'one'}
              options={[{ value: 'one', label: 'Shown' }, { value: 'all', label: `All ${nFreqs}` }]}
              onChange={(v) => {
                // Applied now, with only this setting: typed limits not yet
                // applied stay in the draft for Apply.
                setDraft({ ...draft, allFreqs: v === 'all' })
                onActivity()
                onChange({ ...settings, allFreqs: v === 'all' })
              }}
            />
          </Stack>
        )}
        {/* Where the chart stands rather than what it keeps, but it redraws
            the same picture, so it waits for the same key. */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: 13 }}>
              Electrical delay
              <Box component="span" sx={{ color: 'text.disabled', ml: 0.5, fontSize: 12 }}>[ps]</Box>
            </Typography>
            <TextField
              size="small"
              value={draftDelay}
              onChange={(e) => setDraftDelay(e.target.value)}
              onKeyDown={onEnter}
              error={delayBad}
              inputProps={{ inputMode: 'decimal', 'aria-label': 'Electrical delay (ps)' }}
              sx={{
                width: 84,
                '& .MuiInputBase-root': { height: 30 },
                '& input': { fontFamily: MONO, fontSize: 12.5, py: 0.5, px: 1, textAlign: 'right' },
              }}
            />
        </Stack>
        {/* The label holds while working -- the spinner says it -- so the
            word does not jump inside the key, as on Connect. */}
        <Button
          fullWidth size="small" variant="contained" color="primary" disableElevation
          onClick={commit}
          disabled={(!dirty && !busy) || invalid}
          startIcon={busy ? <ActivityIndicator size={14} label="Working out the area" /> : undefined}
          // No colour transition: MUI's 250 ms fade from blue to grey made
          // the key look busy for a beat after the new figure was already up.
          // It settles in the same frame as the picture.
          sx={{ mt: 1.5, height: 32, fontSize: 12.5, pointerEvents: busy ? 'none' : undefined, transition: 'none' }}
        >
          Apply
        </Button>
      </Box>

      {/* How much of what was measured passes, as a figure and a meter;
          then the best load and the load under the cursor, alike. */}
      <Box sx={card}>
        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ minWidth: 0 }}>
          {(() => {
            const fig = (
              <Typography
                sx={{
                  fontFamily: MONO, fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em',
                  color: pct === 0 ? 'warning.main' : pct == null ? 'text.disabled' : 'text.primary',
                }}
              >
                {firstLoad ? '100%' : pct == null ? DASH_TXT : `${pct < 10 && pct > 0 ? pct.toFixed(1) : pct.toFixed(0)}%`}
              </Typography>
            )
            // The figure stays laid out, hidden, under the spinner, so the
            // row keeps its baseline and its height while loading.
            return (
              <Box sx={{ position: 'relative' }}>
                <Box sx={{ visibility: firstLoad ? 'hidden' : 'visible' }}>{fig}</Box>
                {firstBusy && (
                  <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
                    <ActivityIndicator size={18} label="Working out the area" />
                  </Box>
                )}
              </Box>
            )
          })()}
          <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', minWidth: 0 }}>
            {area == null && pending ? 'working out the area…'
              : area == null || area.measuredCells === 0 ? 'no area: needs three points off one line'
              : pct === 0 ? 'no measured load meets every limit'
              : 'of the measured area meets the limits'}
          </Typography>
        </Stack>
        <Box sx={{ mt: 1, height: 4, borderRadius: 2, bgcolor: alpha(pal.sidebar.text, 0.08), overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${pct ?? 0}%`, borderRadius: 2, bgcolor: pal.actions.primary.bg }} />
        </Box>
        {/* Always one line, so the card does not grow with the switch. */}
        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mt: 0.75, height: 18, lineHeight: '18px' }}>
          {nFields > 1 ? `Worst case of ${nFields} frequencies` : ''}
        </Typography>

        <Stack spacing={1} sx={{ mt: 1.25 }}>
          <LoadReading
            title="Best efficiency" icon={<StarGlyph />}
            pt={area?.best ?? null} effColor={effColor}
          />
          <CursorReadout store={cursor} area={area} effColor={effColor} />
        </Stack>
      </Box>
    </Stack>
  )
})

export function SmithChartModal({
  open, onClose, results: measured, keepToolbar, onRemeasure = NO_PICK,
}: {
  open: boolean
  onClose: () => void
  results: LoadPullResultRow[]
  /** Double-click on a point or its row: remeasure that point (its index in
   *  `results`). Keep it stable -- dots and rows are memoised on it. */
  onRemeasure?: (idx: number) => void
  /** Stop below the toolbar instead of covering it -- pass while a run is on. */
  keepToolbar?: boolean
}) {
  // Grid, ink and ground come from the theme like every other chart, rather
  // than blue-grey values of the chart's own that read as a different product.
  const pal = useAppPalette()
  const { mode } = useThemeMode()
  // The cable between the PA and the tuner, as a delay. The VNA reads the
  // load at the tuner; the chart shows it at the PA, turned back by the
  // cable. Every view below -- points, list, card, statistics, working area
  // -- reads `results`, so they all move together. The results table keeps
  // what was measured.
  const [delayText, setDelayText] = usePersistedState<string>(STORAGE_KEYS.smithDelay, '')
  const delayPs = Number(delayText.trim() || 0)
  const delayBad = !Number.isFinite(delayPs)
  const tauPs = delayBad ? 0 : delayPs
  const results = useMemo(() => deembedRows(measured, tauPs), [measured, tauPs])
  // The hovered point, out of React state like the working area's cursor:
  // as dialog state every hover redrew the whole dialog (~60 ms a move in
  // development, and it showed). Now the dot, the row and the card that
  // show it are the only things that redraw.
  const copyRef = useRef<() => Promise<void>>(async () => {})
  const onCopy = useCallback(() => { void copyRef.current() }, [])
  const [hoverStore] = useState(createCursorStore)
  const setHover = hoverStore.set
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Point list windowing: only the rows in view are rendered.
  const listRef = useRef<HTMLDivElement | null>(null)
  const listRowRef = useRef<HTMLDivElement | null>(null)
  const [listTop, setListTop] = useState(0)
  const [listH, setListH] = useState(400)
  const [listRowH, setListRowH] = useState(LIST_ROW_H_GUESS)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [savedStyle, setStyle] = usePersistedState<SmithStyle>(STORAGE_KEYS.smithStyle, STYLE_DEFAULT)
  // Spread over the defaults, so a style saved before a field existed reads it.
  const style = useMemo(() => ({ ...STYLE_DEFAULT, ...savedStyle }), [savedStyle])
  // The measured points, or the working area they map out under the limits.
  const [tab, setTab] = useState<'points' | 'area'>('points')
  const [savedArea, setAreaSettings] = usePersistedState<AreaSettings>(STORAGE_KEYS.smithArea, AREA_DEFAULT)
  const areaSettings = useMemo(() => ({ ...AREA_DEFAULT, ...savedArea }), [savedArea])
  const [cursor] = useState(createCursorStore)
  // Mounted on first visit and then kept, hidden while Points shows:
  // building the figure and the limit fields again took ~0.4 s a switch.
  const [areaSeen, setAreaSeen] = useState(false)
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

  const effColor = useCallback((eff: number | null): string => {
    if (eff == null || !effDomain) return pal.sidebar.successOff
    // Every point measured the same: colour carries no information, so use one
    // neutral tone rather than painting them all at the ramp's cold end.
    if (effSpan === 0 || effFlat) return rampColor(0.5)
    // In the working area's bands, so one efficiency is one colour on both
    // tabs -- and a new point mid-run recolours the others only when it
    // moves a band edge, not at every row.
    return bandColor(bandOf(eff, effDomain))
  }, [effDomain, effSpan, effFlat, pal])
  // By attenuator only when there is more than one setting to tell apart.
  // Each setting keeps its colour (its place among all the run's settings)
  // whichever are filtered off, so 4 dB is the same colour alone as among
  // the rest.
  const byAtt = style.color === 'att' && atts.length > 1
  const attColor = useCallback((att: number | null | undefined): string =>
    att == null ? pathC : pal.chart.series[Math.max(0, atts.indexOf(att)) % pal.chart.series.length], [pathC, pal, atts])
  const colorOf = (pt: Pt): string => (byAtt ? attColor(pt.row.att_db) : effColor(pt.eff))
  const shownAtts = atts.filter((a) => !hiddenAtt.has(a))
  const statGroups = useMemo(() => statSlices.map((g) => ({
    ...g,
    color: byAtt && g.att != null
      ? pal.chart.series[Math.max(0, atts.indexOf(g.att)) % pal.chart.series.length]
      : pal.actions.primary.bg,
  })), [statSlices, byAtt, atts, pal])

  // The working area. Each frequency's points are interpolated over the
  // chart on their own -- a frequency's readings belong to its own loads --
  // and then a cell is in the area where every limit holds at all of them.
  // Built only while the tab is open: the triangulation is the costly part,
  // and a run adds a row every few seconds.
  const allFreqs = areaSettings.allFreqs && freqs.length > 1
  const areaSamples = useMemo(() => {
    return (allFreqs ? freqs : [freq]).map((f) => {
      const samples: Sample[] = []
      for (const { row } of chartRows(results, f, power, hiddenAtt)) {
        // A failed row is a point that did not measure, not a poor load.
        if (row.error || row.r_ohm == null || row.x_ohm == null || row.power_dbm == null || row.current_a == null) continue
        const eff = efficiency(row)
        if (eff == null) continue
        const { gr, gi } = reflection(row.r_ohm, row.x_ohm)
        if (!Number.isFinite(gr) || !Number.isFinite(gi)) continue
        samples.push({ gr, gi, pout: row.power_dbm, icc: row.current_a * 1000, eff: eff * 100 })
      }
      return samples
    })
  }, [allFreqs, freqs, freq, results, power, hiddenAtt])
  const limits: Limits = useMemo(() => {
    const a = { ...AREA_DEFAULT, ...savedArea }
    return { pout: toBound(a.pout), icc: toBound(a.icc), eff: toBound(a.eff) }
  }, [savedArea])
  const fieldFreqs = useMemo(() => (allFreqs ? freqs : [freq]), [allFreqs, freqs, freq])
  // What the figure contours and colours by. Instant, unlike the limits:
  // they choose how the same area is drawn, and a contour is cheap to trace.
  // Their own setting, so the limits' draft never writes over them.
  const [savedView, setAreaView] = usePersistedState<AreaView2>(STORAGE_KEYS.smithAreaView, AREA_VIEW_DEFAULT)
  const areaView2 = { ...AREA_VIEW_DEFAULT, ...savedView }
  const contourKey = areaView2.contours
  const areaMeta = useMemo(() => ({ fieldFreqs, tauPs, power, contourKey }), [fieldFreqs, tauPs, power, contourKey])
  // In a worker, and only while the tab shows; the last result is kept.
  const { view: areaView, pending: areaPending } = useWorkingArea(tab === 'area' ? areaSamples : null, limits, areaMeta)
  // What the eye is shown: the work at once, held at least 450 ms. Results
  // land in a tenth of a second; delayed instead, the indicator never showed
  // and Apply seemed to do nothing, and shown bare it flashed for a frame.
  // A change the operator made shows as work even when the cache answers it
  // at once: an instant swap with no sign looked like the press did
  // nothing. The pulse is up for a moment; the hold keeps it seen.
  const [pulseBusy, setPulseBusy] = useState(false)
  const onActivity = useCallback(() => setPulseBusy(true), [])
  useEffect(() => {
    if (!pulseBusy) return
    const t = window.setTimeout(() => setPulseBusy(false), 0)
    return () => window.clearTimeout(t)
  }, [pulseBusy])
  const areaBusy = useHeldFlag(areaPending || pulseBusy, 450)
  const area = areaView?.area ?? null
  // The ramp spans the area's own efficiencies, so it grades what is left
  // rather than the whole run.
  const areaEffColor = useCallback((e: number) => {
    const r = area?.effRange
    if (!r || (r.max - r.min) < 0.05) return rampColor(0.5)
    return rampColor((e - r.min) / (r.max - r.min))
  }, [area])
  const areaSvgRef = useRef<SVGSVGElement | null>(null)
  // Each frequency keeps its colour whichever are shown, as attenuator
  // settings do.
  const freqColor = useCallback((f: number | null) =>
    pal.chart.series[Math.max(0, f == null ? 0 : freqs.indexOf(f)) % pal.chart.series.length], [pal, freqs])
  const isArea = tab === 'area'
  const onTab = useCallback((v: 'points' | 'area') => {
    setTab(v)
    cursor.set(null)
    if (v === 'area') setAreaSeen(true)
  }, [cursor])


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
    if (isArea) return copyFigure()
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
      const ramp = (lo: number, hi: number) => {
        const l = `${lo.toFixed(1)}%`
        const h = `${hi.toFixed(1)}%`
        const barX = 76 + ctx.measureText(l).width + 8
        const barW = S - barX - ctx.measureText(h).width - 16
        ctx.fillText(l, 76, y)
        for (let b = 0; b < EFF_BANDS; b++) {
          ctx.fillStyle = bandColor(b)
          ctx.fillRect(barX + (b * barW) / EFF_BANDS, y - 4.5, barW / EFF_BANDS + 0.5, 9)
        }
        ctx.fillStyle = ink
        ctx.fillText(h, barX + barW + 8, y)
      }
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
        ramp(effDomain.min * 100, effDomain.max * 100)
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

  /** The working-area figure carries its own title, scale and legend, so it
   *  is rasterised as it stands. */
  const copyFigure = async () => {
    const svg = areaSvgRef.current
    if (!svg) return
    const SCALE = 2
    const { width: w, height: h } = svg.viewBox.baseVal
    try {
      const xml = new XMLSerializer().serializeToString(svg)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('could not rasterise the figure'))
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = w * SCALE
      canvas.height = h * SCALE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.scale(SCALE, SCALE)
      ctx.fillStyle = pal.paper
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('could not encode the image')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied('done')
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied('idle'), 2000)
  }


  // The latest copy, for the title bar's stable Copy key.
  useEffect(() => { copyRef.current = copyChart })

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
      <SmithTitle
        nPoints={points.length} tauPs={tauPs} tab={tab} onTab={onTab}
        style={style} onStyle={setStyle} attsCount={atts.length}
        copied={copied} onCopy={onCopy} onClose={onClose}
      />

      {/* View controls, on their own strip rather than crammed into the title.
          Captions sit beside each control instead of floating above it: a
          floating label notches the outline and makes the header taller than
          the two words it holds. */}
      {(freqs.length > 1 || powers.length > 1 || atts.length > 1 || isArea) && (
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
            <AttPicker
              options={atts} hidden={hiddenAtt} onChange={setHiddenAtt}
              colorOf={byAtt ? attColor : undefined}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          {/* How the area is drawn, at the far end: not a filter of what is
              shown but a choice of what it is shown as. */}
          {isArea && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>Contours</Typography>
                <SegmentedChoice
                  text aria-label="Contours" value={areaView2.contours} options={QUANTITY_OPTIONS}
                  onChange={(v) => { onActivity(); setAreaView((p) => ({ ...AREA_VIEW_DEFAULT, ...p, contours: v })) }}
                />
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>Colour</Typography>
                <SegmentedChoice
                  text aria-label="Colour" value={areaView2.colour} options={QUANTITY_OPTIONS}
                  onChange={(v) => { onActivity(); setAreaView((p) => ({ ...AREA_VIEW_DEFAULT, ...p, colour: v })) }}
                />
              </Stack>
            </Stack>
          )}
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
                width: LIST_W, flexShrink: 0,
                // Grows with the list and stops at the row's height — a short
                // run gets a short box, a long one fills the dialog and scrolls
                // inside. Fixing the height instead left rows at the top of an
                // otherwise empty panel.
                maxHeight: '100%',
                // Hidden, not unmounted, behind the working area.
                display: isArea ? 'none' : 'flex', flexDirection: 'column', minHeight: 0,
                borderRadius: 1.5, border: 1, borderColor: 'divider',
                bgcolor: 'background.paper', overflow: 'hidden',
              }}>
                <Box
                  sx={{
                    display: 'grid', gridTemplateColumns: listCols(hasAtt), columnGap: '6px',
                    px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider',
                    ...TEXT.micro, color: 'text.disabled', fontWeight: 700,
                    // The list's scrollbar narrows the rows below; the head
                    // keeps the same lane so its columns sit over theirs. The
                    // lane needs a clipping box, and a clipping box in this
                    // flex column may shrink below its text: the column
                    // squeezed it to 12 px and cut the labels. So it never
                    // shrinks.
                    flexShrink: 0, lineHeight: '20px', scrollbarGutter: 'stable', overflowY: 'hidden',
                  }}
                >
                  <Box>#</Box>
                  <Box sx={NUM_SX}>Pos</Box>
                  {hasAtt && <Box sx={NUM_SX}>Att</Box>}
                  <Box sx={{ ...TXT_SX, pl: 0.75 }}>Z [Ω]</Box>
                  <Box sx={NUM_SX}>Pout</Box>
                  <Box sx={NUM_SX}>Eff</Box>
                </Box>
                {/* No height of its own: it is as tall as its rows, and the
                    cap above turns that into a scroll once the dialog runs out
                    of room. Scrolling beats losing the chart to a table. */}
                <Box
                  ref={attachList}
                  onScroll={(e) => setListTop(e.currentTarget.scrollTop)}
                  // The scrollbar's lane kept whether or not it is showing,
                  // as in the head, so a list that starts to scroll does not
                  // narrow its rows and shift the columns.
                  sx={{ minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' }}
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
                      hovered={hoverStore}
                      onPick={onRemeasure}
                      rowRef={j === 0 ? listRowRef : undefined}
                    />
                  ))}
                  <div style={{ height: (points.length - listLast) * listRowH }} />
                </Box>
              </Box>
            )}

            {/* The working area is a figure of its own, the width the
                point list leaves it; it scales to the height it is given. */}
            {areaSeen && (
              <Box sx={{ display: isArea ? 'block' : 'none', position: 'relative', flex: 1, minWidth: 0, alignSelf: 'stretch', minHeight: 0 }}>
                <AreaFigure
                  svgRef={areaSvgRef} view={areaView as AreaView | null} pending={areaBusy} freqColor={freqColor}
                  slots={freqs.length} colour={areaView2.colour}
                  grid={style.grid} gridN={AREA_GRID} onCursor={cursor.set}
                />
                <AreaBusy show={areaBusy} />
              </Box>
            )}

            {/* Chart + legend */}
            {(
            <Box sx={{ flexShrink: 0, display: isArea ? 'none' : 'block' }}>
              <svg
                ref={svgRef}
                xmlns="http://www.w3.org/2000/svg"
                width={S} height={S} viewBox={`0 0 ${S} ${S}`}
                style={{ maxWidth: '100%' }}
                onMouseLeave={() => setHover(null)}
              >
                {/* The working area's grid, labels and all: memoised, so a
                    run adding points never draws it again. */}
                <SmithGrid cx={cx} cy={cy} R={R} grid={style.grid} />

                {/* Trajectory — one line per attenuator setting.
                    Each setting is its own trombone cycle, so a single polyline
                    joined the end of one cycle to the start of the next and drew
                    a chord straight across the chart that no measurement made. */}
                {style.lines && traces.map((trace) => (
                  <polyline
                    key={trace.key}
                    points={trace.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke={byAtt ? attColor(trace.pts[0].row.att_db) : pathC}
                    strokeWidth={0.8} strokeOpacity={0.55}
                  />
                ))}

                {/* points colored by efficiency */}
                {points.map((p) => (
                  <Dot
                    key={p.idx}
                    x={p.x} y={p.y} idx={p.idx} r={DOT_R[style.dot]}
                    fill={colorOf(p)}
                    // On white the paper-coloured edge vanished and the pale
                    // yellow end of the ramp went with it; a faint ink edge
                    // keeps every dot findable whatever its colour.
                    stroke={dotStroke} hoverStroke={pal.sidebar.text}
                    hovered={hoverStore}
                    onPick={onRemeasure}
                  />
                ))}
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
                      flexGrow: 1, height: 9, borderRadius: '2px', background: BANDED_GRADIENT,
                      boxShadow: `inset 0 0 0 0.5px ${alpha(pal.sidebar.text, 0.25)}`,
                    }} />
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                      {(effDomain.max * 100).toFixed(1)}%
                    </Typography>
                  </>
                )}
              </Stack>

            </Box>
            )}

            {/* Detail column: the hovered point in full, then every plotted
                point in brief. The list is the reason this dialog is wide —
                the chart shows the shape of the contour, but the numbers behind
                each point were previously reachable one hover at a time. */}
            {/* Wider than the list opposite: it carries the Statistics card
                too, whose bars want room to read as ranges. */}
            <Box sx={{ width: DETAIL_W, flexShrink: 0 }}>
              {areaSeen && (
                <Box sx={{ display: isArea ? 'block' : 'none' }}>
                  <AreaPanel
                    settings={areaSettings} onChange={setAreaSettings} area={area} cursor={cursor}
                    pending={areaPending} busy={areaBusy}
                    delay={delayText} onDelay={setDelayText} onActivity={onActivity}
                    nFields={areaView?.pts.length ?? fieldFreqs.length} nFreqs={freqs.length} effColor={areaEffColor}
                  />
                </Box>
              )}
              <Box sx={{ display: isArea ? 'none' : 'block' }}>
              <PointCard hovered={hoverStore} points={points} hasAtt={hasAtt} effColor={effColor} />

              {/* Under the point card: the figures for the whole slice beside
                  the one for the point under the cursor, the two read
                  together. Bars in each setting's own colour when the chart
                  is coloured by it, so a row and its dots are matched by eye. */}
              <StatsCard
                groups={statGroups}
                results={results}
                onHover={setHover}
              />
              </Box>
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
      fontSize: 17, color: 'text.primary',
      px: 0.5, py: 0.25,
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
