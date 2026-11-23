import { memo, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { MONO, SegmentedChoice } from '../../../ui'
import type { LoadPullResultRow } from '../../../store/loadPullPageStore'
import type { Extreme, MetricStats, PointStats } from '../smithStats'

/** The readings the stats card sums up: label, unit, and how a value is
 *  printed. */
const STAT_COLS = [
  { key: 'pout', label: 'Pout', unit: 'dBm', fmt: (v: number) => v.toFixed(1) },
  { key: 'eff', label: 'Eff', unit: '%', fmt: (v: number) => (v * 100).toFixed(1) },
  { key: 'cc', label: 'CC', unit: 'mA', fmt: (v: number) => (v * 1000).toFixed(0) },
] as const
type StatKey = (typeof STAT_COLS)[number]['key']

/** Label, range bar, then Min / Avg / Max: one grid for the head and rows,
 *  sized so the bar keeps ~90 px inside DETAIL_W (SmithChartModal.tsx). */
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
export const StatsCard = memo(function StatsCard({
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
