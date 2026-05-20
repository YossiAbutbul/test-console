import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0f172a', contrastText: '#ffffff' },
    secondary: { main: '#2563eb' },
    success: { main: '#15803d' },
    warning: { main: '#b45309' },
    error: { main: '#b91c1c' },
    info: { main: '#0369a1' },
    background: { default: '#fafafa', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#52525b' },
    divider: '#e4e4e7',
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 13,
    h6: { fontWeight: 600, fontSize: '1rem', letterSpacing: 0 },
    subtitle1: { fontWeight: 600, fontSize: '0.875rem' },
    subtitle2: { fontWeight: 600, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: 0.4, color: '#71717a' },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
    caption: { color: '#71717a' },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid #e4e4e7',
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
        root: { borderRadius: 6 },
        sizeMedium: { paddingTop: 6, paddingBottom: 6 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#fff',
        },
        notchedOutline: { borderColor: '#d4d4d8' },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: '0.8125rem' } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 40 } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 4, fontWeight: 500 } },
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
            backgroundColor: '#0f172a',
            color: '#fff',
            '&:hover': { backgroundColor: '#1e293b' },
            '& .MuiListItemText-primary': { color: '#fff', fontWeight: 600 },
          },
        },
      },
    },
    MuiToolbar: {
      styleOverrides: { root: { minHeight: 56 } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: '#f1f1f3' },
        head: { fontWeight: 600, color: '#52525b', backgroundColor: '#fafafa' },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: '#e4e4e7' } },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          boxShadow:
            '0 10px 25px -8px rgba(15, 23, 42, 0.18), 0 4px 10px -4px rgba(15, 23, 42, 0.10)',
          border: '1px solid #e4e4e7',
          marginTop: 4,
        },
        listbox: {
          paddingTop: 4,
          paddingBottom: 4,
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          boxShadow:
            '0 10px 25px -8px rgba(15, 23, 42, 0.18), 0 4px 10px -4px rgba(15, 23, 42, 0.10)',
          border: '1px solid #e4e4e7',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          boxShadow:
            '0 10px 25px -8px rgba(15, 23, 42, 0.18), 0 4px 10px -4px rgba(15, 23, 42, 0.10)',
          border: '1px solid #e4e4e7',
          marginTop: 4,
        },
      },
    },
  },
})
