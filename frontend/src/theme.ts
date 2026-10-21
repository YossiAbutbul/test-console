import { alpha, createTheme, type Theme } from '@mui/material/styles'
import Fade from '@mui/material/Fade'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { CONTROL_H } from './ui/tokens'

export type ThemeMode = 'light' | 'mid' | 'dark'

export interface SidebarPalette {
  bg: string
  bg2: string
  border: string
  text: string
  textDim: string
  accent: string
  accentSoft: string
  accentSoftHover: string
  hover: string
  success: string
  successOff: string
}

export interface ActionColor {
  bg: string
  bgHover: string
  fg: string
  border: string
}

/** Colours that encode data state in readouts and result rows — a measured
 *  value out of limits, a row that failed. Panels themselves stay neutral, so
 *  these are the only colours competing for attention on a dense page. */
export interface DataPalette {
  ok: string
  warn: string
  bad: string
  /** Row background wash for a highlighted/selected result row. */
  highlight: string
}

/**
 * Colours for plotted data.
 *
 * The one place the palette admits hues beyond the ok/warn/bad triad: a chart
 * with several lines needs them told apart, and that is still a measurement
 * talking. Series hues keep their order across modes and only shift lightness,
 * for the same reason the triad does — line 2 is the same colour whichever
 * mode the bench is in.
 *
 * No red and no green in the set. Series 2 and 3 used to be exactly those, so
 * a line that happened to land on red looked like a run of FAILs and one on
 * green like a pass -- the same hues the results table uses for its verdict.
 * The set is blue, amber, violet, cyan, pink, ochre, slate, teal: told apart
 * by lightness as well as hue, and the legend names every line.
 */
export interface ChartPalette {
  /** Categorical series colours, assigned in order and cycled. */
  series: string[]
  grid: string
  /** Axis lines and tick labels. Recharts' default `#666` vanishes on the
   *  dark grounds. */
  axis: string
}

export interface AppPalette {
  /**
   * Quietest text that still has to be read: sub-lines, hints, units.
   *
   * Set rather than left to MUI, whose default is a translucent black/white
   * that came out at 2.7:1 on Light paper and 4.2:1 on Mid -- and it is used
   * for real copy in dozens of places, not only for disabled controls.
   */
  textDisabled: string
  appBar: string
  appBarBorder: string
  contentBg: string
  paper: string
  logBg: string
  sidebar: SidebarPalette
  data: DataPalette
  chart: ChartPalette
  actions: {
    scan: ActionColor
    connect: ActionColor
    disconnect: ActionColor
    primary: ActionColor
    danger: ActionColor
  }
}

/**
 * The Apple system palette, read for a bench.
 *
 * One accent hue -- the system blue -- for the things a person acts on: Run,
 * Connect, the selected page's glyph, links and focus. Red, amber and green
 * stay the measurement triad, so a coloured *number* still always means a
 * measurement is telling you something; blue never appears on a value.
 *
 * The three modes are ambient light levels rather than arbitrary shades --
 * `light` for daylight on the bench, `mid` (the default) a graphite for a lit
 * lab, `dark` for a dim room and unattended overnight runs. The triad holds
 * its hue across all three and shifts only lightness, so switching mode
 * mid-shift never re-teaches the operator what a colour means.
 *
 * Two rules worth not breaking:
 *
 *  - `data.warn` is an annunciator lamp, not a brand colour. Notices and log
 *    lines only, never a surface or a button, so seeing it always means
 *    something wants attention.
 *  - The filled accent is #0071E3 in every mode, not the brighter #0A84FF
 *    Apple ships for dark. White on #0A84FF is 3.6:1; on #0071E3 it clears
 *    4.5:1, and Run is the one label that must never be hard to read.
 */
const ACCENT_FILL = { bg: '#0071E3', bgHover: '#0077ED', fg: '#FFFFFF', border: '#0071E3' }

