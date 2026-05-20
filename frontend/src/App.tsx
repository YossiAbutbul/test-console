import { useState } from 'react'
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

const LOG_W = 340

function TestArea({ activeId }: { activeId: string }) {
  const { status } = useConnection()
  const mod = testRegistry.find((m) => m.id === activeId) ?? testRegistry[0]
  const gated = mod.requiresConnection && !(status?.connected && status?.transport_ready)
  const { Page } = mod
  return (
    <Box
      component="fieldset"
      disabled={gated}
      sx={{
        border: 0,
        m: 0,
        p: 0,
        minWidth: 0,
        opacity: gated ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <Page />
    </Box>
  )
}

export default function App() {
  const [logOpen, setLogOpen] = useState(true)
  const [activeId, setActiveId] = useState(testRegistry[0]?.id ?? '')
  const { mode } = useThemeMode()
  const p = getAppPalette(mode)
  const s = p.sidebar

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
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
              width: LOG_W,
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
        }}
      >
        <Box sx={{ pb: 2, mb: 3, borderBottom: `1px solid ${p.appBarBorder}` }}>
          <ConnectionPanel />
        </Box>
        <TestArea activeId={activeId} />
      </Box>

      <InstrumentsModal />

      <Drawer
        anchor="right"
        open={logOpen}
        onClose={() => setLogOpen(false)}
        variant="persistent"
        sx={{
          width: logOpen ? LOG_W : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: LOG_W,
            boxSizing: 'border-box',
            bgcolor: p.logBg,
            border: 0,
            top: TOP_BAR_H,
            height: `calc(100vh - ${TOP_BAR_H}px)`,
          },
        }}
      >
        <Stack sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
          <LogPanel embedded />
        </Stack>
      </Drawer>
    </Box>
  )
}
