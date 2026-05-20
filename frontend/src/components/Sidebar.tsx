import { useMemo, useState } from 'react'
import {
  Box, Collapse, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Popover, Stack, Tooltip, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SettingsIcon from '@mui/icons-material/Settings'
import CableIcon from '@mui/icons-material/Cable'
import CheckIcon from '@mui/icons-material/Check'
import { useConnection } from '../context/ConnectionContext'
import { useInstruments } from '../context/InstrumentsContext'
import { useThemeMode, type ThemePreference } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { testRegistry } from '../tests/registry'
import type { TestModule } from '../tests/types'

export const SIDEBAR_W = 264
export const TOP_BAR_H = 56

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
}

function useGroups() {
  return useMemo(() => {
    const map = new Map<string, TestModule[]>()
    for (const m of testRegistry) {
      const k = m.group ?? '_'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(m)
    }
    return Array.from(map.entries())
  }, [])
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'mid', label: 'Mid' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match system' },
]

function SettingsButton() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { preference, setPreference } = useThemeMode()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Tooltip title="Settings" placement="top">
        <IconButton
          size="small"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ color: s.textDim, '&:hover': { color: s.text, bgcolor: s.hover } }}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 200,
              bgcolor: s.bg,
              color: s.text,
              border: `1px solid ${s.border}`,
              borderRadius: 2,
              p: 1,
              mt: -0.5,
            },
          },
        }}
      >
        <Typography sx={{ px: 1.5, pt: 0.5, pb: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: s.textDim }}>
          Theme
        </Typography>
        {THEME_OPTIONS.map((opt) => {
          const sel = preference === opt.value
          return (
            <Stack
              key={opt.value}
              direction="row"
              alignItems="center"
              onClick={() => { setPreference(opt.value); setAnchor(null) }}
              sx={{
                px: 1.5, py: 0.85,
                borderRadius: 1.25,
                cursor: 'pointer',
                color: s.text,
                '&:hover': { bgcolor: s.hover },
                gap: 1,
              }}
            >
              <Typography sx={{ flexGrow: 1, fontSize: 13, fontWeight: sel ? 600 : 500 }}>
                {opt.label}
              </Typography>
              {sel && <CheckIcon sx={{ fontSize: 16, color: s.accent }} />}
            </Stack>
          )
        })}
      </Popover>
    </>
  )
}

function StatusFoot() {
  const { status } = useConnection()
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const connected = !!status?.connected
  return (
    <Box sx={{ px: 2, py: 1.25, borderTop: `1px solid ${s.border}` }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: connected ? s.success : s.successOff,
            boxShadow: connected ? `0 0 0 3px ${s.success}26` : 'none',
            flexShrink: 0,
          }}
        />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: s.text }}>
            {connected ? 'Connected' : 'Disconnected'}
          </Typography>
          {connected && (
            <Tooltip title={status?.address ?? ''} placement="top">
              <Typography
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  color: s.textDim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {status?.name ?? status?.address}
              </Typography>
            </Tooltip>
          )}
        </Box>
        <SettingsButton />
      </Stack>
    </Box>
  )
}

export function Sidebar({ activeId, onSelect }: SidebarProps) {
  const groups = useGroups()
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { setOpen: openInstruments, instruments } = useInstruments()
  const anyConnected = Object.values(instruments).some((i) => i.status === 'connected')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(groups.map(([g]) => [g, true])),
  )
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: SIDEBAR_W,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: SIDEBAR_W,
          boxSizing: 'border-box',
          bgcolor: getAppPalette(mode).logBg,
          color: s.text,
          border: 0,
          top: TOP_BAR_H,
          height: `calc(100vh - ${TOP_BAR_H}px)`,
          display: 'flex', flexDirection: 'column',
          zIndex: (t) => t.zIndex.drawer + 1,
        },
      }}
    >
      <Box sx={{ flexGrow: 1, overflowY: 'auto', py: 1.5 }}>
        <Box sx={{ px: 1.5, mb: 1.5 }}>
          <ListItemButton
            disableRipple
            onClick={() => openInstruments(true)}
            sx={{
              borderRadius: 1.5,
              px: 1.25,
              py: 1,
              color: s.textDim,
              '&:hover': { bgcolor: s.hover, color: s.text },
            }}
          >
            <ListItemIcon sx={{ minWidth: 30, color: anyConnected ? s.success : 'inherit' }}>
              <CableIcon sx={{ fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary="Instruments"
              primaryTypographyProps={{ fontSize: 14.5, fontWeight: 500 }}
            />
            {anyConnected && (
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: s.success, mr: 0.5 }} />
            )}
          </ListItemButton>
        </Box>
        {groups.map(([group, mods]) => {
          const hasGroup = group !== '_'
          const isExp = expanded[group] ?? true
          const groupActive = mods.some((m) => m.id === activeId)
          return (
            <Box key={group} sx={{ mb: 2 }}>
              {hasGroup && (
                <Stack
                  direction="row"
                  alignItems="center"
                  onClick={() => setExpanded((st) => ({ ...st, [group]: !st[group] }))}
                  sx={{
                    ml: 1.5,
                    mr: '18px',
                    mb: 0.5,
                    px: 1.25,
                    py: 1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    color: groupActive ? s.text : s.textDim,
                    '&:hover': { bgcolor: s.hover, color: s.text },
                    gap: 1,
                  }}
                >
                  {isExp ? <FolderOpenIcon sx={{ fontSize: 16 }} /> : <FolderIcon sx={{ fontSize: 16 }} />}
                  <Typography sx={{ flexGrow: 1, fontSize: 12.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                    {group}
                  </Typography>
                  {isExp ? <ExpandMoreIcon sx={{ fontSize: 16, color: s.textDim }} /> : <ChevronRightIcon sx={{ fontSize: 16, color: s.textDim }} />}
                </Stack>
              )}
              <Collapse in={!hasGroup || isExp} unmountOnExit>
                <List dense disablePadding sx={{ position: 'relative', pl: hasGroup ? 2 : 0 }}>
                  {hasGroup && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 22, top: 4, bottom: 4,
                        width: '1px',
                        bgcolor: s.border,
                      }}
                    />
                  )}
                  {mods.map((m) => {
                    const sel = m.id === activeId
                    return (
                      <Box key={m.id} sx={{ px: 1.5 }}>
                        <ListItemButton
                          disableRipple
                          onClick={() => onSelect(m.id)}
                          sx={{
                            borderRadius: 1.5,
                            px: 1.5,
                            py: 1,
                            my: 0.25,
                            color: sel ? s.text : s.textDim,
                            bgcolor: sel ? s.accentSoft : 'transparent',
                            '&:hover': { bgcolor: sel ? s.accentSoftHover : s.hover, color: s.text },
                          }}
                        >
                          <ListItemText
                            primary={m.label}
                            primaryTypographyProps={{ fontSize: 14.5, fontWeight: sel ? 600 : 500 }}
                          />
                        </ListItemButton>
                      </Box>
                    )
                  })}
                </List>
              </Collapse>
            </Box>
          )
        })}
      </Box>
      <StatusFoot />
    </Drawer>
  )
}