const PALETTES: Record<ThemeMode, AppPalette> = {
  // Daylight. White cards on the system grouped-background grey, so a card's
  // edge reads from tone alone and its hairline can be faint.
  light: {
    textDisabled: '#6E6E73',
    appBar: '#FAFAFC',
    appBarBorder: '#E3E3E8',
    contentBg: '#F5F5F7',
    paper: '#FFFFFF',
    logBg: '#FFFFFF',
    data: {
      ok: '#1E7B34',
      warn: '#A04900',
      bad: '#C4000F',
      highlight: 'rgba(0,113,227,0.08)',
    },
    chart: {
      series: ['#0071E3', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#8A6A1F', '#475569', '#0D9488'],
      grid: 'rgba(60,60,67,0.12)',
      axis: '#636366',
    },
    sidebar: {
      bg: '#ECECF0',
      bg2: '#E6E6EB',
      border: '#DCDCE1',
      text: '#1D1D1F',
      textDim: '#5E5E63',
      accent: '#0066CC',
      accentSoft: 'rgba(60,60,67,0.10)',
      accentSoftHover: 'rgba(60,60,67,0.15)',
      hover: 'rgba(60,60,67,0.06)',
      success: '#1E7B34',
      successOff: '#AEAEB2',
    },
    actions: {
      scan: { bg: '#EBEBEF', bgHover: '#E1E1E6', fg: '#1D1D1F', border: '#EBEBEF' },
      connect: ACCENT_FILL,
      disconnect: { bg: '#FCE9E8', bgHover: '#F9DCDA', fg: '#C4000F', border: '#FCE9E8' },
      primary: ACCENT_FILL,
      danger: { bg: '#D70015', bgHover: '#BF0013', fg: '#FFFFFF', border: '#D70015' },
    },
  },
  // The default: graphite. A step lighter than Dark so cards still read as
  // surfaces under lab lighting, the way macOS's dark sidebar does over a
  // lit desk.
  // Lifted after the critique found Mid and Dark nearly indistinguishable
  // side by side: Mid is graphite, a clear step above Dark's near-black.
  mid: {
    textDisabled: '#A6A6AC',
    appBar: '#313135',
    appBarBorder: '#505055',
    contentBg: '#2F2F33',
    paper: '#3B3B40',
    logBg: '#35353A',
    data: {
      ok: '#4CD26A',
      warn: '#FFB54A',
      // Clears 4.5:1 on a FAIL row's wash as well as on the card, which is
      // where a failed point's delta sits.
      bad: '#FF8F88',
      highlight: 'rgba(77,163,255,0.14)',
    },
    chart: {
      series: ['#4DA3FF', '#EDB04F', '#B49AF7', '#4CC9DE', '#F17FB6', '#C9A86A', '#AEB8C4', '#4FD1C0'],
      grid: 'rgba(255,255,255,0.10)',
      axis: '#A1A1A7',
    },
    sidebar: {
      bg: '#28282C',
      bg2: '#252529',
      border: '#45454A',
      text: '#F2F2F7',
      textDim: '#C2C2C8',
      accent: '#5AA9FF',
      accentSoft: 'rgba(255,255,255,0.10)',
      accentSoftHover: 'rgba(255,255,255,0.15)',
      hover: 'rgba(255,255,255,0.06)',
      success: '#4CD26A',
      successOff: '#5E5E63',
    },
    actions: {
      scan: { bg: '#4A4A50', bgHover: '#54545A', fg: '#F2F2F7', border: '#4A4A50' },
      connect: ACCENT_FILL,
      disconnect: { bg: '#4A3130', bgHover: '#573837', fg: '#FF8F88', border: '#4A3130' },
      primary: ACCENT_FILL,
      danger: { bg: '#FF6B61', bgHover: '#FF8178', fg: '#1A0605', border: '#FF6B61' },
    },
  },
  // Dim room, long runs. Near-black ground with the cards a single step
  // above it; borders at the minimum that still separates them.
  dark: {
    textDisabled: '#8E8E94',
    appBar: '#1C1C1E',
    appBarBorder: '#333336',
    contentBg: '#161618',
    paper: '#222224',
    logBg: '#1C1C1E',
    data: {
      ok: '#3DD164',
      warn: '#FFB340',
      bad: '#FF7B73',
      highlight: 'rgba(77,163,255,0.14)',
    },
    chart: {
      series: ['#4DA3FF', '#F0B658', '#BBA2F9', '#55CFE3', '#F488BC', '#CFAE70', '#B4BEC9', '#57D7C6'],
      grid: 'rgba(255,255,255,0.08)',
      axis: '#98989E',
    },
    sidebar: {
      bg: '#1A1A1C',
      bg2: '#18181A',
      border: '#2E2E31',
      text: '#F5F5F7',
      textDim: '#A1A1A6',
      accent: '#4DA3FF',
      accentSoft: 'rgba(255,255,255,0.09)',
      accentSoftHover: 'rgba(255,255,255,0.14)',
      hover: 'rgba(255,255,255,0.05)',
      success: '#3DD164',
      successOff: '#48484C',
    },
    actions: {
      scan: { bg: '#38383B', bgHover: '#424246', fg: '#F5F5F7', border: '#38383B' },
      connect: ACCENT_FILL,
      disconnect: { bg: '#3D2524', bgHover: '#4A2C2B', fg: '#FF7B73', border: '#3D2524' },
      primary: ACCENT_FILL,
      danger: { bg: '#FF6359', bgHover: '#FF7A71', fg: '#1A0605', border: '#FF6359' },
    },
  },
}

export function getAppPalette(mode: ThemeMode): AppPalette {
  return PALETTES[mode]
}

export function makeTheme(mode: ThemeMode): Theme {
  const isLight = mode === 'light'
  const p = PALETTES[mode]
  // Read once per theme: an operator who asks the OS for less motion gets no
  // MUI transition anywhere -- drawers, Collapse, popovers, dialogs -- rather
  // than a per-component patchwork where only the key press honoured it.
  const reducedMotion = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // Fields are filled, as iOS and macOS search fields are: a translucent grey
  // well at rest that reads on a card and the ground alike, and the field you
  // are in gains the accent edge. Chosen over a bare hairline (a
  // wireframe on white cards), an accent edge on every field (the focused one
  // lost among the rest) and a macOS white well.
  // Lighter than the system 12 % at the operator's ask: the wells read heavy.
  const fieldBg = isLight ? 'rgba(118,118,128,0.08)' : 'rgba(118,118,128,0.18)'
  const fieldBgHover = isLight ? 'rgba(118,118,128,0.12)' : 'rgba(118,118,128,0.24)'
  const fieldBgDisabled = isLight ? 'rgba(118,118,128,0.04)' : 'rgba(118,118,128,0.09)'
  const fieldEdge = 'transparent'
  const fieldEdgeDisabled = 'transparent'
  // A hairline, not a halo: at 3 px and then 2 px the ring round a focused
  // control read as a second, heavier border. Same as ui/feel.ts focusRing,
  // which the kit uses.
  const focusRing = `0 0 0 1px ${alpha(p.sidebar.accent, isLight ? 0.6 : 0.7)}`
  // Menus, popovers and dialogs are the only things that lift off the page.
  // A menu arrives as a sheet settling out of its field -- a short fade with a
  // 3 % scale and 4 px drop from the top edge -- and leaves with a quicker
  // fade. MUI's Grow scaled from 75 % along both axes, a Material bloom that
  // read as the menu being thrown at the page. Opacity only, and instant,
  // for reduced motion.
  const menuIn = reducedMotion ? 'none' : 'tcMenuIn 170ms cubic-bezier(.2,.8,.2,1)'
  const menuKeyframes = {
    '@keyframes tcMenuIn': {
      from: { transform: 'translateY(-4px) scale(0.97)' },
      to: { transform: 'none' },
    },
  }
  const menuTransition = {
    TransitionComponent: Fade,
    transitionDuration: reducedMotion ? 0 : { enter: 170, exit: 110 },
  }
  const floatShadow = isLight
    ? '0 12px 32px -6px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)'
    : '0 16px 40px -6px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.10)'
  return createTheme({
    ...(reducedMotion ? { transitions: { create: () => 'none' } } : null),
    palette: {
      mode: isLight ? 'light' : 'dark',
      primary: { main: p.actions.primary.bg, contrastText: p.actions.primary.fg },
      secondary: { main: p.sidebar.accent },
      success: { main: p.sidebar.success },
      // Taken from the palette rather than fixed, so an MUI Alert, a helper
      // text and a hand-coloured result cell are the same red on the same
      // ground. These used to be three warm hardcoded values that drifted from
      // `data.*` as the modes changed.
      warning: { main: p.data.warn },
      error: { main: p.data.bad },
      info: { main: p.sidebar.accent },
      action: { hover: p.sidebar.hover, selected: p.sidebar.accentSoft },
      background: { default: p.contentBg, paper: p.paper },
      text: { primary: p.sidebar.text, secondary: p.sidebar.textDim, disabled: p.textDisabled },
      divider: p.appBarBorder,
    },
    shape: { borderRadius: 8 },
    typography: {
      // The platform's own UI face. "Inter" headed this list but was never
      // loaded, so the bench PC drew Segoe UI anyway; naming the system font
      // first makes that the deliberate choice, with its optical sizing and
      // hinting, and every machine draws what it was tuned for.
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: 14.5,
      h6: { fontWeight: 600, fontSize: '1.1rem', letterSpacing: 0 },
      subtitle1: { fontWeight: 600, fontSize: '0.95rem' },
      subtitle2: {
        fontWeight: 600,
        fontSize: '0.875rem',
        color: p.sidebar.textDim,
      },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      caption: { color: p.sidebar.textDim },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Tabular figures everywhere, not only in the mono readouts: a
          // proportional 1 beside an 8 makes "11/18" and "1m 12s" shift width
          // as they count, and labels like "18 points" jitter between runs.
          body: { fontVariantNumeric: 'tabular-nums' },
          // The window is the app: panes scroll, the page body never does. A
          // tooltip near the right edge (Show inspector) gave <html> a
          // scrollbar while it was open, which flashed in and shifted
          // everything under it.
          'html, body': { overflow: 'hidden', height: '100%' },
          '*': {
            scrollbarColor: `${p.appBarBorder} transparent`,
            scrollbarWidth: 'thin',
          },
          '*::-webkit-scrollbar': {
            width: 10,
            height: 10,
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '*::-webkit-scrollbar-thumb': {
            background: p.appBarBorder,
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'padding-box',
          },
          '*::-webkit-scrollbar-thumb:hover': {
            background: p.sidebar.textDim,
            backgroundClip: 'padding-box',
          },
          '*::-webkit-scrollbar-corner': {
            background: 'transparent',
          },
        },
      },
      // Kill the browser's saved-value dropdown on every field. These inputs
      // hold frequencies, powers and pulse counts, so a list of everything ever
      // typed into them is noise that covers the control underneath. Set here
      // rather than per-page so a new field cannot forget it.
      MuiTextField: {
        defaultProps: { autoComplete: 'off' },
      },
      MuiInputBase: {
        defaultProps: { autoComplete: 'off' },
        // No browser spin buttons on number fields: they appeared on hover
        // inside narrow fields and competed with the page's own nudge keys.
        styleOverrides: {
          input: {
            '&[type=number]': { MozAppearance: 'textfield' },
            '&[type=number]::-webkit-outer-spin-button, &[type=number]::-webkit-inner-spin-button': {
              WebkitAppearance: 'none', margin: 0,
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${p.appBarBorder}`,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          // Icon keys are squares of the control height with the button
          // radius, so a toolbar toggle, the Settings gear and a field's own
          // icon read as the same kind of key. A call site that sizes its own
          // (an icon inside a field) still wins through `sx`.
          sizeMedium: { width: CONTROL_H.md, height: CONTROL_H.md, padding: 0, borderRadius: 8 },
          sizeSmall: { width: CONTROL_H.sm, height: CONTROL_H.sm, padding: 0, borderRadius: 7 },
          root: {
            '&:hover': { backgroundColor: p.sidebar.hover },
            transitionProperty: 'background-color, color, transform',
            transitionDuration: '120ms',
            '&:active:not(.Mui-disabled)': { transform: 'scale(0.92)' },
            '@media (prefers-reduced-motion: reduce)': {
              '&:active:not(.Mui-disabled)': { transform: 'none' },
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { boxShadow: 'none' } },
      },
      MuiButtonBase: {
        // No ripple: it starts on press but blooms for ~550 ms after, so the
        // key's answer trails the finger. Feedback is the press itself (see
        // MuiButton / MuiIconButton below) and the background change.
        defaultProps: { disableRipple: true },
        styleOverrides: {
          // Keyboard focus on every button-like control: an outline outside
          // the box, so focusing a key never changes its size or its row.
          root: {
            '&.Mui-focusVisible': { outline: 'none', boxShadow: focusRing },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 8,
            // Instant press: the key gives under the pointer on pointer-down.
            // A transform, so it never moves anything around it.
            transitionProperty: 'background-color, box-shadow, border-color, color, transform',
            transitionDuration: '120ms',
            '&:active:not(.Mui-disabled)': { transform: 'scale(0.97)' },
            '@media (prefers-reduced-motion: reduce)': {
              '&:active:not(.Mui-disabled)': { transform: 'none' },
            },
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              pointerEvents: 'none',
              cursor: 'default',
            },
          },
          // A disabled primary is a faint wash of the accent with accent ink:
          // still legible ("Needs DUT" is information), but plainly not the
          // grey of a live secondary key, which it used to match exactly.
          contained: {
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              backgroundColor: alpha(p.sidebar.accent, isLight ? 0.1 : 0.14),
              color: p.sidebar.accent,
              boxShadow: 'none',
              borderColor: 'transparent',
            },
          },
          // Secondary keys are a grey fill, not an outline: macOS's bordered
          // button. The border stays in the box model, transparent, so a key
          // switching variant on a state change keeps its size.
          outlined: {
            backgroundColor: p.actions.scan.bg,
            borderColor: 'transparent',
            color: p.sidebar.text,
            '&:hover': { backgroundColor: p.actions.scan.bgHover, borderColor: 'transparent' },
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              borderColor: 'transparent',
              color: p.textDisabled,
              backgroundColor: alpha(p.actions.scan.bg, 0.5),
            },
          },
          // Every button is the one control height (see CONTROL_H), whatever
          // its variant, so a Stop beside a Run beside a field lines up.
          sizeMedium: { paddingTop: 0, paddingBottom: 0, height: CONTROL_H.md, fontSize: 13.5 },
          sizeSmall: { paddingTop: 0, paddingBottom: 0, height: CONTROL_H.sm, fontSize: 12.5 },
          // Text buttons take the lighter accent: the filled blue is tuned for
          // white on it, and as ink on the dark cards it fell to 2.6:1. Only the
          // primary-coloured ones -- set on `text` it overrode `color="inherit"`
          // too, and Clear came out the same blue as Export.
          textPrimary: { color: p.sidebar.accent },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: fieldBg,
            borderRadius: 7,
            transition: reducedMotion ? 'none' : 'background-color .15s',
            '&:hover': { backgroundColor: fieldBgHover },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: fieldEdge },
            // Accent at half strength: the full accent read as a hard line on the
            // lighter wells.
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: alpha(p.sidebar.accent, isLight ? 0.5 : 0.6), borderWidth: 1 },
            // A visible focus ring, drawn as a shadow so it adds nothing to the
            // field's size. The focused border used to be the same hairline as
            // an unfocused one, so keyboard focus on a field was invisible.
            // A focused field keeps its grey well -- turning it white was tried
            // and dropped -- and is marked by its 1 px accent edge alone: with a ring outside it as well the outline was two
            // lines thick.
            '&.Mui-focused, &.Mui-focused:hover': { boxShadow: 'none', backgroundColor: fieldBg },
            // Disabled: a flat, fainter well with greyed text -- it recedes
            // rather than turning into a block.
            '&.Mui-disabled': { backgroundColor: fieldBgDisabled },
            '&.Mui-disabled:hover .MuiOutlinedInput-notchedOutline': { borderColor: fieldEdgeDisabled },
            '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: fieldEdgeDisabled },
            // A field in error swaps its edge for red.
            '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: p.data.bad },
            // Single-line only. A multiline field grows by giving its box more
            // height, so a fixed one leaves the textarea rendering outside it:
            // the assistant's question box spilled over the controls above it
            // the moment a question ran to a second line. Every existing
            // single-line input keeps the exact 36 px it had.
            '&.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline)': { height: CONTROL_H.md },
          },
          notchedOutline: { borderColor: fieldEdge, borderWidth: 1, top: 0, '& legend': { display: 'none' }, transition: reducedMotion ? 'none' : 'border-color .15s' },
          inputSizeSmall: { paddingTop: 0, paddingBottom: 0, fontSize: '0.875rem' },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            boxShadow: floatShadow,
            border: 0,
            borderRadius: 10,
            marginTop: 4,
            transformOrigin: 'top center',
            ...menuKeyframes,
            animation: menuIn,
          },
          listbox: {
            padding: 4,
            '& .MuiAutocomplete-option': { borderRadius: 6, margin: '1px 0' },
            '& .MuiAutocomplete-option.Mui-focused': {
              backgroundColor: alpha(p.sidebar.accent, isLight ? 0.1 : 0.16),
            },
          },
          inputRoot: {
            '&.MuiInputBase-sizeSmall': {
              paddingTop: 0,
              paddingBottom: 0,
              height: CONTROL_H.md,
            },
            '&.MuiInputBase-sizeSmall .MuiAutocomplete-input': {
              paddingTop: 0,
              paddingBottom: 0,
            },
          },
          clearIndicator: {
            padding: 2,
            '& svg': { fontSize: 14 },
            '&:hover': { backgroundColor: 'transparent' },
          },
          popupIndicator: {
            '&:hover': { backgroundColor: 'transparent' },
            transition: reducedMotion ? 'none' : 'transform 200ms cubic-bezier(.2,.8,.2,1)',
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 40 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } } },
      // A ToggleButtonGroup is the segmented control too (see SegmentedChoice
      // and DenseTabs): a filled track with the chosen segment raised.
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { padding: 2, gap: 2, borderRadius: 8, backgroundColor: alpha(p.sidebar.textDim, 0.14) },
          grouped: {
            border: 0,
            borderRadius: '6px !important',
            margin: 0,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            height: CONTROL_H.md - 4,
            padding: '0 12px',
            border: 0,
            fontSize: 13,
            fontWeight: 500,
            textTransform: 'none',
            color: p.sidebar.textDim,
            '&:hover': { backgroundColor: 'transparent', color: p.sidebar.text },
            '&.Mui-selected, &.Mui-selected:hover': {
              color: p.sidebar.text,
              backgroundColor: isLight ? '#FFFFFF' : alpha(p.sidebar.text, 0.16),
              boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)',
            },
          },
        },
      },
      // One dialog motion: a fade with the sheet settling from 97 % on the way
      // in, the same fade on the way out. Dialogs had three timings, two of
      // them with no exit at all (they vanished on close).
      MuiDialog: {
        defaultProps: { transitionDuration: reducedMotion ? 0 : { enter: 200, exit: 150 } },
        styleOverrides: {
          paper: {
            borderRadius: 14,
            border: 0,
            boxShadow: floatShadow,
            '@keyframes tcSheetIn': {
              from: { transform: 'scale(0.97)' },
              to: { transform: 'scale(1)' },
            },
            animation: reducedMotion ? 'none' : 'tcSheetIn 200ms cubic-bezier(.2,.8,.2,1)',
          },
        },
      },
      // A lighter scrim than MUI's flat 50 % black, which in Light washed the
      // whole window grey; enough in Mid/Dark to set the sheet apart.
      MuiBackdrop: {
        styleOverrides: {
          root: {
            '&:not(.MuiBackdrop-invisible)': {
              backgroundColor: isLight ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.45)',
            },
          },
        },
      },
      // The macOS slider: a thin rail, the selected span in the accent, and a
      // white knob big enough to grab. MUI's 11 px ring on a hairline was hard
      // to hit and showed the selected span the same as the rail.
      MuiSlider: {
        styleOverrides: {
          root: { height: 4, padding: '13px 0' },
          rail: { opacity: 1, backgroundColor: alpha(p.sidebar.textDim, 0.25), borderRadius: 2 },
          track: { border: 0, backgroundColor: p.sidebar.accent, borderRadius: 2 },
          thumb: {
            width: 18,
            height: 18,
            backgroundColor: '#FFFFFF',
            boxShadow: '0 0.5px 1.5px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.12)',
            transition: 'transform 120ms ease, box-shadow 120ms ease',
            '&::before': { boxShadow: 'none' },
            '&:hover': { boxShadow: '0 0.5px 1.5px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.12)' },
            '&.Mui-focusVisible': { boxShadow: `0 0.5px 1.5px rgba(0,0,0,0.35), ${focusRing}` },
            '&.Mui-active': { transform: reducedMotion ? 'none' : 'scale(1.1)' },
          },
        },
      },
      // The macOS switch: a pill track, the accent when on, a white knob.
      MuiSwitch: {
        styleOverrides: {
          root: { width: 38, height: 24, padding: 0, overflow: 'visible' },
          switchBase: {
            padding: 2,
            '&.Mui-checked': { transform: 'translateX(14px)', color: '#FFFFFF' },
            '&.Mui-checked + .MuiSwitch-track': { backgroundColor: p.sidebar.accent, opacity: 1 },
            '&.Mui-focusVisible .MuiSwitch-thumb': { boxShadow: focusRing },
            '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.4 },
          },
          thumb: { width: 20, height: 20, backgroundColor: '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' },
          track: { borderRadius: 12, opacity: 1, backgroundColor: alpha(p.sidebar.textDim, 0.3) },
          sizeSmall: {
            width: 30, height: 18,
            '& .MuiSwitch-switchBase': { padding: 2 },
            '& .MuiSwitch-switchBase.Mui-checked': { transform: 'translateX(12px)' },
            '& .MuiSwitch-thumb': { width: 14, height: 14 },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { fontSize: 12, fontWeight: 500, borderRadius: 7, padding: '6px 9px' },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            marginInline: 6,
            marginBlock: 1,
            paddingTop: 4,
            paddingBottom: 4,
            '&.Mui-selected': {
              backgroundColor: p.sidebar.accentSoft,
              color: p.sidebar.text,
              '&:hover': { backgroundColor: p.sidebar.accentSoftHover },
              '& .MuiListItemText-primary': { color: p.sidebar.text, fontWeight: 600 },
            },
          },
        },
      },
      MuiToolbar: { styleOverrides: { root: { minHeight: 56 } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottomColor: p.appBarBorder },
          head: { fontWeight: 500, color: p.sidebar.textDim, backgroundColor: p.paper },
          // 10 px a side in dense tables, not MUI's 16: with the unit on the
          // heading line ("Measured [dBm]") the 32 px of padding per column
          // was what cut headings off at laptop width.
          sizeSmall: { paddingLeft: 10, paddingRight: 10 },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: p.appBarBorder } } },
      MuiPopover: {
        defaultProps: menuTransition,
        styleOverrides: {
          paper: {
            boxShadow: floatShadow,
            border: 0,
            borderRadius: 10,
            transformOrigin: 'top center',
            ...menuKeyframes,
            animation: menuIn,
          },
        },
      },
      MuiMenu: {
        defaultProps: menuTransition,
        styleOverrides: {
          paper: {
            boxShadow: floatShadow,
            border: 0,
            borderRadius: 10,
            marginTop: 4,
            transformOrigin: 'top center',
            ...menuKeyframes,
            animation: menuIn,
          },
          list: { padding: 4, cursor: 'pointer' },
        },
      },
      // The macOS pop-up menu row: 28 px, a rounded highlight inset from the
      // sheet's edge, the accent fill with white ink under the pointer or the
      // keyboard, and the chosen option tinted and checked.
      MuiMenuItem: {
        styleOverrides: {
          root: {
            // MUI resets the height to `auto` above its `sm` breakpoint with a
            // media query that outranked a plain minHeight, so rows came out
            // 20 px. Set in both places so they are 28 at every width.
            minHeight: CONTROL_H.sm,
            '@media (min-width: 600px)': { minHeight: CONTROL_H.sm },
            borderRadius: 6,
            margin: '1px 0',
            // Room on the right for the check, so labels start at the sheet's
            // own inset like any list.
            padding: '0 30px 0 10px',
            fontSize: 13,
            position: 'relative',
            transition: 'none',
            // A pointer over every row, the open field and the sheet: MUI
            // leaves the open menu's rows and its invisible backdrop on the
            // arrow cursor, so the menu did not look clickable once open.
            cursor: 'pointer',
            '&:hover, &.Mui-focusVisible': {
              backgroundColor: p.actions.primary.bg,
              color: p.actions.primary.fg,
            },
            '&.Mui-selected': {
              backgroundColor: alpha(p.sidebar.accent, isLight ? 0.1 : 0.16),
              fontWeight: 500,
              // The check at the row's end. In a left gutter every label was
              // pushed 18 px in to make room for one mark.
              '&::after': {
                content: '"✓"',
                position: 'absolute',
                right: 10,
                fontSize: 12,
                fontWeight: 600,
              },
            },
            '&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': {
              backgroundColor: p.actions.primary.bg,
              color: p.actions.primary.fg,
            },
          },
        },
      },
      // Select: a rounded chevron that turns over while the menu is open, in
      // place of MUI's filled triangle, and the menu opening flush under the
      // field rather than over it.
      MuiSelect: {
        defaultProps: {
          IconComponent: ExpandMoreRoundedIcon,
          MenuProps: {
            ...menuTransition,
            anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
            transformOrigin: { vertical: 'top', horizontal: 'left' },
          },
        },
        styleOverrides: {
          select: { cursor: 'pointer' },
          icon: {
            fontSize: 18,
            right: 8,
            color: p.sidebar.textDim,
            transition: reducedMotion ? 'none' : 'transform 200ms cubic-bezier(.2,.8,.2,1)',
          },
          iconOpen: { transform: 'rotate(180deg)' },
        },
      },
    },
  })
}

export const theme = makeTheme('light')
