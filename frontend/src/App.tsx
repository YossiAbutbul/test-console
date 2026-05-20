import { useState } from 'react'
import {
  AppBar, Box, Chip, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemText, ListSubheader, Paper, Stack, Tab, Tabs, Toolbar, Tooltip, Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ArticleIcon from '@mui/icons-material/Article'
import CloseIcon from '@mui/icons-material/Close'
import { ConnectionPanel } from './components/ConnectionPanel'
import { LogPanel } from './components/LogPanel'
import { useConnection } from './context/ConnectionContext'
import { testRegistry } from './tests/registry'

const SIDEBAR_W = 248
const LOG_W = 400

interface SidebarProps {
  open: boolean
  onClose: () => void
  active: boolean
  onSelect: () => void
}

function Sidebar({ open, onClose, active, onSelect }: SidebarProps) {
  const { status } = useConnection()
  const connected = !!status?.connected
  return (
    <Drawer
      variant="persistent"
      open={open}
      sx={{
        width: open ? SIDEBAR_W : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: SIDEBAR_W,
          boxSizing: 'border-box',
          borderRight: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Toolbar sx={{ minHeight: 56, px: 2, gap: 1 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            letterSpacing: 0.2,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          TC
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.1 }}>Test Console</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
      </Toolbar>
      <Divider />

      <List
        dense
        subheader={
          <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px', px: 2.5, mt: 1 }}>
            <Typography variant="subtitle2">Tests</Typography>
          </ListSubheader>
        }
        sx={{ pt: 0, flexGrow: 1 }}
      >
        <ListItemButton selected={active} onClick={onSelect} sx={{ px: 1.5, mx: 1 }}>
          <ListItemText
            primary="CW Debug"
            primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
          />
        </ListItemButton>
      </List>

      <Divider />
      <Box sx={{ px: 2, py: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Device
          </Typography>
          <Chip
            size="small"
            label={connected ? 'online' : 'offline'}
            color={connected ? 'success' : 'default'}
            variant={connected ? 'filled' : 'outlined'}
            sx={{ height: 20, fontSize: 10.5 }}
          />
        </Stack>
        {connected && (
          <Typography
            sx={{
              mt: 0.5,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10.5,
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {status?.name ?? status?.address}
          </Typography>
        )}
      </Box>
    </Drawer>
  )
}

function TestArea({ tab, onTabChange }: { tab: number; onTabChange: (i: number) => void }) {
  const { status } = useConnection()
  const mod = testRegistry[tab] ?? testRegistry[0]
  const gated = mod.requiresConnection && !(status?.connected && status?.transport_ready)
  const { Page } = mod
  return (
    <Box>
      <Paper sx={{ mb: 2, px: 1 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => onTabChange(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {testRegistry.map((m) => (
            <Tab key={m.id} label={m.label} />
          ))}
        </Tabs>
      </Paper>

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
    </Box>
  )
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(true)
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton size="small" edge="start" onClick={() => setSidebarOpen((v) => !v)} sx={{ mr: 0.5 }}>
            <MenuIcon fontSize="small" />
          </IconButton>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, flexGrow: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 22, letterSpacing: 0.2 }}>
              Test Console
            </Typography>
          </Box>
          <Tooltip title="Toggle log">
            <IconButton size="small" onClick={() => setLogOpen((v) => !v)}>
              <ArticleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        active
        onSelect={() => {
          setTab(0)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          pt: 8,
          px: 3,
          pb: 3,
          transition: 'margin 0.2s',
        }}
      >
        <Box
          sx={{
            position: 'sticky',
            top: 64,
            zIndex: 2,
            bgcolor: 'background.default',
            pb: 2,
            mb: 2,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <ConnectionPanel />
        </Box>

        <TestArea tab={tab} onTabChange={setTab} />
      </Box>

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
            borderLeft: 1,
            borderColor: 'divider',
          },
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography variant="subtitle2">Log</Typography>
          <IconButton size="small" onClick={() => setLogOpen(false)}><CloseIcon fontSize="small" /></IconButton>
        </Toolbar>
        <Divider />
        <Stack sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
          <LogPanel embedded />
        </Stack>
      </Drawer>
    </Box>
  )
}
