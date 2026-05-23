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

export interface AppPalette {
  appBar: string
  appBarBorder: string
  contentBg: string
  paper: string
  logBg: string
  sidebar: SidebarPalette
  actions: {
    scan: ActionColor
    connect: ActionColor
    disconnect: ActionColor
    primary: ActionColor
    danger: ActionColor
  }
}

const PALETTES: Record<ThemeMode, AppPalette> = {
  light: {
    appBar: '#FDFDFC',
    appBarBorder: '#E8E7E4',
    contentBg: '#FDFDFC',
    paper: '#FFFFFF',
    logBg: '#F7F7F6',
    sidebar: {
      bg: '#F3F3F2',
      bg2: '#F3F3F2',
      border: '#E8E7E4',
      text: '#1F1D1A',
      textDim: '#6B665C',
      accent: '#5B9FD9',
      accentSoft: 'rgba(31,29,26,0.06)',
      accentSoftHover: 'rgba(31,29,26,0.10)',
      hover: 'rgba(0,0,0,0.04)',
      success: '#5B8C5A',
      successOff: '#9C9485',
    },
    actions: {
      scan: { bg: '#3D6BC4', bgHover: '#2F58A8', fg: '#FFFFFF', border: '#3D6BC4' },
      connect: { bg: '#16A34A', bgHover: '#15803D', fg: '#FFFFFF', border: '#16A34A' },
      disconnect: { bg: '#DC2626', bgHover: '#B91C1C', fg: '#FFFFFF', border: '#DC2626' },
      primary: { bg: '#7C3AED', bgHover: '#6D28D9', fg: '#FFFFFF', border: '#7C3AED' },
      danger: { bg: '#DC2626', bgHover: '#B91C1C', fg: '#FFFFFF', border: '#DC2626' },
    },
  },
  mid: {
    appBar: '#262626',
    appBarBorder: '#363635',
    contentBg: '#262626',
    paper: '#2C2C2C',
    logBg: '#232322',
    sidebar: {
      bg: '#1F1F1E',
      bg2: '#1F1F1E',
      border: '#363635',
      text: '#E8E6E1',
      textDim: '#8E8C87',
      accent: '#5B9FD9',
      accentSoft: 'rgba(255,255,255,0.06)',
      accentSoftHover: 'rgba(255,255,255,0.10)',
      hover: 'rgba(255,255,255,0.04)',
      success: '#7BAE7C',
      successOff: '#5C5C5A',
    },
    actions: {
      scan: { bg: '#5380D6', bgHover: '#3D6BC4', fg: '#FFFFFF', border: '#5380D6' },
      connect: { bg: '#22C55E', bgHover: '#16A34A', fg: '#0A0A0A', border: '#22C55E' },
      disconnect: { bg: '#EF4444', bgHover: '#DC2626', fg: '#FFFFFF', border: '#EF4444' },
      primary: { bg: '#A78BFA', bgHover: '#8B5CF6', fg: '#1A1A1A', border: '#A78BFA' },
      danger: { bg: '#EF4444', bgHover: '#DC2626', fg: '#FFFFFF', border: '#EF4444' },
    },
  },
  dark: {
    appBar: '#121212',
    appBarBorder: '#222222',
    contentBg: '#121212',
    paper: '#181818',
    logBg: '#111111',
    sidebar: {
      bg: '#0D0D0D',
      bg2: '#0D0D0D',
      border: '#222222',
      text: '#D4D2CD',
      textDim: '#7A7874',
      accent: '#5B9FD9',
      accentSoft: 'rgba(255,255,255,0.05)',
      accentSoftHover: 'rgba(255,255,255,0.09)',
      hover: 'rgba(255,255,255,0.04)',
      success: '#7BAE7C',
      successOff: '#3A3A38',
    },
    actions: {
      scan: { bg: '#6595E0', bgHover: '#5380D6', fg: '#FFFFFF', border: '#6595E0' },
      connect: { bg: '#4ADE80', bgHover: '#22C55E', fg: '#0A0A0A', border: '#4ADE80' },
      disconnect: { bg: '#EF4444', bgHover: '#F87171', fg: '#0A0A0A', border: '#EF4444' },
      primary: { bg: '#C4B5FD', bgHover: '#A78BFA', fg: '#0A0A0A', border: '#C4B5FD' },
      danger: { bg: '#F87171', bgHover: '#EF4444', fg: '#0A0A0A', border: '#F87171' },
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
      warning: { main: '#B7791F' },
      error: { main: '#B83A35' },
      info: { main: '#4A6B82' },
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
