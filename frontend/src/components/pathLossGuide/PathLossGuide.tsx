/**
 * How to calibrate path loss: three illustrated steps in a floating sheet.
 *
 * A sheet, not a dialog: no backdrop and no focus trap, so the operator can
 * read a step, then go and turn the generator's knob or type the figure into
 * the path loss field, with the guide still open. It slides out of the Bench
 * pane's edge, the place it was opened from, and goes back the same way.
 *
 * Docked in the bottom-right corner, over the lower part of the Bench pane:
 * docked at the top it covered a page's heading, Run key and settings, and
 * beside the pane it covered the page itself. Over the pane it hides only the
 * instruments list, and leaves the path loss field it explains in view. It can be dragged
 * anywhere by its header, and stays where it was put (double-click the header
 * to dock it again).
 */
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Box, Button, ButtonBase, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightIcon from '@mui/icons-material/ChevronRightRounded'
import { useAppPalette } from '../../context/ThemeModeContext'
import { REDUCED_MOTION, SegmentedChoice, TOP_BAR_H, focusRingOf, PRESS_SX } from '../../ui'
import { usePersistedState } from '../../store/persistent'
import { STORAGE_KEYS } from '../../store/keys'
import { ChainScene, ConnectScene, LevelScene, type Meter } from './scenes'

const SHEET_W = 392
const GAP = 12
/** Apple's sheet spring (damping ~0.8, response 0.3) as a curve: a quick
 *  start that settles without a visible bounce at this size. */
const SHEET_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const SHEET_MS = 340

interface Step {
  title: string
  body: (meter: Meter) => ReactNode
  Scene: (props: { meter: Meter }) => ReactNode
}

const meterName = (m: Meter) => (m === 'analyzer' ? 'spectrum analyzer' : 'power sensor')

const STEPS: Step[] = [
  {
    title: 'Connect the reference cable',
    Scene: ConnectScene,
    body: (m) => <>Connect the signal generator to the {meterName(m)} with one short cable, and set the generator to CW at your test frequency.</>,
  },
  {
    title: 'Set 0 dBm at the meter',
    Scene: LevelScene,
    body: () => <>Turn the generator&apos;s level until the meter reads <b>0 dBm</b>, then leave it there.</>,
  },
  {
    title: 'Connect the chain',
    Scene: ChainScene,
    body: () => <>Now connect your cables and attenuators in between. The new reading, without the minus sign, is your <b>path loss</b>.</>,
  },
]

type Pos = { left: number; top: number }

/** Past a bound the sheet follows less and less, as a real thing slows before
 *  it stops; on release it settles back inside. */
function rubberband(over: number, dim: number, c = 0.55): number {
  return (over * dim * c) / (dim + c * Math.abs(over))
}

function soften(v: number, lo: number, hi: number, dim: number): number {
  if (v < lo) return lo - rubberband(lo - v, dim)
  if (v > hi) return hi + rubberband(v - hi, dim)
  return v
}

function boundsOf(el: HTMLElement) {
  const { width, height } = el.getBoundingClientRect()
  return {
    minL: GAP, maxL: Math.max(GAP, window.innerWidth - width - GAP),
    // Not over the top bar: the page's heading and keys live there.
    minT: TOP_BAR_H + GAP, maxT: Math.max(TOP_BAR_H + GAP, window.innerHeight - height - GAP),
  }
}

function clampPos(p: Pos, el: HTMLElement): Pos {
  const b = boundsOf(el)
  return {
    left: Math.min(b.maxL, Math.max(b.minL, p.left)),
    top: Math.min(b.maxT, Math.max(b.minT, p.top)),
  }
}

