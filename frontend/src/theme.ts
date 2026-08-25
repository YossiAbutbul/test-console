import { createTheme, type Theme } from '@mui/material/styles'

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

export interface AppPalette {
  appBar: string
  appBarBorder: string
  contentBg: string
  paper: string
  logBg: string
  sidebar: SidebarPalette
  data: DataPalette
  actions: {
    scan: ActionColor
    connect: ActionColor
    disconnect: ActionColor
    primary: ActionColor
    danger: ActionColor
  }
}

/**
 * Anodized — the aluminium rack.
 *
 * There is deliberately no accent *hue*. Selection, focus and the Run button
 * are graphite and brushed metal, which leaves the ok/warn/bad triad as the
 * only colour anywhere on the page: if something is coloured, it is a
 * measurement telling you something. `sidebar.accent` survives as a token
 * because the whole app reads it, but here it holds a metal, not a hue.
 *
 * The three modes are ambient light levels rather than arbitrary shades —
 * `light` for daylight on the bench, `mid` (the default) for a lit lab, `dark`
 * for a dim room and unattended overnight runs. The triad holds its hue across
 * all three and shifts only lightness, so switching mode mid-shift never
 * re-teaches the operator what a colour means.
 *
 * Two rules worth not breaking:
 *
 *  - `data.warn` is an annunciator lamp, not a brand colour. Notices and log
 *    lines only, never a surface or a button, so seeing it always means
 *    something wants attention.
 *  - `actions.scan` stays a quiet outline. With no accent hue, Connect and Run
 *    are the only fills carrying any weight and a filled Scan would outrank
 *    both.
 *
 * Neutrals are a near-true grey with a very slight cool cast — aluminium
 * rather than paper. They were warm taupe under a cool blue accent, which read
 * as two unrelated systems.
 */
const PALETTES: Record<ThemeMode, AppPalette> = {
  // Daylight and overheads. White paper on a faintly cool grey ground, so
  // panel edges read without a heavy border.
  light: {
    appBar: '#FFFFFF',
    appBarBorder: '#DDDFE1',
    contentBg: '#F4F5F6',
    paper: '#FFFFFF',
    logBg: '#EEEFF1',
    data: {
      ok: '#1D7A43',
      warn: '#9A5B00',
      bad: '#B02A20',
      highlight: 'rgba(58,66,73,0.07)',
    },
    sidebar: {
      bg: '#EAECEE',
      bg2: '#EAECEE',
      border: '#DDDFE1',
      text: '#1B1F23',
      textDim: '#5C646B',
      accent: '#3A4249',
      accentSoft: 'rgba(27,31,35,0.08)',
      accentSoftHover: 'rgba(27,31,35,0.14)',
      hover: 'rgba(27,31,35,0.05)',
      success: '#1D7A43',
      successOff: '#A2A9AF',
    },
    actions: {
      scan: { bg: '#FFFFFF', bgHover: '#EAECEE', fg: '#2B3238', border: '#C6CACE' },
      connect: { bg: '#1D7A43', bgHover: '#166035', fg: '#FFFFFF', border: '#1D7A43' },
      disconnect: { bg: '#B02A20', bgHover: '#8D211A', fg: '#FFFFFF', border: '#B02A20' },
      primary: { bg: '#3A4249', bgHover: '#2A3137', fg: '#FFFFFF', border: '#3A4249' },
      danger: { bg: '#B02A20', bgHover: '#8D211A', fg: '#FFFFFF', border: '#B02A20' },
    },
  },
  // The default. Aluminium panels a step above the ground, the way an
  // instrument front panel sits above its bezel. Run is a light graphite fill
  // with dark text — a metal key rather than a lit control. Bright fills carry
  // near-black glyphs, as high-visibility controls do on real hardware: white
  // on these would not clear 4.5:1, dark does.
  mid: {
    appBar: '#2E3236',
    appBarBorder: '#41464B',
    contentBg: '#2E3236',
    paper: '#35393E',
    logBg: '#26292D',
    data: {
      ok: '#58C07A',
      warn: '#E2A63F',
      bad: '#F07068',
      highlight: 'rgba(198,206,213,0.10)',
    },
    sidebar: {
      bg: '#24272B',
      bg2: '#24272B',
      border: '#41464B',
      text: '#E4E7EA',
      textDim: '#949AA0',
      accent: '#C6CED5',
      accentSoft: 'rgba(255,255,255,0.08)',
      accentSoftHover: 'rgba(255,255,255,0.13)',
      hover: 'rgba(255,255,255,0.05)',
      success: '#58C07A',
      successOff: '#5D646A',
    },
    actions: {
      scan: { bg: '#35393E', bgHover: '#3E4348', fg: '#CBD1D6', border: '#4B5157' },
      connect: { bg: '#4CC17C', bgHover: '#66CE92', fg: '#0E1411', border: '#4CC17C' },
      disconnect: { bg: '#F07068', bgHover: '#F4867F', fg: '#180A09', border: '#F07068' },
      primary: { bg: '#C6CED5', bgHover: '#DCE2E7', fg: '#1B1F23', border: '#C6CED5' },
      danger: { bg: '#F07068', bgHover: '#F4867F', fg: '#180A09', border: '#F07068' },
    },
  },
  // Dim room, long runs. Borders reduced to the minimum that still separates
  // panels, and the graphite accent lifted nearly to white so selection is
  // still legible against the near-black ground.
  dark: {
    appBar: '#141618',
    appBarBorder: '#24282B',
    contentBg: '#141618',
    paper: '#1B1E21',
    logBg: '#101214',
    data: {
      ok: '#5EC880',
      warn: '#E7AE4B',
      bad: '#F57C74',
      highlight: 'rgba(214,221,227,0.10)',
    },
    sidebar: {
      bg: '#0E1012',
      bg2: '#0E1012',
      border: '#24282B',
      text: '#D8DCE0',
      textDim: '#838A90',
      accent: '#D6DDE3',
      accentSoft: 'rgba(255,255,255,0.06)',
      accentSoftHover: 'rgba(255,255,255,0.11)',
      hover: 'rgba(255,255,255,0.04)',
      success: '#5EC880',
      successOff: '#3C4145',
    },
    actions: {
      scan: { bg: '#1B1E21', bgHover: '#23272A', fg: '#C2C8CD', border: '#2E3337' },
      connect: { bg: '#52CE84', bgHover: '#6FD99A', fg: '#08120B', border: '#52CE84' },
      disconnect: { bg: '#F57C74', bgHover: '#F8918B', fg: '#1A0908', border: '#F57C74' },
      primary: { bg: '#D6DDE3', bgHover: '#E9EEF2', fg: '#101214', border: '#D6DDE3' },
      danger: { bg: '#F57C74', bgHover: '#F8918B', fg: '#1A0908', border: '#F57C74' },
    },
  },
}

