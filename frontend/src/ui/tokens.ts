/**
 * Design tokens.
 *
 * Single source of truth for the sizes, weights and families that pages used
 * to hardcode. Anything that appeared as a magic number in more than one page
 * belongs here; anything colour-related belongs in `theme.ts` instead, so that
 * it stays theme-mode aware.
 */

/** The one monospace stack. Readouts, hex dumps, addresses. */
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** App chrome dimensions. Anything positioned against the shell reads these
 *  rather than re-deriving the number. */
export const TOP_BAR_H = 56
export const SIDEBAR_W = 300

/** Control heights. `md` matches MuiOutlinedInput sizeSmall so inputs and
 *  buttons on the same row line up; `lg` is for standalone action rows. */
export const CONTROL_H = { md: 36, lg: 40 } as const

/** Minimum widths for header actions, so buttons don't resize as their
 *  label changes ("Run" → "Running 3/40"). */
export const ACTION_W = { compact: 96, default: 120, wide: 148 } as const

/** Content column widths. Pages pick one instead of inventing a number.
 *  `grid` is the wide dashboard layout (stat row + two columns). */
export const PAGE_W = { form: 760, panel: 900, grid: 1040, full: 1180 } as const

/** Type scale for the roles the app actually has. */
export const TEXT = {
  /** Page title, in PageHeader. */
  title: { fontSize: 26, fontWeight: 700, lineHeight: 1.15 },
  /** Section heading inside a page. */
  section: { fontSize: 17, fontWeight: 700 },
  /** Dialog title. */
  dialog: { fontSize: 17, fontWeight: 700 },
  /** Uppercase micro-label above a value. */
  eyebrow: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  /** Large monospace measurement value. */
  readout: { fontSize: 22, fontWeight: 600, fontFamily: MONO },
  /** Field label. */
  label: { fontSize: 13, fontWeight: 500 },
  /** Explanatory copy under a control. */
  hint: { fontSize: 12 },
  /** Dense table / chip text. */
  dense: { fontSize: 11.5, fontWeight: 600 },
  /** Footnotes, raw frame dumps. */
  micro: { fontSize: 11 },
} as const

/** Bordered container used for status blocks and result panels. */
export const CARD_SX = {
  p: 2,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
} as const

/**
 * Density constants for the data-dense instrument layout.
 *
 * The whole point of this app is reading numbers off hardware, so the layout
 * is tuned for information per screen, not for breathing room: 12px inside a
 * panel, 8px between them. Anything looser and a sweep result stops fitting
 * without scrolling.
 */
export const GRID_GAP = 8
export const CARD_PAD = 12
export const TILE_PAD = 12

/** Panel surface — a plain hairline container. No shadow and no radius beyond
 *  the app's 6px: depth is reserved for things that actually float (menus,
 *  dialogs), so panels sitting in the page stay flat. */
export const PANEL_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
} as const

/** Colour roles that encode *state*, not decoration. A tile or heading only
 *  takes one when the colour means something the user must act on. */
export type TileAccent = 'blue' | 'teal' | 'amber' | 'purple' | 'red' | 'neutral'
