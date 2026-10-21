import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Collapse, Drawer, IconButton, ListItemButton,
  ListItemText, Popover, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { instrumentsApi } from '../api/instruments'
import { STORAGE_KEYS } from '../store/keys'
import { usePersistedState } from '../store/persistent'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SettingsIcon from '@mui/icons-material/Settings'
import CheckIcon from '@mui/icons-material/Check'
import { useInstrumentsState } from '../context/InstrumentsContext'
import { useThemeMode, type ThemePreference } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { SIDEBAR_W, TOP_BAR_H } from '../ui/tokens'
import { useShellLayout } from '../ui/useShellLayout'
import { testRegistry } from '../tests/registry'
import { useInstrumentsUnavailableReason } from '../context/CapabilitiesContext'
import type { TestModule } from '../tests/types'
import { LatchingKey } from '../ui'
import { useDutLink } from '../context/dutLink'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'

// Re-exported for the call sites that reach for them alongside Sidebar; the
// values themselves live with the rest of the layout tokens.
export { SIDEBAR_W, TOP_BAR_H }

const PROTOCOLS: Array<'LoRa' | 'LTE' | 'BLE'> = ['LoRa', 'LTE', 'BLE']

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
  /** Folded away entirely when false — the logo in the top bar toggles it. */
  open: boolean
  /** Float over the page instead of holding a column of its own. */
  floating: boolean
}

type ProtocolTree = Array<{
  /** `null` for rig-level pages, which render at the top with no protocol row. */
  protocol: 'LoRa' | 'LTE' | 'BLE' | null
  groups: Array<{ group: string; mods: TestModule[] }>
}>

function byGroup(mods: TestModule[]): Array<{ group: string; mods: TestModule[] }> {
  const groupMap = new Map<string, TestModule[]>()
  for (const m of mods) {
    const k = m.group ?? '_'
    if (!groupMap.has(k)) groupMap.set(k, [])
    groupMap.get(k)!.push(m)
  }
  return Array.from(groupMap.entries()).map(([group, mods]) => ({ group, mods }))
}

function useProtocolTree(): ProtocolTree {
  return useMemo(() => {
    // Rig-level pages sit below the protocols: they are not part of any
    // protocol's menu, and filing them under LoRa implied they were. Last
    // rather than first so the protocol a session starts from stays at the top.
    const rootMods = testRegistry.filter((m) => m.root)
    const rootEntry = rootMods.length
      ? [{ protocol: null, groups: byGroup(rootMods) }]
      : []
    return [
      ...PROTOCOLS.map((protocol) => ({
        protocol,
        groups: byGroup(testRegistry.filter((m) => !m.root && m.protocol === protocol)),
      })),
      ...rootEntry,
    ] as ProtocolTree
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
  const p = getAppPalette(mode)
  const s = p.sidebar
  const { instruments } = useInstrumentsState()
  const dcConnected = instruments['dc-analyzer']?.status === 'connected'
  const [enabled, setEnabled] = usePersistedState<boolean>(STORAGE_KEYS.dcSupplyEnabled, false)
  const [voltage, setVoltage] = usePersistedState<number>(STORAGE_KEYS.dcSupplyVoltage, 3.6)
  const [draft, setDraft] = useState<string>(String(voltage))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setDraft(String(voltage)) }, [voltage])

  // No auto-apply on connect / menu open: the supply turns on ONLY when the
  // user flips the toggle below. Avoids surprise power-on when opening settings.
  // Since we no longer push the persisted state to the hardware, reset the
  // toggle to OFF once on mount so it matches the known-off supply — otherwise
  // a stale persisted `true` would show ON while the output is actually off,
  // making the first toggle click send *disable* and look like a no-op.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    if (enabled) setEnabled(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // In the sidebar footer, on every page, rather than inside Settings: it
  // powers the DUT, so its state should be in view, not a menu away. Same
  // control and same behaviour as before -- a latching key in place of the
  // switch, so it reads like the Modem key and carries the hazard ring while it
  // would power the DUT. Errors and the "connect the analyzer first" reason go
  // in the tooltip, so the footer keeps one height.
  const reason = err
    ? `Supply command failed: ${err}`
    : dcConnected ? (enabled ? 'DC analyzer supply is on' : 'Turn the DC analyzer supply on') : 'Connect the DC analyzer first'
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: s.textDim, mb: 0.5 }}>
        DC supply
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Tooltip title={reason} placement="top">
          <span>
            <LatchingKey
              value={enabled}
              onChange={onToggle}
              offLabel="Off"
              onLabel="On"
              disabled={!dcConnected || busy}
              width={96}
            />
          </span>
        </Tooltip>
        <TextField
          size="small"
          type="number"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitVoltage}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          inputProps={{ step: 0.1, min: 0, max: 60, 'aria-label': 'DC supply voltage' }}
          InputProps={{ endAdornment: <Typography sx={{ fontSize: 12, color: s.textDim }}>V</Typography> }}
          sx={{ width: 84, '& .MuiInputBase-root': { color: s.text } }}
        />
        <Box sx={{ width: 18, display: 'flex', color: p.data.bad, visibility: err ? 'visible' : 'hidden' }}>
          <ErrorOutlineRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
      </Stack>
    </Box>
  )
}