export function getAppPalette(mode: ThemeMode): AppPalette {
  return PALETTES[mode]
}

export function makeTheme(mode: ThemeMode): Theme {
  const isLight = mode === 'light'
  const p = PALETTES[mode]
  return createTheme({
    palette: {
      mode: isLight ? 'light' : 'dark',
      primary: { main: p.sidebar.text, contrastText: isLight ? '#ffffff' : p.contentBg },
      secondary: { main: p.sidebar.accent },
      success: { main: p.sidebar.success },
      // Taken from the palette rather than fixed, so an MUI Alert, a helper
      // text and a hand-coloured result cell are the same red on the same
      // ground. These used to be three warm hardcoded values that drifted from
      // `data.*` as the modes changed.
      warning: { main: p.data.warn },
      error: { main: p.data.bad },
      info: { main: p.sidebar.accent },
      background: { default: p.contentBg, paper: p.paper },
      text: { primary: p.sidebar.text, secondary: p.sidebar.textDim },
      divider: p.appBarBorder,
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily:
        '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: 14.5,
      h6: { fontWeight: 600, fontSize: '1.1rem', letterSpacing: 0 },
      subtitle1: { fontWeight: 600, fontSize: '0.95rem' },
      subtitle2: {
        fontWeight: 600,
        fontSize: '0.875rem',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: p.sidebar.textDim,
      },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      caption: { color: p.sidebar.textDim },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
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
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { boxShadow: 'none' } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 6,
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              pointerEvents: 'none',
              cursor: 'default',
            },
          },
          contained: {
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              backgroundColor: p.appBarBorder,
              color: p.sidebar.textDim,
              boxShadow: 'none',
              borderColor: p.appBarBorder,
            },
          },
          outlined: {
            '&.Mui-disabled, &.Mui-disabled:hover, &:disabled, &:disabled:hover': {
              borderColor: p.appBarBorder,
              color: p.sidebar.textDim,
              backgroundColor: 'transparent',
            },
          },
          sizeMedium: { paddingTop: 6, paddingBottom: 6 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: p.paper,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.appBarBorder },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: p.appBarBorder, borderWidth: 1 },
            '&.Mui-disabled:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.appBarBorder },
            '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: p.appBarBorder },
            '&.MuiInputBase-sizeSmall': { height: 36 },
          },
          notchedOutline: { borderColor: p.appBarBorder, top: 0, '& legend': { display: 'none' } },
          inputSizeSmall: { paddingTop: 0, paddingBottom: 0, fontSize: '0.875rem' },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            boxShadow:
              '0 10px 25px -8px rgba(0,0,0,0.18), 0 4px 10px -4px rgba(0,0,0,0.10)',
            border: `1px solid ${p.appBarBorder}`,
            marginTop: 4,
          },
          listbox: { paddingTop: 4, paddingBottom: 4 },
          inputRoot: {
            '&.MuiInputBase-sizeSmall': {
              paddingTop: 0,
              paddingBottom: 0,
              height: 36,
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
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 40 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 500 } } },
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
          head: { fontWeight: 600, color: p.sidebar.textDim, backgroundColor: p.sidebar.bg },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: p.appBarBorder } } },
      MuiPopover: {
        styleOverrides: {
          paper: {
            boxShadow:
              '0 10px 25px -8px rgba(0,0,0,0.18), 0 4px 10px -4px rgba(0,0,0,0.10)',
            border: `1px solid ${p.appBarBorder}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            boxShadow:
              '0 10px 25px -8px rgba(0,0,0,0.18), 0 4px 10px -4px rgba(0,0,0,0.10)',
            border: `1px solid ${p.appBarBorder}`,
            marginTop: 4,
          },
        },
      },
    },
  })
}

export const theme = makeTheme('light')
