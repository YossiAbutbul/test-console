import { memo, useState, useSyncExternalStore } from 'react'
import { Box, Button, ButtonBase, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { ActivityIndicator, MONO, PRESS_SX, SegmentedChoice, TEXT } from '../../../ui'
import { cellGamma, impedance, type Area } from '../workingArea'
import type { CursorStore } from './cursorStore'
import { DASH_TXT } from './model'
import { AREA_DEFAULT, LIMIT_ROWS, limitNum, type AreaSettings } from './areaSettings'

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
 * The working-area tab's column: the limits, then what they leave.
 *
 * Limits as a sheet of min/max pairs, blank for no limit. Under it, how much
 * of the measured area passes, the best load in it, and the interpolated
 * readings under the cursor -- the area is a map, and the cursor is how a
 * spot on it is read. Every part keeps its height whatever it shows.
 */
export const AreaPanel = memo(function AreaPanel({
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
