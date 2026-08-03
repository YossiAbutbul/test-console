/**
 * Sweep results — which settings reach a power for the least current.
 *
 * That is the question the sweep exists to answer, and it drives the layout.
 * The first view is the trade-off curve: for every power the DUT actually
 * reached, the lowest current any combination needed to hold it. Picking a
 * point on that curve gives the combinations that produced it, cheapest first.
 *
 * Grouping matches the workbook (`backend/sweep/export.py`): rounded *measured*
 * power, ignoring the sensor's under-range sentinel, so the export and this
 * cannot disagree about what the run found.
 */
import { useMemo, useState } from 'react'
import {
  Box, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Select, Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ResultRow } from '../../types/models'
import { useAppPalette } from '../../context/ThemeModeContext'
import { MONO } from '../../ui'
import {
  buildLevels, comboLabel as combo, milliamps as mA,
} from './bestSettings'

const CURVE_COLOR = '#2563EB'

interface Props {
  open: boolean
  onClose: () => void
  rows: ResultRow[]
}

export function SweepResultsModal({ open, onClose, rows }: Props) {
  const p = useAppPalette()
  const levels = useMemo(() => buildLevels(rows), [rows])
  const [picked, setPicked] = useState<number | null>(null)

  // Default to the strongest power measured — the usual starting question is
  // "how cheaply can it hold its maximum".
  const active = levels.find((l) => l.power === picked) ?? levels[0] ?? null

  // Ascending for the curve: current should read left-to-right as power climbs.
  const curve = useMemo(
    () => levels
      .filter((l) => l.bestMa != null)
      .map((l) => ({ power: l.power, current: l.bestMa as number, combo: l.best ? combo(l.best) : '' }))
      .sort((a, b) => a.power - b.power),
    [levels],
  )

  const worstMa = active
    ? Math.max(...active.rows.map((r) => mA(r) ?? 0))
    : 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      transitionDuration={{ enter: 150, exit: 0 }}
      slotProps={{ paper: { sx: { borderRadius: 2, height: 640, maxHeight: '92vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <Stack direction="row" alignItems="baseline" spacing={1.5}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Best settings</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {rows.length} rows · {levels.length} power level{levels.length === 1 ? '' : 's'} reached
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, pt: 0, gap: 1.5 }}>
        {levels.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', m: 'auto' }}>
            No measured rows yet. Run the sweep first.
          </Typography>
        ) : (
          <>
            {/* The trade-off itself: what each dB of output costs in current. */}
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>
                Lowest current per power reached
              </Typography>
              <Box sx={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={curve}
                    margin={{ top: 6, right: 12, bottom: 20, left: 0 }}
                    onClick={(e: { activeLabel?: string | number }) => {
                      const v = Number(e?.activeLabel)
                      if (Number.isFinite(v)) setPicked(v)
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.18)" />
                    <XAxis
                      dataKey="power"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Measured power (dBm)', position: 'bottom', offset: 2, fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={50}
                      label={{ value: 'Current (mA)', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(v: number | string) => (typeof v === 'number' ? `${v.toFixed(1)} mA` : v)}
                      labelFormatter={(x) => {
                        const pt = curve.find((c) => c.power === Number(x))
                        return pt ? `${x} dBm — ${pt.combo}` : `${x} dBm`
                      }}
                    />
                    <Line
                      name="Lowest current"
                      type="monotone"
                      dataKey="current"
                      stroke={CURVE_COLOR}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Box>

            {/* Drill-down: every combination that held the chosen power. */}
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.secondary' }}>
                Combinations at
              </Typography>
              <Select
                size="small"
                value={active ? active.power : ''}
                onChange={(e) => setPicked(Number(e.target.value))}
                sx={{ height: 28, fontSize: 12.5, fontFamily: MONO, minWidth: 110 }}
              >
                {levels.map((l) => (
                  <MenuItem key={l.power} value={l.power} sx={{ fontSize: 12.5, fontFamily: MONO }}>
                    {l.power} dBm ({l.rows.length})
                  </MenuItem>
                ))}
              </Select>
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                cheapest first — click the curve to jump
              </Typography>
            </Stack>

            <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
              {active?.rows.map((r, i) => {
                const cur = mA(r)
                const isBest = active.best != null && r.idx === active.best.idx
                // Bar length is relative to the worst at this power, so the
                // saving from picking the winner is the visible difference.
                const pct = cur != null && worstMa > 0 ? (cur / worstMa) * 100 : 0
                return (
                  <Stack
                    key={r.idx}
                    direction="row"
                    alignItems="center"
                    spacing={1.25}
                    sx={{
                      px: 1, py: 0.6,
                      borderRadius: 1,
                      bgcolor: isBest ? p.data.highlight : undefined,
                    }}
                  >
                    <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                      {isBest
                        ? <EmojiEventsIcon sx={{ fontSize: 15, color: p.data.ok }} />
                        : <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{i + 1}</Typography>}
                    </Box>
                    <Typography
                      sx={{
                        fontFamily: MONO, fontSize: 12.5, width: 190, flexShrink: 0,
                        fontWeight: isBest ? 700 : 400,
                        color: isBest ? 'text.primary' : 'text.secondary',
                      }}
                    >
                      {combo(r)}
                    </Typography>
                    <Box sx={{ flexGrow: 1, minWidth: 40, height: 7, bgcolor: 'action.hover', borderRadius: 4, overflow: 'hidden' }}>
                      <Box
                        sx={{
                          width: `${pct}%`, height: '100%',
                          bgcolor: isBest ? p.data.ok : 'text.disabled',
                          opacity: isBest ? 1 : 0.5,
                        }}
                      />
                    </Box>
                    <Typography
                      sx={{
                        fontFamily: MONO, fontSize: 12.5, width: 76, textAlign: 'right', flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: isBest ? 700 : 400,
                        color: isBest ? p.data.ok : 'text.primary',
                      }}
                    >
                      {cur == null ? '—' : `${cur.toFixed(1)} mA`}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: MONO, fontSize: 11.5, width: 66, textAlign: 'right', flexShrink: 0,
                        color: 'text.disabled',
                      }}
                    >
                      {r.tx_power_dbm == null ? '—' : `${r.tx_power_dbm.toFixed(2)}`}
                    </Typography>
                  </Stack>
                )
              })}
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
