import { alpha, type Theme } from '@mui/material/styles'

/**
 * How controls answer the hand: the focus ring, the press, and motion that
 * steps aside when the operator asks for less of it. One definition, so a
 * kit piece built on ButtonBase (LatchingKey, a segment, an inspector row)
 * feels the same as an MUI Button beside it -- the critique found the latching
 * Modem key was the only key in the toolbar that gave nothing on press.
 */

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'

/** The keyboard focus ring: a 1 px accent line just outside the control,
 *  drawn as a shadow so it never changes a control's size. (It was 3 px, then
 *  2; the operator found both too thick.) Kept the same as the theme's own
 *  `focusRing`. */
export function focusRing(accent: string, light: boolean): string {
  return `0 0 0 1px ${alpha(accent, light ? 0.6 : 0.7)}`
}

export function focusRingOf(t: Theme): string {
  return focusRing(t.palette.info.main, t.palette.mode === 'light')
}

/** Press feedback on pointer-down: the key gives under the pointer. A
 *  transform, so nothing around it moves. Pair with `transform` in the
 *  control's own `transition`. */
export const PRESS_SX = {
  '&:active:not(.Mui-disabled)': { transform: 'scale(0.97)' },
  [REDUCED_MOTION]: { '&:active:not(.Mui-disabled)': { transform: 'none' } },
} as const

/** Scroll behaviour for programmatic scrolls (a new result row, a check on
 *  the course): smooth, unless the operator asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}