export function PathLossGuide({ open, onClose }: {
  open: boolean
  onClose: () => void
}) {
  const p = useAppPalette()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [meter, setMeter] = useState<Meter>('sensor')

  // Dragged position, kept between openings; null is docked.
  const [pos, setPos] = usePersistedState<Pos | null>(STORAGE_KEYS.pathLossGuidePos, null)
  const [dragging, setDragging] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const grab = useRef<{ dx: number; dy: number } | null>(null)

  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    // The close key sits in the header too: a press on it is a press.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const el = sheetRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Held where it was grabbed, not snapped to the pointer.
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId)
    setPos({ left: r.left, top: r.top })
    setDragging(true)
  }
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = grab.current
    const el = sheetRef.current
    if (!g || !el) return
    const b = boundsOf(el)
    setPos({
      left: soften(e.clientX - g.dx, b.minL, b.maxL, window.innerWidth),
      top: soften(e.clientY - g.dy, b.minT, b.maxT, window.innerHeight),
    })
  }
  const onDragEnd = () => {
    if (!grab.current) return
    grab.current = null
    setDragging(false)
    const el = sheetRef.current
    if (el) setPos((cur) => (cur ? clampPos(cur, el) : cur))
  }

  // A window made smaller must not leave the sheet outside it.
  useEffect(() => {
    if (!open) return
    const fit = () => {
      const el = sheetRef.current
      if (el) setPos((cur) => (cur ? clampPos(cur, el) : cur))
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open, setPos])

  // Kept mounted through the exit so it can slide back out; `shown` flips a
  // frame after mounting so the entry has a start to move from.
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  // Adjusted while rendering rather than in an effect, so opening mounts it
  // and closing starts the slide-out in the same render.
  if (open && !mounted) setMounted(true)
  if (!open && shown) setShown(false)
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(raf)
    }
    const id = window.setTimeout(() => setMounted(false), SHEET_MS)
    return () => window.clearTimeout(id)
  }, [open])

  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (shown) headingRef.current?.focus({ preventScroll: true })
  }, [shown])

  const go = (to: number) => {
    if (to < 0 || to >= STEPS.length || to === step) return
    setDir(to > step ? 1 : -1)
    setStep(to)
  }

  if (!mounted) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <Box
      ref={sheetRef}
      role="complementary"
      aria-label="Path loss calibration guide"
      onKeyDown={(e) => {
        // Only while focus is in the sheet: it is not modal, so the keys stay
        // the page's everywhere else.
        if (e.key === 'Escape') { e.stopPropagation(); onClose() }
        if (e.target instanceof HTMLInputElement) return
        if (e.key === 'ArrowRight') go(step + 1)
        if (e.key === 'ArrowLeft') go(step - 1)
      }}
      sx={(t) => ({
        position: 'fixed',
        ...(pos
          ? { left: pos.left, top: pos.top }
          : { right: GAP, bottom: GAP }),
        width: SHEET_W,
        maxWidth: `calc(100vw - ${2 * GAP}px)`,
        maxHeight: `calc(100vh - ${TOP_BAR_H + 2 * GAP}px)`,
        zIndex: t.zIndex.drawer + 2,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        // A floating layer over the page: material and a soft, wide shadow,
        // and no scrim -- the page beside it stays live.
        bgcolor: alpha(p.paper, t.palette.mode === 'light' ? 0.86 : 0.82),
        backdropFilter: 'blur(24px) saturate(180%)',
        border: `1px solid ${t.palette.mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'}`,
        boxShadow: t.palette.mode === 'light'
          ? '0 18px 48px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)'
          : '0 18px 48px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        transform: shown ? 'none' : 'translateX(24px) scale(0.98)',
        transformOrigin: 'right bottom',
        opacity: shown ? 1 : 0,
        // 1:1 with the pointer while dragged; settles inside the window with
        // the sheet curve when let go past an edge.
        transition: dragging
          ? 'none'
          : `transform ${SHEET_MS}ms ${SHEET_EASE}, opacity ${SHEET_MS * 0.7}ms ease, left ${SHEET_MS}ms ${SHEET_EASE}, top ${SHEET_MS}ms ${SHEET_EASE}`,
        [REDUCED_MOTION]: { transform: 'none', transition: 'opacity 180ms ease' },
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: p.paper, backdropFilter: 'none' },
      })}
    >
      {/* Heading, and the handle the sheet is moved by. */}
      <Stack
        direction="row"
        alignItems="center"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setPos(null) }}
        title="Drag to move, double-click to dock"
        sx={{
          px: 2, pt: 2, pb: 1, gap: 1, position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none',
          // The grabber: says the sheet can be moved before anyone tries.
          '&::before': {
            content: '""', position: 'absolute', top: 6, left: '50%', width: 36, height: 4,
            ml: '-18px', borderRadius: 2, bgcolor: 'text.disabled', opacity: 0.45,
          },
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'text.secondary', letterSpacing: '0.01em' }}>
            Path loss calibration · Step {step + 1} of {STEPS.length}
          </Typography>
          <Typography
            ref={headingRef}
            tabIndex={-1}
            component="h2"
            sx={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.25, outline: 'none' }}
          >
            {s.title}
          </Typography>
        </Box>
        <Tooltip title="Close (Esc)">
          <IconButton size="small" aria-label="Close guide" onClick={onClose} sx={{ alignSelf: 'flex-start' }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ px: 2, pb: 1 }}>
        <SegmentedChoice<Meter>
          text
          fullWidth
          aria-label="Measuring instrument"
          value={meter}
          onChange={setMeter}
          options={[
            { value: 'sensor', label: 'Power sensor' },
            { value: 'analyzer', label: 'Spectrum analyzer' },
          ]}
        />
      </Box>

      {/* Clipped across: the step sliding in from 18 px to the side must not
          open a horizontal scrollbar for the length of its entry. */}
      <Box sx={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        {/* The stage and the words change together, sliding the way the
            operator is moving through the steps. */}
        <Box
          key={step}
          sx={{
            animation: `${dir > 0 ? 'plgInRight' : 'plgInLeft'} 300ms ${SHEET_EASE}`,
            '@keyframes plgInRight': { from: { opacity: 0, transform: 'translateX(18px)' }, to: { opacity: 1, transform: 'none' } },
            '@keyframes plgInLeft': { from: { opacity: 0, transform: 'translateX(-18px)' }, to: { opacity: 1, transform: 'none' } },
            [REDUCED_MOTION]: {
              animation: 'plgFade 160ms ease',
              '@keyframes plgFade': { from: { opacity: 0 }, to: { opacity: 1 } },
            },
          }}
        >
          <Box
            sx={(t) => ({
              mx: 2, mt: 0.5, px: 1.5, pt: 2.25, pb: 1,
              borderRadius: '12px',
              bgcolor: t.palette.mode === 'light' ? 'rgba(60,60,67,0.05)' : 'rgba(255,255,255,0.05)',
            })}
          >
            <s.Scene meter={meter} />
          </Box>
          <Typography sx={{ px: 2, pt: 1.5, fontSize: 13.5, lineHeight: 1.55, color: 'text.primary' }}>
            {s.body(meter)}
          </Typography>
        </Box>
      </Box>

      {/* Footer: where you are, and the way on */}
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5, gap: 1, mt: 0.5 }}>
        <Stack direction="row" sx={{ gap: 0.25, flexGrow: 1 }} role="tablist" aria-label="Steps">
          {STEPS.map((st, i) => (
            <ButtonBase
              key={st.title}
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}: ${st.title}`}
              onClick={() => go(i)}
              sx={(t) => ({
                // A 24 px target around a small dot.
                width: 24, height: 24, borderRadius: '12px',
                '&:focus-visible': { boxShadow: focusRingOf(t) },
                '& > span': {
                  width: i === step ? 18 : 6, height: 6, borderRadius: 3,
                  bgcolor: i === step ? 'primary.main' : alpha(t.palette.text.primary, 0.22),
                  transition: `width 260ms ${SHEET_EASE}, background-color 200ms ease`,
                  [REDUCED_MOTION]: { transition: 'none' },
                },
              })}
            >
              <span />
            </ButtonBase>
          ))}
        </Stack>
        <Button
          size="small"
          variant="text"
          startIcon={<ChevronLeftIcon />}
          disabled={step === 0}
          onClick={() => go(step - 1)}
          sx={PRESS_SX}
        >
          Previous
        </Button>
        <Button
          size="small"
          variant="contained"
          endIcon={last ? undefined : <ChevronRightIcon />}
          onClick={() => (last ? onClose() : go(step + 1))}
          // One width for Next and Done, so the key does not jump on the last step.
          sx={{ ...PRESS_SX, minWidth: 84 }}
        >
          {last ? 'Done' : 'Next'}
        </Button>
      </Stack>
    </Box>
  )
}
