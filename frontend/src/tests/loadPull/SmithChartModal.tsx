import { useMemo, useState } from 'react'
import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useThemeMode } from '../../context/ThemeModeContext'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { Z0, VCC, RAMP, reflection, dbmToW, efficiency, rampColor } from './smith'

interface Pt {
  x: number; y: number
  gr: number; gi: number
  idx: number
  row: LoadPullResultRow
  eff: number | null // drain efficiency (fraction), null if not computable
}

export function SmithChartModal({
  open, onClose, results, freqMhz,
}: {
  open: boolean
  onClose: () => void
  results: LoadPullResultRow[]
  freqMhz: number
}) {
  const { mode } = useThemeMode()
  const dark = mode !== 'light'
  const [hover, setHover] = useState<number | null>(null)

  const S = 520
  const R = S / 2 - 24
  const cx = S / 2
  const cy = S / 2

  const points: Pt[] = useMemo(() => {
    const out: Pt[] = []
    results.forEach((row, idx) => {
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
  }, [results])

  // Efficiency color domain from the finite values present.
  const effDomain = useMemo(() => {
    const vals = points.map((p) => p.eff).filter((e): e is number => e != null)
    if (vals.length === 0) return null
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [points])

  const colorOf = (eff: number | null): string => {
    if (eff == null || !effDomain) return dark ? '#6b7280' : '#9ca3af'
    const span = effDomain.max - effDomain.min || 1
    return rampColor((eff - effDomain.min) / span)
  }

  const grid = dark ? '#3a4150' : '#d3d8e0'
  const axis = dark ? '#586173' : '#aab2bf'
  const pathC = dark ? '#5b6472' : '#c2c8d2'

  const rCircles = [0, 0.2, 0.5, 1, 2, 5].map((r) => ({
    cx: cx + (r / (1 + r)) * R, cy, rr: (1 / (1 + r)) * R,
  }))
  const xArcs = [0.2, 0.5, 1, 2, 5].flatMap((x) => [x, -x]).map((x) => ({
    cx: cx + 1 * R, cy: cy - (1 / x) * R, rr: Math.abs(1 / x) * R,
  }))

  const hp = hover != null ? points.find((p) => p.idx === hover) ?? null : null
  const fmtPct = (e: number | null) => (e == null ? '—' : `${(e * 100).toFixed(1)} %`)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md"
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="baseline">
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Smith Chart</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {points.length} point{points.length === 1 ? '' : 's'} · {freqMhz} MHz · Z₀ = {Z0} Ω
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'action.hover' }}>
        {points.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 6, textAlign: 'center' }}>
            No R/J data to plot. Run the test first.
          </Typography>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {/* Chart + legend */}
            <Box sx={{ flexShrink: 0 }}>
              <svg
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

                {/* trajectory */}
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={pathC} strokeWidth={1.25} strokeOpacity={0.6}
                />

                {/* points colored by efficiency */}
                {points.map((p) => {
                  const isHover = p.idx === hover
                  return (
                    <circle
                      key={p.idx}
                      cx={p.x} cy={p.y}
                      r={isHover ? 7 : 4.5}
                      fill={colorOf(p.eff)}
                      stroke={isHover ? (dark ? '#fff' : '#111') : '#ffffff'}
                      strokeWidth={isHover ? 2 : 0.8}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHover(p.idx)}
                    />
                  )
                })}
                <circle cx={cx} cy={cy} r={2} fill={axis} />
              </svg>

              {/* efficiency legend */}
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, px: 0.5 }}>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  Efficiency
                </Typography>
                <Typography sx={{ fontSize: 11.5, fontFamily: 'ui-monospace, monospace', color: 'text.secondary' }}>
                  {effDomain ? `${(effDomain.min * 100).toFixed(1)}%` : '—'}
                </Typography>
                <Box sx={{
                  flexGrow: 1, height: 10, borderRadius: 5,
                  background: `linear-gradient(to right, ${RAMP.join(', ')})`,
                }} />
                <Typography sx={{ fontSize: 11.5, fontFamily: 'ui-monospace, monospace', color: 'text.secondary' }}>
                  {effDomain ? `${(effDomain.max * 100).toFixed(1)}%` : '—'}
                </Typography>
              </Stack>
            </Box>

            {/* Hover info panel */}
            <Box sx={{ width: 240, flexShrink: 0 }}>
              <Box sx={{ p: 2, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                {hp ? (
                  <>
                    <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>
                      Measurement
                    </Typography>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>
                      Step {hp.idx + 1} · pos {hp.row.pos_mm.toFixed(2)} mm
                    </Typography>
                    <Stack spacing={0.75}>
                      <Row label="Efficiency" value={fmtPct(hp.eff)} strong color={colorOf(hp.eff)} />
                      <Row label="Pout" value={hp.row.power_dbm == null ? '—' : `${hp.row.power_dbm.toFixed(2)} dBm`} />
                      <Row label="Pout (W)" value={hp.row.power_dbm == null ? '—' : dbmToW(hp.row.power_dbm).toFixed(3)} />
                      <Row label="Icc" value={hp.row.current_a == null ? '—' : `${(hp.row.current_a * 1000).toFixed(1)} mA`} />
                      <Row label="Z" value={hp.row.r_ohm == null || hp.row.x_ohm == null ? '—'
                        : `${hp.row.r_ohm.toFixed(1)} ${hp.row.x_ohm >= 0 ? '+' : '−'} j${Math.abs(hp.row.x_ohm).toFixed(1)} Ω`} />
                      <Row label="|S11|" value={hp.row.s11_db == null ? '—' : `${hp.row.s11_db.toFixed(2)} dB`} />
                      <Row label="Γ" value={`${hp.gr.toFixed(3)} ${hp.gi >= 0 ? '+' : '−'} j${Math.abs(hp.gi).toFixed(3)}`} />
                      <Row label="Pos (pulses)" value={hp.row.pos_pulses.toLocaleString()} />
                    </Stack>
                    {hp.row.error && (
                      <Typography sx={{ fontSize: 11.5, color: 'error.main', mt: 1 }}>{hp.row.error}</Typography>
                    )}
                  </>
                ) : (
                  <>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
                      Hover a point to see its measurement. Color = efficiency:
                    </Typography>
                    <EfficiencyFormula vcc={VCC} />
                  </>
                )}
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
        fontFamily: 'ui-monospace, monospace',
        color: color ?? 'text.primary',
      }}>
        {value}
      </Typography>
    </Stack>
  )
}