/**
 * How long a DUT scan listens. It sat in the top bar as an unlabelled "5 s"
 * field beside the device type, a setting chosen once and then left; here it
 * is named, and the bar keeps the controls used on every connect.
 */
function ScanTimeSetting() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { duration, setDuration, isConnected, scanning } = useDutLink()
  return (
    <Box sx={{ px: 1.5, pt: 0.75, pb: 1 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: s.textDim, mb: 0.5 }}>
        DUT scan time
      </Typography>
      <TextField
        size="small"
        type="number"
        value={duration}
        disabled={isConnected || scanning}
        onChange={(e) => setDuration(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
        onFocus={(e) => (e.target as HTMLInputElement).select()}
        inputProps={{ min: 1, max: 30, 'aria-label': 'DUT scan time in seconds' }}
        InputProps={{ endAdornment: <Typography sx={{ fontSize: 12, color: s.textDim }}>s</Typography> }}
        sx={{ width: 96, '& .MuiInputBase-root': { color: s.text } }}
      />
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
        keepMounted
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
        <ScanTimeSetting />
        <Typography sx={{ px: 1.5, pt: 0.5, pb: 0.5, fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: s.textDim }}>
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
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  // The DUT's status used to live here; its connection controls are in the
  // top bar now, so the footer holds the DC supply instead.
  return (
    <Box sx={{ px: 2, py: 1.25, borderTop: `1px solid ${s.border}` }}>
      <Stack direction="row" alignItems="flex-end" spacing={1}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <DcSupplySection />
        </Box>
        <SettingsButton />
      </Stack>
    </Box>
  )
}

export function Sidebar({ activeId, onSelect, open, floating }: SidebarProps) {
  const tree = useProtocolTree()
  const { sidebarW } = useShellLayout()
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  // Non-null in the DUT-only desktop build: the message explaining why every
  // rig page below is greyed out.
  const noInstruments = useInstrumentsUnavailableReason()
  // The page on screen at mount. After a reload that is whichever one was last
  // used, so the tree has to open around it — a selected page inside a closed
  // protocol reads as nothing being selected at all. Read once, not tracked:
  // this only seeds the initial state, and reopening a branch the operator
  // deliberately collapsed would be worse than leaving it shut.
  const [initialMod] = useState(() => testRegistry.find((m) => m.id === activeId))

  const [expandedProto, setExpandedProto] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const p of PROTOCOLS) out[p] = false
    // Root pages belong to no protocol, so fall back to the old default of
    // opening the first one rather than leaving every branch shut.
    if (initialMod && !initialMod.root) out[initialMod.protocol] = true
    else out[PROTOCOLS[0]] = true
    return out
  })
  const [expandedGroup, setExpandedGroup] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    // A protocol's groups start open except its 'Other' drawer. Root groups
    // (Components) start closed: they are rig tools rather than the tests
    // most sessions come for, and open they push LTE and BLE off the bottom.
    for (const p of tree) {
      for (const g of p.groups) {
        out[`${p.protocol ?? 'root'}/${g.group}`] = p.protocol != null && g.group !== 'Other'
      }
    }
    // ...except the one holding the page on screen, which opens even if it is
    // an 'Other' drawer.
    if (initialMod) {
      const proto = initialMod.root ? 'root' : initialMod.protocol
      out[`${proto}/${initialMod.group ?? '_'}`] = true
    }
    return out
  })
  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      // Marks the paper for the click-away in `App`. A stable hook of our own
      // rather than a `.MuiDrawer-*` class, which is an emotion implementation
      // detail and has moved between MUI majors before.
      PaperProps={{ 'data-app-nav': '' } as Record<string, string>}
      sx={{
        // The root is what reserves a column; the paper is fixed either way.
        // Zero it when the menu is folded away, and when it is floating over a
        // narrow window, so the page gets the whole width in both cases.
        width: open && !floating ? sidebarW : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: sidebarW,
          boxSizing: 'border-box',
          bgcolor: getAppPalette(mode).logBg,
          color: s.text,
          border: 0,
          ...(floating
            ? {
                borderRight: `1px solid ${s.border}`,
                boxShadow: '8px 0 24px rgba(0,0,0,0.18)',
              }
            : null),
          top: TOP_BAR_H,
          height: `calc(100vh - ${TOP_BAR_H}px)`,
          display: 'flex', flexDirection: 'column',
          zIndex: (t) => t.zIndex.drawer + 1,
        },
      }}
    >
      <Box sx={{ flexGrow: 1, overflowY: 'auto', py: 1.5 }}>
        {/* No Instruments entry here: the top bar's Instruments lamp opens the
            same panel and shows the count, so a second way in only repeated
            it. Protocols with no pages yet (BLE) are not listed: a greyed
            "coming soon" row was a control that did nothing. */}
        {tree.filter((p) => p.groups.length > 0).map(({ protocol, groups }) => {
          // Root entry: no protocol row to expand, and always open.
          const isRoot = protocol == null
          const pkey = protocol ?? 'root'
          const protoExp = isRoot ? true : (expandedProto[pkey] ?? true)
          const protoActive = groups.some((g) => g.mods.some((m) => m.id === activeId))
          const empty = groups.length === 0
          return (
            <Box key={pkey} sx={{ mb: 0.5 }}>
              {!isRoot && (
              <Stack
                direction="row"
                alignItems="center"
                // A plain toggle, not an accordion. Opening one protocol used
                // to close the others, which undid the branch the operator had
                // just been working in every time they looked at another one --
                // and comparing two protocols means having both open.
                onClick={() => setExpandedProto((st) => ({ ...st, [pkey]: !st[pkey] }))}
                sx={{
                  mx: 1.5,
                  mb: 0.25,
                  px: 1.25,
                  height: 36,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  // A protocol with no pages yet is quiet by colour, not by 50 %
                  // opacity: faded that way its label fell to 3.8:1 in Light.
                  color: empty ? 'text.disabled' : protoActive ? s.text : s.textDim,
                  '&:hover': { bgcolor: s.hover, color: empty ? 'text.disabled' : s.text },
                  gap: 1,
                }}
              >
                {protoExp ? <FolderOpenIcon sx={{ fontSize: 15 }} /> : <FolderIcon sx={{ fontSize: 15 }} />}
                <Typography sx={{ flexGrow: 1, fontSize: 13.5, fontWeight: 600 }}>
                  {protocol}
                </Typography>
                {empty && (
                  <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic' }}>
                    coming soon
                  </Typography>
                )}
                {!empty && (
                  protoExp
                    ? <ExpandMoreIcon sx={{ fontSize: 16, color: s.textDim }} />
                    : <ChevronRightIcon sx={{ fontSize: 16, color: s.textDim }} />
                )}
              </Stack>
              )}
              <Collapse in={protoExp && !empty} unmountOnExit>
                <Box sx={{ pl: isRoot ? 0 : 1.5, position: 'relative' }}>
                  {/* The guide line marks nesting under a protocol; at the root
                      there is nothing to nest under. */}
                  {!isRoot && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 18, top: 4, bottom: 4,
                        width: '1px',
                        bgcolor: s.border,
                      }}
                    />
                  )}
                  {groups.map(({ group, mods }) => {
                    const hasGroup = group !== '_'
                    const key = `${pkey}/${group}`
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
                              // Greyed out rather than hidden, so the sidebar
                              // reads the same on a PC without a rig and the
                              // tooltip can say what is missing.
                              const blocked = m.requiresInstruments ? noInstruments : null
                              return (
                                <Box key={m.id} sx={{ px: 1.5 }}>
                                  <Tooltip
                                    title={blocked ?? ''}
                                    placement="right"
                                    // A disabled button fires no pointer events,
                                    // so the tooltip has to listen on the wrapper.
                                    disableHoverListener={!blocked}
                                  >
                                    <Box>
                                      <ListItemButton
                                        disableRipple
                                        disabled={!!blocked}
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
                                          '&.Mui-disabled': { opacity: 0.38 },
                                        }}
                                      >
                                        <ListItemText
                                          primary={m.label}
                                          primaryTypographyProps={{ fontSize: 14, fontWeight: sel ? 600 : 500 }}
                                        />
                                      </ListItemButton>
                                    </Box>
                                  </Tooltip>
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
