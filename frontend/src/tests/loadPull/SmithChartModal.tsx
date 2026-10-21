import { useMemo, useRef, useState } from 'react'
import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Stack,
  TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ContentCopyIcon from '@mui/icons-material/ContentCopyRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import { useAppPalette, useThemeMode } from '../../context/ThemeModeContext'
import { MONO, MiniAction, TEXT } from '../../ui'
import { TOP_BAR_H } from '../../ui/tokens'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { Z0, VCC, RAMP, reflection, dbmToW, efficiency, rampColor, chartRows } from './smith'

interface Pt {
  x: number; y: number
  gr: number; gi: number
  idx: number // index in the whole run, so idx + 1 matches the results table's #
  row: LoadPullResultRow
  eff: number | null // drain efficiency (fraction), null if not computable
}

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

export function SmithChartModal({
  open, onClose, results,
}: {
  open: boolean
  onClose: () => void
  results: LoadPullResultRow[]
}) {
  // Grid, ink and ground come from the theme like every other chart, rather
  // than blue-grey values of the chart's own that read as a different product.
  const pal = useAppPalette()
  const { mode } = useThemeMode()
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
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

  // Default to the first of each once results arrive, and re-anchor if the
  // current pick is not in the data (a new run, or an imported file).
  const freq = pickedFreq != null && freqs.includes(pickedFreq) ? pickedFreq : freqs[0] ?? null
  const power = pickedPower != null && powers.includes(pickedPower) ? pickedPower : powers[0] ?? null

  // Each row keeps its index in the whole run, so "Step N" here is "#N" in
  // the results table. The filtering rules are documented on chartRows.
  const shown = useMemo(() => chartRows(results, freq, power), [results, freq, power])

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

  const effSpan = effDomain ? effDomain.max - effDomain.min : 0
  // Three points that differ only in the noise still print the same figure
  // at both ends, and a full colour ramp between two identical numbers reads
  // as though the colours mean something. Compare the rendered values.
  const effFlat = effDomain != null
    && (effDomain.min * 100).toFixed(1) === (effDomain.max * 100).toFixed(1)

  const colorOf = (eff: number | null): string => {
    if (eff == null || !effDomain) return pal.sidebar.successOff
    // Every point measured the same: colour carries no information, so use one
    // neutral tone rather than painting them all at the ramp's cold end.
    if (effSpan === 0 || effFlat) return rampColor(0.5)
    return rampColor((eff - effDomain.min) / effSpan)
  }

  const grid = pal.chart.grid
  const axis = pal.chart.axis
  const pathC = pal.sidebar.textDim

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

      // Efficiency scale, mirroring what the dialog shows.
      const ink = pal.sidebar.textDim
      ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      const y = S + LEGEND_H / 2
      ctx.fillStyle = ink
      ctx.fillText('Efficiency', 8, y)
      if (effDomain == null) {
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
  const fmtPct = (e: number | null) => (e == null ? '—' : `${(e * 100).toFixed(1)} %`)

  return (
    <Dialog
      open={open} onClose={onClose} maxWidth="lg" fullWidth
      // Below the toolbar, scrim included: this can be opened mid-run, and a
      // scrim over the whole window hid E-STOP and Stop behind it. Focus is
      // not held inside either, so the keyboard can reach them too.
      sx={{ top: TOP_BAR_H }}
      disableEnforceFocus
      slotProps={{
        paper: { sx: { height: '88vh' } },
        backdrop: { sx: { top: TOP_BAR_H } },
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
      {(freqs.length > 1 || powers.length > 1) && (
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
                <Box sx={{ minHeight: 0, overflowY: 'auto' }}>
                  {points.map((pt) => {
                    const on = pt.idx === hover
                    return (
                      <Stack
                        key={pt.idx}
                        direction="row"
                        onMouseEnter={() => setHover(pt.idx)}
                        onMouseLeave={() => setHover(null)}
                        sx={{
                          px: 1.25, py: 0.5, cursor: 'default',
                          fontFamily: MONO, fontSize: 12,
                          bgcolor: on ? 'action.selected' : 'transparent',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Box sx={{ width: 26, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {/* The same colour the point carries on the chart,
                              so a row and its dot are findable from each other. */}
                          <Box sx={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            bgcolor: colorOf(pt.eff),
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
                  })}
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
                  {rCircles.map((c, i) => <circle key={`r${i}`} cx={c.cx} cy={c.cy} r={c.rr} stroke={grid} />)}
                  {xArcs.map((c, i) => <circle key={`x${i}`} cx={c.cx} cy={c.cy} r={c.rr} stroke={grid} />)}
                  <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={axis} strokeWidth={1.25} />
                </g>
                <circle cx={cx} cy={cy} r={R} fill="none" stroke={axis} strokeWidth={1.75} />

                {/* Trajectory — one line per attenuator setting.
                    Each setting is its own trombone cycle, so a single polyline
                    joined the end of one cycle to the start of the next and drew
                    a chord straight across the chart that no measurement made. */}
                {traces.map((trace) => (
                  <polyline
                    key={trace.key}
                    points={trace.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke={pathC} strokeWidth={1.25} strokeOpacity={0.6}
                  />
                ))}

                {/* points colored by efficiency */}
                {points.map((p) => {
                  const isHover = p.idx === hover
                  return (
                    <circle
                      key={p.idx}
                      cx={p.x} cy={p.y}
                      r={isHover ? 7 : 4.5}
                      fill={colorOf(p.eff)}
                      // On white the paper-coloured edge vanished and the pale
                      // yellow end of the ramp went with it; a faint ink edge
                      // keeps every dot findable whatever its colour.
                      stroke={isHover
                        ? pal.sidebar.text
                        : mode === 'light' ? alpha(pal.sidebar.text, 0.35) : pal.paper}
                      strokeWidth={isHover ? 2 : 0.8}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHover(p.idx)}
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
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, px: 0.5 }}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  Efficiency
                </Typography>
                {effDomain == null ? (
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
            <Box sx={{ width: 290, flexShrink: 0 }}>
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
                    <Row label="Efficiency" value={fmtPct(hp?.eff ?? null)} strong color={hp ? colorOf(hp.eff) : undefined} />
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
