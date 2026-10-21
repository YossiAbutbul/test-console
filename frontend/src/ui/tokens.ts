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
export const TOP_BAR_H = 52
export const SIDEBAR_W = 240

/**
 * Below this window width the shell stops being three docked columns.
 *
 * Half of a 1920 screen is 960px; with a 300px sidebar and a 340px docked log
 * that left ~300px for the page, which is narrower than a single results
 * table. Past this point the log floats over the content instead of taking a
 * share of it, and the sidebar gives some width back. Chosen off the window,
 * not the content area: it decides how the shell itself is arranged. Anything
 * *inside* the content area should size off a container query instead, since
 * the page's width depends on the dock as much as on the window.
 */
export const SHELL_NARROW_W = 1200

/** Sidebar width once past `SHELL_NARROW_W`. Still fits the longest page label
 *  ("Spectrum Analyzer", with its glyph) at one line. */
export const SIDEBAR_W_NARROW = 224

/** Control heights. One height, `md`, for every field, key, icon key and
 *  segmented control in a row, so nothing on a line is a few pixels off its
 *  neighbour: the theme sizes MUI's inputs, buttons and icon buttons to it.
 *  `sm` is for controls inside a table row; `lg` for a standalone action row.
 *  32, not MUI's 36-40: the macOS regular-size control is 28 and a bench is
 *  driven with a mouse, but 32 keeps a comfortable target. */
export const CONTROL_H = { sm: 28, md: 32, lg: 36 } as const

/**
 * Widths for header actions. Fixed, not minimum: a button must not change
 * size when its state does ("Run" → "Running 312/616" → "Needs DUT",
 * "Stop" → "Stopping…", "Connect" → "Disconnect"). A key that grows or
 * shrinks under the pointer moves its neighbours, and on this rig the
 * neighbour of Stop is Run. Each width holds the longest label its control
 * ever shows, with its icon.
 */
export const ACTION_W = { compact: 96, default: 120, wide: 148, run: 176 } as const

/** Content column widths. Pages pick one instead of inventing a number.
 *  `grid` is the wide dashboard layout; `fluid` fills whatever the content
 *  area gives it, for pages whose panels are readouts rather than prose. */
export const PAGE_W = {
  form: 760, panel: 900, grid: 1040, full: 1180, fluid: '100%',
} as const

/** Narrowest a labelled input column may get before its label starts to clip.
 *  Field grids use it to decide how many columns their container can hold. */
export const FIELD_MIN_W = 150

/** Widest a column of text inputs should get. Past this a number field is all
 *  empty box, and the label drifts away from the value it belongs to. */
export const FIELD_MAX_W = 780

/**
 * Type scale for the roles the app actually has.
 *
 * Nothing in the UI is set below 12 px. The scale used to run down to 10 and
 * 10.5 px for eyebrows, chips and footnotes, which on a bench monitor read
 * from a step away is not text but texture -- and those were often the
 * labels saying what a number meant. Steps above the floor are 12 (labels,
 * metadata), 12.5 (summaries, table headings), 13 (field labels), 14.5
 * (body), 15 (card titles and the toolbar's page title), 17 (dialog
 * headings); readouts sit at 24 in the mono face. (The page title was 26 in
 * the page until it moved into the window toolbar.)
 */
export const TEXT = {
  /** Page title, in the window toolbar (PageHeader). */
  title: { fontSize: 15, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' },
  /** The sidebar section under the toolbar title. */
  crumb: { fontSize: 12, lineHeight: 1.25 },
  /** Section heading inside a page. */
  section: { fontSize: 17, fontWeight: 700 },
  /** Dialog title. */
  dialog: { fontSize: 17, fontWeight: 700 },
  /** The title Section draws over a panel. For a slim stand-in row that has
   *  to read as the same panel (e.g. a folded-away table). Sentence case at
   *  15 px rather than a 12 px uppercase eyebrow: a card's name is a heading,
   *  and spaced capitals at that size read as texture. Slight negative
   *  tracking, as headings get at this size. */
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  /** Micro-label above a value. Weight and colour set it apart, not capitals. */
  eyebrow: {
    fontSize: 12,
    fontWeight: 600,
  },
  /** Large monospace measurement value. */
  readout: { fontSize: 24, fontWeight: 600, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' },
  /** Field label. */
  label: { fontSize: 13, fontWeight: 500 },
  /** Explanatory copy under a control. */
  hint: { fontSize: 12 },
  /** Dense table / chip text. */
  dense: { fontSize: 12, fontWeight: 600 },
  /** Footnotes, raw frame dumps. */
  micro: { fontSize: 12 },
} as const

/** Corner radius of a card. Controls inside one use the theme's 8 px, so the
 *  inner radius stays smaller than the outer one, as nested corners should. */
export const CARD_RADIUS = '12px'

/** Bordered container used for status blocks and result panels. */
export const CARD_SX = {
  p: 2,
  borderRadius: CARD_RADIUS,
  border: 1,
  borderColor: 'divider',
} as const

/**
 * Density constants for the data-dense instrument layout.
 *
 * The whole point of this app is reading numbers off hardware, so the layout
 * is tuned for information per screen: 16px inside a card, 12px between
 * cards. That is the least that lets cards read as separate objects on the
 * grouped-background grey; the density is kept inside them instead, in 30 px
 * table rows, so a sweep result still fits without scrolling.
 */
export const GRID_GAP = 12

/** Height of a results table on a page that scrolls (Load Pull, Mode Sweep).
 *  Fixed, so the panel is the same size empty, mid-run and full, and the two
 *  pages' tables read as one control. */
export const RESULTS_H = 240
export const CARD_PAD = 16
export const TILE_PAD = 12

/** Panel surface — a card: 12 px corners and a hairline, no shadow. Depth is
 *  reserved for things that actually float (menus, dialogs), so cards sitting
 *  in the page stay flat; tone against the ground does the separating. */
export const PANEL_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: CARD_RADIUS,
  bgcolor: 'background.paper',
} as const

/** Colour roles that encode *state*, not decoration. A tile or heading only
 *  takes one when the colour means something the user must act on. */
export type TileAccent = 'blue' | 'teal' | 'amber' | 'purple' | 'red' | 'neutral'
