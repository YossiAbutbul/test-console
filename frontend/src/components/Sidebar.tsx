import { useEffect, useMemo, useState } from 'react'
import {
  Box, Collapse, Divider, Drawer, IconButton, ListItemButton, ListItemIcon,
  ListItemText, Popover, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import { instrumentsApi } from '../api/instruments'
import { STORAGE_KEYS } from '../store/keys'
import { usePersistedState } from '../store/persistent'
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

export const SIDEBAR_W = 300
export const TOP_BAR_H = 56

const PROTOCOLS: Array<'LoRa' | 'LTE' | 'BLE'> = ['LoRa', 'LTE', 'BLE']

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
}

type ProtocolTree = Array<{
  protocol: 'LoRa' | 'LTE' | 'BLE'
  groups: Array<{ group: string; mods: TestModule[] }>
}>

function useProtocolTree(): ProtocolTree {
  return useMemo(() => {
    return PROTOCOLS.map((protocol) => {
      const mods = testRegistry.filter((m) => m.protocol === protocol)
      const groupMap = new Map<string, TestModule[]>()
      for (const m of mods) {
        const k = m.group ?? '_'
        if (!groupMap.has(k)) groupMap.set(k, [])
        groupMap.get(k)!.push(m)
      }
      return {
        protocol,
        groups: Array.from(groupMap.entries()).map(([group, mods]) => ({ group, mods })),
      }
    })
  }, [])
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'mid', label: 'Mid' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match system' },
]

