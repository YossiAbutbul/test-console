/**
 * The format bar's own colour picker, in place of the system's dialog: a
 * saturation / brightness square, a hue strip, the hex code, and the colour
 * before and after side by side.
 *
 * The square and the strip follow the pointer 1:1 from where they are
 * grabbed and keep tracking outside their edges, the knob clamped to the
 * edge. Nothing here takes the focus except the hex field, so the words
 * being coloured stay selected while a colour is found; the field says when
 * it has the focus (onEditing) so the bar can hold on to them.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Box, ButtonBase, InputBase, Typography } from '@mui/material'
import BackIcon from '@mui/icons-material/ChevronLeftRounded'

interface Hsv { h: number; s: number; v: number }

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: h * 60, s: max ? d / max : 0, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1))
  }
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

/** Pointer tracking for the square and the strip: grabbed, followed beyond
 *  the edges, released. */
function useTrack(onMove: (x: number, y: number) => void) {
  const el = useRef<HTMLDivElement>(null)
  const at = (e: ReactPointerEvent) => {
    const r = el.current!.getBoundingClientRect()
    onMove(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height))
  }
  return {
    ref: el,
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault()
      try { el.current?.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
      at(e)
    },
    onPointerMove: (e: ReactPointerEvent) => { if (el.current?.hasPointerCapture(e.pointerId)) at(e) },
  }
}

export function ColorPicker({ title, initial, onApply, onBack, onEditing }: {
  title: string
  initial: string
  onApply: (hex: string) => void
  onBack: () => void
  /** The hex field has the focus (true) or gave it back (false). */
  onEditing: (on: boolean) => void
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial))
  const hex = hsvToHex(hsv)
  const [typed, setTyped] = useState<string | null>(null)
  const square = useTrack((x, y) => { setTyped(null); setHsv((c) => ({ ...c, s: x, v: 1 - y })) })
  const strip = useTrack((x) => { setTyped(null); setHsv((c) => ({ ...c, h: x * 360 })) })
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 })

  /** A typed code as #RRGGBB (three digits allowed), or null. */
  const parseHex = (v: string) => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim())
    if (!m) return null
    return `#${m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]}`.toUpperCase()
  }

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: -0.5 }}>
        <ButtonBase aria-label="Back to the swatches" onClick={onBack} disableRipple sx={{
          width: 24, height: 24, borderRadius: '6px', color: '#0071E3',
          '&:hover': { bgcolor: 'rgba(0, 113, 227, 0.08)' },
        }}>
          <BackIcon sx={{ fontSize: 20 }} />
        </ButtonBase>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#1D1D1F' }}>{title}</Typography>
      </Box>

      {/* Saturation across, brightness up, in the strip's hue. */}
      <Box {...square} role="slider" aria-label="Saturation and brightness"
        aria-valuetext={hex} sx={{
          position: 'relative', height: 128, borderRadius: '8px', cursor: 'crosshair', touchAction: 'none',
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #FFF, ${pure})`,
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.15)',
        }}>
        <Box sx={{
          position: 'absolute', left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
          width: 16, height: 16, borderRadius: '50%', transform: 'translate(-50%, -50%)', bgcolor: hex,
          boxShadow: '0 0 0 2.5px #FFF, 0 0 0 3px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.3)', pointerEvents: 'none',
        }} />
      </Box>

      <Box {...strip} role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)} sx={{
          position: 'relative', height: 14, borderRadius: '7px', cursor: 'pointer', touchAction: 'none',
          background: 'linear-gradient(to right, #F00, #FF0, #0F0, #0FF, #00F, #F0F, #F00)',
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.15)',
        }}>
        <Box sx={{
          position: 'absolute', top: '50%', left: `${(hsv.h / 360) * 100}%`, width: 16, height: 16, borderRadius: '50%',
          transform: 'translate(-50%, -50%)', bgcolor: pure,
          boxShadow: '0 0 0 2.5px #FFF, 0 0 0 3px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.3)', pointerEvents: 'none',
        }} />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {/* Before and after, as the system picker shows them. */}
        <Box aria-hidden sx={{
          display: 'flex', width: 34, height: 26, borderRadius: '7px', overflow: 'hidden', flexShrink: 0,
          boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.2)',
        }}>
          <Box sx={{ flex: 1, bgcolor: initial }} />
          <Box sx={{ flex: 1, bgcolor: hex }} />
        </Box>
        <InputBase
          value={typed ?? hex}
          inputProps={{ 'aria-label': 'Hex colour', spellCheck: false, maxLength: 7 }}
          // The one control here that takes the focus: it must, to be typed in.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={() => onEditing(true)}
          onBlur={() => { onEditing(false); setTyped(null) }}
          onChange={(e) => {
            setTyped(e.target.value)
            const h = parseHex(e.target.value)
            if (h) setHsv(hexToHsv(h))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onApply(parseHex(typed ?? hex) ?? hex)
            }
            if (e.key === 'Escape') onBack()
          }}
          sx={{
            flex: 1, minWidth: 0, height: 26, px: 1, borderRadius: '7px', bgcolor: '#FFF',
            fontSize: 12.5, fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace', color: '#1D1D1F',
            boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.2)',
            '&.Mui-focused': { boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.2), 0 0 0 3px rgba(0, 113, 227, 0.28)' },
            '& input': { p: 0 },
          }}
        />
        <ButtonBase onClick={() => onApply(hex)} disableRipple sx={{
          height: 26, px: 1.25, borderRadius: '7px', bgcolor: '#0071E3', color: '#FFF', fontSize: 12.5, fontWeight: 600,
          transition: 'background-color 120ms ease, transform 100ms ease',
          '&:hover': { bgcolor: '#0077ED' }, '&:active': { transform: 'scale(0.96)' },
        }}>
          Apply
        </ButtonBase>
      </Box>
    </Box>
  )
}
