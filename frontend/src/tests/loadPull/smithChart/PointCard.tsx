import { memo, useMemo, useSyncExternalStore } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import AdsClickIcon from '@mui/icons-material/AdsClickRounded'
import { useAppPalette } from '../../../context/ThemeModeContext'
import { MONO, TEXT } from '../../../ui'
import { VCC, dbmToW } from '../smith'
import type { CursorStore } from './cursorStore'
import { DASH_TXT, type Pt } from './model'

/**
 * The hovered point in full. Its own component, subscribed to the hover
 * store, so moving between points redraws this card and nothing else.
 */
export const PointCard = memo(function PointCard({
  hovered, points, hasAtt, colorBy, metricColor,
}: {
  hovered: CursorStore
  points: Pt[]
  hasAtt: boolean
  /** Which figure the chart's dots are coloured by -- that one is drawn in
   *  its dot's colour here, so the card and the chart agree. */
  colorBy: 'eff' | 'pout' | 'att'
  metricColor: (v: number | null) => string
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
                          color: !hp ? 'text.disabled' : colorBy === 'eff' ? metricColor(hp.eff) : 'text.primary',
                        }}
                      >
                        {hp?.eff == null ? DASH_TXT : `${(hp.eff * 100).toFixed(1)}%`}
                      </Typography>
                      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>efficiency</Typography>
                    </Box>
                    <Box>
                      <Typography
                        sx={{
                          fontFamily: MONO, fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em',
                          color: hp && colorBy === 'pout' ? metricColor(hp.row.power_dbm) : undefined,
                        }}
                      >
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
                    {colorBy === 'pout' ? (
                      <>
                        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mb: 0.25 }}>Colour = Pout</Typography>
                        <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
                          Power out of the PA, path loss added, in dBm.
                        </Typography>
                      </>
                    ) : colorBy === 'att' ? (
                      <Typography sx={{ ...TEXT.micro, color: 'text.disabled' }}>Colour = attenuator setting</Typography>
                    ) : (
                      <>
                        <Typography sx={{ ...TEXT.micro, color: 'text.disabled', mb: 0.25 }}>Colour = efficiency</Typography>
                        <EfficiencyFormula vcc={VCC} />
                      </>
                    )}
                  </Box>
                </Box>
              </Box>
    </>
  )
})

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
