import { useMediaQuery } from '@mui/material'
import { SHELL_NARROW_W, SIDEBAR_W, SIDEBAR_W_NARROW } from './tokens'

export interface ShellLayout {
  /** The window is too narrow to dock the log beside the page. */
  narrow: boolean
  /** Width the sidebar should occupy right now. */
  sidebarW: number
}

/**
 * How the app shell arranges itself at the current window width.
 *
 * One hook rather than a `sx` breakpoint per call site because the two
 * consumers — `App` and `Sidebar` — have to agree: the top bar reserves the
 * sidebar's width as a plain `flexShrink: 0` box, and if that number and the
 * drawer's disagree by even a few pixels the title in the bar stops lining up
 * with the menu under it.
 */
export function useShellLayout(): ShellLayout {
  const narrow = useMediaQuery(`(max-width:${SHELL_NARROW_W - 1}px)`)
  return { narrow, sidebarW: narrow ? SIDEBAR_W_NARROW : SIDEBAR_W }
}
