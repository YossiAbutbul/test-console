import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Drawer, IconButton, Stack, Tooltip, Typography,
} from '@mui/material'
import ArticleIcon from '@mui/icons-material/Article'
import CloseIcon from '@mui/icons-material/Close'
import ScienceIcon from '@mui/icons-material/Science'
import { ConnectionPanel } from './components/ConnectionPanel'
import { SearchBar } from './components/SearchBar'
import { LogPanel } from './components/LogPanel'
import { InstrumentsModal } from './components/InstrumentsModal'
import { useConnection } from './context/ConnectionContext'
import { useThemeMode } from './context/ThemeModeContext'
import { getAppPalette } from './theme'
import { testRegistry } from './tests/registry'
import { Sidebar, SIDEBAR_W, TOP_BAR_H } from './components/Sidebar'

/** Band at the bottom of the window owned by the fixed copyright footer.
 *  Anything that paints under it has to stop short by this much. */
const FOOTER_CLEARANCE = 26
import { STORAGE_KEYS, usePersistedState } from './store'

const LOG_MIN_W = 240
const LOG_MAX_W = 720
const LOG_DEFAULT_W = 340

function TestArea({ activeId }: { activeId: string }) {
  const { status } = useConnection()
  const activeMod = testRegistry.find((m) => m.id === activeId) ?? testRegistry[0]
  const gated = activeMod.requiresConnection && !(status?.connected && status?.transport_ready)

  // All pages mount once on app start and we toggle visibility via `display`.
  // This trades a slightly slower first paint for instant sidebar navigation —
  // no remount, no useQuery refetch storm. Pages keep their internal state
  // (form inputs, results tables) across switches automatically.
  return (
    <Box
      aria-disabled={gated || undefined}
      sx={{
        minWidth: 0,
        opacity: gated ? 0.6 : 1,
        pointerEvents: gated ? 'none' : 'auto',
        transition: 'opacity 0.15s',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {testRegistry.map((mod) => {
        const { Page } = mod
        const isActive = mod.id === activeMod.id
        return (
          <Box
            key={mod.id}
            sx={{
              flexGrow: 1, minHeight: 0, minWidth: 0,
              display: isActive ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <Page protocol={mod.protocol} group={mod.group} active={isActive} />
          </Box>
        )
      })}
    </Box>
  )
}

export default function App() {
  const [logOpen, setLogOpen] = useState(true)
  const [logW, setLogW] = usePersistedState<number>(STORAGE_KEYS.logWidth, LOG_DEFAULT_W)
  const [activeId, setActiveId] = useState(testRegistry[0]?.id ?? '')
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const s = p.sidebar
  const dragging = useRef(false)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const next = Math.max(LOG_MIN_W, Math.min(LOG_MAX_W, window.innerWidth - e.clientX))
      setLogW(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setLogW])

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      {/* Unified top bar across whole window */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: TOP_BAR_H,
          bgcolor: s.bg,
          boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          zIndex: (t) => t.zIndex.drawer + 2,
        }}
      >
        <Box
          sx={{
            width: SIDEBAR_W,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            pl: 2.2,
            pr: 1.5,
          }}
        >
          <Box
            sx={{
              width: 34, height: 34, borderRadius: 1.25,
              bgcolor: s.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ScienceIcon sx={{ fontSize: 20, color: s.bg }} />
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: 18, color: s.text, lineHeight: 1.15 }}>
            Test Console
          </Typography>
        </Box>

        <Box
          sx={{
            flexGrow: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            px: 2,
          }}
        >
          <SearchBar
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
          {!logOpen && (
            <Tooltip title="Open log">
              <IconButton
                size="small"
                onClick={() => setLogOpen(true)}
                sx={{ position: 'absolute', right: 12 }}
              >
                <ArticleIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {logOpen && (
          <Box
            sx={{
              width: logW,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 1.5,
            }}
          >
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: s.text }}>Log</Typography>
            <IconButton size="small" onClick={() => setLogOpen(false)}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        )}
      </Box>

      <Sidebar
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          px: 4,
          pt: `${TOP_BAR_H + 24}px`,
          pb: 3,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ pb: 2, mb: 3, borderBottom: `1px solid ${p.appBarBorder}` }}>
          <ConnectionPanel />
        </Box>
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TestArea activeId={activeId} />
        </Box>
      </Box>

      <InstrumentsModal />

      {/* Global footer — bottom-right, always visible regardless of log drawer. */}
      <Box
        component="footer"
        sx={{
          position: 'fixed',
          bottom: 6,
          right: 12,
          fontSize: 10.5,
          color: p.sidebar.textDim,
          pointerEvents: 'none',
          zIndex: (t) => t.zIndex.drawer + 3,
        }}
      >
        © {new Date().getFullYear()}{' '}
        <Box
          component="a"
          href="https://github.com/YossiAbutbul"
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            color: p.sidebar.text,
            textDecoration: 'none',
            fontWeight: 600,
            pointerEvents: 'auto',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          Yossi Abutbul
        </Box>
        {' · '}All rights reserved
      </Box>

      <Drawer
        anchor="right"
        open={logOpen}
        onClose={() => setLogOpen(false)}
        variant="persistent"
        sx={{
          width: logOpen ? logW : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: logW,
            boxSizing: 'border-box',
            bgcolor: p.logBg,
            border: 0,
            top: TOP_BAR_H,
            height: `calc(100vh - ${TOP_BAR_H}px)`,
            // The global footer is fixed to the bottom-right of the window and
            // paints over this drawer. Inset the paper's content so nothing is
            // ever rendered in that band — at any scroll position — while the
            // drawer's own background still reaches the bottom of the screen.
            paddingBottom: `${FOOTER_CLEARANCE}px`,
          },
        }}
      >
        <Box
          onMouseDown={onDragStart}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 1,
            '&:hover': { bgcolor: p.appBarBorder },
            '&:active': { bgcolor: s.accent ?? p.appBarBorder },
            transition: 'background-color 0.15s',
          }}
        />
        <Stack sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
          <LogPanel embedded />
        </Stack>
      </Drawer>
    </Box>
  )
}
