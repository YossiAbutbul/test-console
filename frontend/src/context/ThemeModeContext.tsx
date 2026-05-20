import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { makeTheme, type ThemeMode } from '../theme'

export type ThemePreference = ThemeMode | 'system'

interface Ctx {
  preference: ThemePreference
  mode: ThemeMode
  setPreference: (p: ThemePreference) => void
}

const ThemeModeCtx = createContext<Ctx | null>(null)
const STORAGE_KEY = 'app-theme-pref'

function systemMode(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (saved === 'light' || saved === 'mid' || saved === 'dark' || saved === 'system') return saved
    return 'light'
  })
  const [sysMode, setSysMode] = useState<ThemeMode>(() => systemMode())

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, preference) } catch {}
  }, [preference])

  useEffect(() => {
    if (preference !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setSysMode(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference])

  const mode: ThemeMode = preference === 'system' ? sysMode : preference
  const theme = useMemo(() => makeTheme(mode), [mode])

  return (
    <ThemeModeCtx.Provider value={{ preference, mode, setPreference }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeCtx.Provider>
  )
}

export function useThemeMode(): Ctx {
  const v = useContext(ThemeModeCtx)
  if (!v) throw new Error('useThemeMode must be inside ThemeModeProvider')
  return v
}