function DcSupplySection() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { instruments } = useInstruments()
  const dcConnected = instruments['dc-analyzer']?.status === 'connected'
  const [enabled, setEnabled] = usePersistedState<boolean>(STORAGE_KEYS.dcSupplyEnabled, false)
  const [voltage, setVoltage] = usePersistedState<number>(STORAGE_KEYS.dcSupplyVoltage, 3.6)
  const [draft, setDraft] = useState<string>(String(voltage))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setDraft(String(voltage)) }, [voltage])

  // Auto-apply persisted setting when DC analyzer (re)connects — but only
  // when the supply is enabled. Sending disable_output on every reconnect
  // (the disabled-by-default case) spams the backend with calls that fail
  // 500 when the wrapper isn't fully ready yet.
  useEffect(() => {
    if (!dcConnected || !enabled) return
    setBusy(true); setErr(null)
    instrumentsApi.setDcSupply(true, voltage)
      .catch((e: any) => setErr(String(e?.message ?? e)))
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcConnected])

  const apply = async (en: boolean, v: number) => {
    if (!dcConnected) return
    setBusy(true); setErr(null)
    try {
      await instrumentsApi.setDcSupply(en, v)
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const onToggle = (next: boolean) => {
    setEnabled(next)
    void apply(next, voltage)
  }

  const commitVoltage = () => {
    const n = Number(draft)
    if (!Number.isFinite(n) || n < 0 || n > 60) { setDraft(String(voltage)); return }
    setVoltage(n)
    if (enabled) void apply(true, n)
  }

  return (
    <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: s.textDim, mb: 0.5 }}>
        DC Analyzer Supply
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Switch
          size="small"
          checked={enabled}
          disabled={!dcConnected || busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <TextField
          size="small"
          type="number"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitVoltage}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          inputProps={{ step: 0.1, min: 0, max: 60, style: { fontSize: 13, padding: '4px 8px', width: 64 } }}
          sx={{ '& .MuiInputBase-root': { color: s.text } }}
        />
        <Typography sx={{ fontSize: 12, color: s.textDim }}>V</Typography>
      </Stack>
      {!dcConnected && (
        <Typography sx={{ fontSize: 11, color: s.textDim, mt: 0.5 }}>
          Connect DC analyzer to apply.
        </Typography>
      )}
      {err && (
        <Typography sx={{ fontSize: 11, color: '#f87171', mt: 0.5 }}>{err}</Typography>
      )}
    </Box>
  )
}

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
              minWidth: 240,
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
        <DcSupplySection />
        <Divider sx={{ my: 0.5, borderColor: s.border }} />
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
  const tree = useProtocolTree()
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { setOpen: openInstruments, instruments } = useInstruments()
  const anyConnected = Object.values(instruments).some((i) => i.status === 'connected')
  const [expandedProto, setExpandedProto] = useState<Record<string, boolean>>(
    () => ({ LoRa: true, LTE: false, BLE: false }),
  )
  const [expandedGroup, setExpandedGroup] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const p of tree) for (const g of p.groups) out[`${p.protocol}/${g.group}`] = g.group !== 'Other'
    return out
  })
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
              mx: 0,
              height: 36,
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
        {tree.map(({ protocol, groups }) => {
          const protoExp = expandedProto[protocol] ?? true
          const protoActive = groups.some((g) => g.mods.some((m) => m.id === activeId))
          const empty = groups.length === 0
          return (
            <Box key={protocol} sx={{ mb: 0.5 }}>
              <Stack
                direction="row"
                alignItems="center"
                onClick={() => setExpandedProto((st) => {
                  const isOpen = st[protocol]
                  if (isOpen) return { ...st, [protocol]: false }
                  const next: Record<string, boolean> = {}
                  for (const k of Object.keys(st)) next[k] = false
                  next[protocol] = true
                  return next
                })}
                sx={{
                  mx: 1.5,
                  mb: 0.25,
                  px: 1.25,
                  height: 36,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  color: protoActive ? s.text : s.textDim,
                  '&:hover': { bgcolor: s.hover, color: s.text },
                  opacity: empty ? 0.5 : 1,
                  gap: 1,
                }}
              >
                {protoExp ? <FolderOpenIcon sx={{ fontSize: 15 }} /> : <FolderIcon sx={{ fontSize: 15 }} />}
                <Typography sx={{ flexGrow: 1, fontSize: 13.5, fontWeight: 600 }}>
                  {protocol}
                </Typography>
                {empty && (
                  <Typography sx={{ fontSize: 10.5, color: s.textDim, fontStyle: 'italic' }}>
                    coming soon
                  </Typography>
                )}
                {!empty && (
                  protoExp
                    ? <ExpandMoreIcon sx={{ fontSize: 16, color: s.textDim }} />
                    : <ChevronRightIcon sx={{ fontSize: 16, color: s.textDim }} />
                )}
              </Stack>
              <Collapse in={protoExp && !empty} unmountOnExit>
                <Box sx={{ pl: 1.5, position: 'relative' }}>
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 18, top: 4, bottom: 4,
                      width: '1px',
                      bgcolor: s.border,
                    }}
                  />
                  {groups.map(({ group, mods }) => {
                    const hasGroup = group !== '_'
                    const key = `${protocol}/${group}`
                    const groupExp = expandedGroup[key] ?? true
                    const groupActive = mods.some((m) => m.id === activeId)
                    return (
                      <Box key={group} sx={{ mb: 1 }}>
                        {hasGroup && (
                          <Stack
                            direction="row"
                            alignItems="center"
                            onClick={() => setExpandedGroup((st) => ({ ...st, [key]: !st[key] }))}
                            sx={{
                              mx: 1.5,
                              px: 1.25,
                              height: 36,
                              borderRadius: 1.5,
                              cursor: 'pointer',
                              color: groupActive ? s.text : s.textDim,
                              '&:hover': { bgcolor: s.hover, color: s.text },
                              gap: 1,
                            }}
                          >
                            {groupExp ? <FolderOpenIcon sx={{ fontSize: 14 }} /> : <FolderIcon sx={{ fontSize: 14 }} />}
                            <Typography sx={{ flexGrow: 1, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                              {group}
                            </Typography>
                            {groupExp ? <ExpandMoreIcon sx={{ fontSize: 14, color: s.textDim }} /> : <ChevronRightIcon sx={{ fontSize: 14, color: s.textDim }} />}
                          </Stack>
                        )}
                        <Collapse in={!hasGroup || groupExp} unmountOnExit>
                          <Box sx={{ pl: hasGroup ? 2 : 0 }}>
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
                                      mx: 0,
                                      height: 36,
                                      my: 0.25,
                                      color: sel ? s.text : s.textDim,
                                      bgcolor: sel ? s.accentSoft : 'transparent',
                                      '&:hover': { bgcolor: sel ? s.accentSoftHover : s.hover, color: s.text },
                                    }}
                                  >
                                    <ListItemText
                                      primary={m.label}
                                      primaryTypographyProps={{ fontSize: 14, fontWeight: sel ? 600 : 500 }}
                                    />
                                  </ListItemButton>
                                </Box>
                              )
                            })}
                          </Box>
                        </Collapse>
                      </Box>
                    )
                  })}
                </Box>
              </Collapse>
            </Box>
          )
        })}
      </Box>
      <StatusFoot />
    </Drawer>
  )
}
