import { useLayoutEffect, useRef } from 'react'
import { Box, InputAdornment } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/**
 * End-adornment for a text/number field that shows an instant validation
 * message when `show` is true. The message bubble is rendered locally (NOT a
 * portaled MUI Tooltip) so it stays inside the field's DOM subtree — that way
 * it disappears when the field's page is hidden (all test pages stay mounted
 * via display:none) instead of orphaning to the top-left of the screen.
 *
 * Drop into a field via `InputProps={{ endAdornment: <ValidationAdornment … /> }}`.
 */

/** Gap between the field and the bubble, and the size of its arrow. */
const GAP = 8

/**
 * When to surface the validation message:
 *  - valid              → never
 *  - invalid, non-empty → always (even while focused)
 *  - invalid, empty     → only when NOT focused (don't nag mid-typing/deleting)
 */
export const shouldShowValidation = (raw: string, valid: boolean, focused: boolean): boolean =>
  !valid && (raw.trim() !== '' || !focused)

/**
 * The rectangle the bubble cannot be drawn outside of.
 *
 * Being a local element rather than a portaled tooltip, it is clipped by the
 * nearest scrolling ancestor — no z-index escapes an ancestor's overflow. So
 * find that ancestor and let the caller place the bubble inside it.
 */
function clipRect(from: HTMLElement): { top: number; bottom: number } {
  for (let el = from.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY !== 'visible') {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom }
    }
  }
  return { top: 0, bottom: window.innerHeight }
}

export function ValidationAdornment({ show, message }: { show: boolean; message: string }) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  /**
   * Flip the bubble below the field when there is no room above it.
   *
   * Above is the default because it covers the row being edited rather than
   * the next one down, but the first row of a sweep table has the panel's
   * scroll edge immediately above it — the bubble was drawn half-cut, over the
   * column headings.
   *
   * Written straight to the DOM rather than held in state: this is a
   * measure-then-place, and a setState here would re-render every keystroke to
   * say what the style already says. Runs on every render, before paint, so
   * there is no frame with the bubble in the wrong place.
   */
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    const anchor = anchorRef.current
    if (!bubble || !anchor) return
    const a = anchor.getBoundingClientRect()
    const needed = bubble.getBoundingClientRect().height + GAP
    const clip = clipRect(anchor)
    // Only flip if below is actually better — in a panel too short for the
    // bubble either way, above at least keeps it near the field it belongs to.
    const below = a.top - needed < clip.top && a.bottom + needed <= clip.bottom
    bubble.style.top = below ? `calc(100% + ${GAP}px)` : 'auto'
    bubble.style.bottom = below ? 'auto' : `calc(100% + ${GAP}px)`
    bubble.dataset.placement = below ? 'below' : 'above'
  })

  if (!show) return null
  return (
    <InputAdornment ref={anchorRef} position="end" sx={{ position: 'relative', overflow: 'visible' }}>
      <InfoOutlinedIcon sx={{ fontSize: 17, color: 'error.main' }} />
      <Box
        ref={bubbleRef}
        role="alert"
        data-placement="above"
        sx={{
          position: 'absolute',
          // Both edges are rewritten by the layout effect above; these are the
          // starting placement it measures from.
          bottom: `calc(100% + ${GAP}px)`,
          top: 'auto',
          right: -4,
          px: 1, py: 0.5,
          borderRadius: 1,
          bgcolor: 'grey.900',
          color: '#fff',
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1.35,
          // Wraps inside a fixed width rather than running off on one line.
          // The bubble is a local element, not a portaled tooltip (see above),
          // so it is clipped by whichever panel scrolls — a long single-line
          // message simply disappears off the edge, which is how it was found.
          whiteSpace: 'normal',
          width: 'max-content',
          maxWidth: 190,
          textAlign: 'right',
          boxShadow: 3,
          // Above the fields it overlaps. It cannot escape an ancestor's
          // overflow whatever this is set to — hence the width cap above and
          // the flip below, which are what actually keep it on screen.
          zIndex: 20,
          pointerEvents: 'none',
          // Arrow, pointing back at the field from whichever side it ended up.
          '&::after': {
            content: '""',
            position: 'absolute',
            right: 8,
            border: '5px solid transparent',
          },
          '&[data-placement="above"]::after': {
            top: '100%',
            borderTopColor: 'grey.900',
          },
          '&[data-placement="below"]::after': {
            bottom: '100%',
            borderBottomColor: 'grey.900',
          },
        }}
      >
        {message}
      </Box>
    </InputAdornment>
  )
}
