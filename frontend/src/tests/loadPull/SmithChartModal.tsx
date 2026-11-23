import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition,
} from 'react'
import { Box, Dialog, DialogContent, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { useAppPalette, useThemeMode } from '../../context/ThemeModeContext'
import { MONO, SegmentedChoice, TEXT, useHeldFlag } from '../../ui'
import { TOP_BAR_H } from '../../ui/tokens'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import {
  EFF_BANDS, reflection, efficiency, rampColor, bandColor, bandOf, chartRows, deembedRows,
} from './smith'
import { SmithGrid } from './SmithGrid'
import { pointStats, type PointStats } from './smithStats'
import { AreaFigure, type AreaView } from './AreaFigure'
import { AREA_GRID, type Quantity } from './areaCompute'
import { useWorkingArea } from './useWorkingArea'
import type { Limits, Sample } from './workingArea'
import { STYLE_DEFAULT, type Pt, type SmithStyle } from './smithChart/model'
import { createCursorStore } from './smithChart/cursorStore'
import { LIST_OVERSCAN, LIST_ROW_H_GUESS, LIST_W, NUM_SX, TXT_SX, listCols } from './smithChart/pointList'
import { AREA_DEFAULT, toBound, type AreaSettings } from './smithChart/areaSettings'
import { StatsCard } from './smithChart/StatsCard'
import { Dot } from './smithChart/Dot'
import { PointCard } from './smithChart/PointCard'
import { SmithTitle } from './smithChart/SmithTitle'
import { ListRow } from './smithChart/ListRow'
import { AttPicker, Picker } from './smithChart/Pickers'
import { AreaBusy } from './smithChart/AreaBusy'
import { AreaPanel } from './smithChart/AreaPanel'

/** Dot radius at rest; a hovered dot grows by the same 2.5. */
const DOT_R = { s: 3, m: 4.5, l: 6.5 } as const
/** The efficiency scale in its bands, hard stops between them, as a CSS
 *  background: the point chart's legend and the working area's colour bar
 *  then step alike. */
const BANDED_GRADIENT = `linear-gradient(to right, ${Array.from({ length: EFF_BANDS }, (_, b) =>
  `${bandColor(b)} ${((b / EFF_BANDS) * 100).toFixed(2)}% ${(((b + 1) / EFF_BANDS) * 100).toFixed(2)}%`).join(', ')})`

/** Width of the detail column: the point card and, under it, Statistics. */
const DETAIL_W = 340

/** Stands in for `onRemeasure` when there is none, so the memoised dots and
 *  rows are handed the same function every render. */
const NO_PICK = () => {}

/** What a ramp-coloured point is graded by, and how its figure is written. */
const METRIC = {
  eff: { label: 'Efficiency', of: (p: { eff: number | null }) => p.eff, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
  pout: {
    label: 'Pout',
    of: (p: { row: { power_dbm: number | null } }) => p.row.power_dbm,
    fmt: (v: number) => `${v.toFixed(2)} dBm`,
  },
} as const

/** How the working area is drawn: which quantity the contours trace and
 *  which the region is coloured by. */
interface AreaView2 { contours: Quantity; colour: Quantity }
const AREA_VIEW_DEFAULT: AreaView2 = { contours: 'pout', colour: 'eff' }
const QUANTITY_OPTIONS: Array<{ value: Quantity; label: string }> = [
  { value: 'pout', label: 'Pout' }, { value: 'icc', label: 'Icc' }, { value: 'eff', label: 'Eff' },
]

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
  // The switch's own state, set at once, while `tab` -- which swaps the
  // content -- follows as a transition: the control answers the click on the
  // next frame whatever the swap costs, and a second click interrupts it.
  const [tabIntent, setTabIntent] = useState<'points' | 'area'>('points')
  const [, startTabTransition] = useTransition()
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
  // The ramp's metric: efficiency, or Pout when chosen. Graded on its own
  // values, in the same bands, so a Pout ramp reads as the efficiency one does.
  const metric: 'eff' | 'pout' = style.color === 'pout' ? 'pout' : 'eff'
  const M = METRIC[metric]
  const metricDomain = useMemo(() => {
    const vals = points.map((p) => METRIC[metric].of(p)).filter((v): v is number => v != null && Number.isFinite(v))
    if (vals.length === 0) return null
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [points, metric])
  const metricFlat = metricDomain != null && M.fmt(metricDomain.min) === M.fmt(metricDomain.max)
  const metricColor = useCallback((v: number | null): string => {
    if (v == null || !metricDomain) return pal.sidebar.successOff
    if (metricFlat) return rampColor(0.5)
    return bandColor(bandOf(v, metricDomain))
  }, [metricDomain, metricFlat, pal])
  // By attenuator only when there is more than one setting to tell apart.
  // Each setting keeps its colour (its place among all the run's settings)
  // whichever are filtered off, so 4 dB is the same colour alone as among
  // the rest.
  const byAtt = style.color === 'att' && atts.length > 1
  const attColor = useCallback((att: number | null | undefined): string =>
    att == null ? pathC : pal.chart.series[Math.max(0, atts.indexOf(att)) % pal.chart.series.length], [pathC, pal, atts])
  const colorOf = (pt: Pt): string => (byAtt ? attColor(pt.row.att_db) : metricColor(M.of(pt)))
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
  // In a worker, whenever the dialog is open -- not only while the tab shows,
  // which made every first visit (and every visit after a new row or another
  // slice) wait for the worker and the busy indicator's 450 ms hold. It is
  // ~50 ms of the worker's time for a 7-frequency run, off this thread, so it
  // is simply ready when the tab is opened.
  const { view: areaView, pending: areaPending } = useWorkingArea(open ? areaSamples : null, limits, areaMeta)
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
    setTabIntent(v)
    cursor.set(null)
    startTabTransition(() => {
      setTab(v)
      if (v === 'area') setAreaSeen(true)
    })
  }, [cursor])

  // Mount the working area behind the Points tab once the dialog has opened
  // and painted, rather than on the first switch: mounting the figure and its
  // limit fields was most of the wait the first time the tab was opened.
  useEffect(() => {
    if (!open || areaSeen) return
    const id = window.setTimeout(() => startTabTransition(() => setAreaSeen(true)), 250)
    return () => window.clearTimeout(id)
  }, [open, areaSeen])


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
      ctx.fillText(byAtt ? 'Att (dB)' : M.label, 8, y)
      const ramp = (lo: number, hi: number) => {
        const l = M.fmt(lo)
        const h = M.fmt(hi)
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
      } else if (metricDomain == null) {
        ctx.fillText('not computable', 76, y)
      } else if (metricFlat) {
        ctx.fillText(`${M.fmt(metricDomain.min)} at every point`, 76, y)
      } else {
        ramp(metricDomain.min, metricDomain.max)
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
        nPoints={points.length} tauPs={tauPs} tab={tabIntent} onTab={onTab}
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
                  {byAtt ? 'Att' : M.label}
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
                ) : metricDomain == null ? (
                  <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
                    {metric === 'eff' ? 'not computable — needs power and current' : 'no power readings'}
                  </Typography>
                ) : metricFlat ? (
                  <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                    {M.fmt(metricDomain.min)} at every point
                  </Typography>
                ) : (
                  <>
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                      {M.fmt(metricDomain.min)}
                    </Typography>
                    <Box sx={{
                      flexGrow: 1, height: 9, borderRadius: '2px', background: BANDED_GRADIENT,
                      boxShadow: `inset 0 0 0 0.5px ${alpha(pal.sidebar.text, 0.25)}`,
                    }} />
                    <Typography sx={{ fontSize: 12, fontFamily: MONO, color: 'text.secondary' }}>
                      {M.fmt(metricDomain.max)}
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
              <PointCard
                hovered={hoverStore} points={points} hasAtt={hasAtt}
                colorBy={byAtt ? 'att' : metric} metricColor={metricColor}
              />

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
