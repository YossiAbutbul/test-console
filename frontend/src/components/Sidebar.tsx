import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, ButtonBase, CircularProgress, Collapse, Drawer, IconButton, ListItemButton,
  ListItemText, MenuItem, MenuList, Popover, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import { instrumentsApi } from '../api/instruments'
import { STORAGE_KEYS } from '../store/keys'
import { usePersistedState } from '../store/persistent'
import ChevronRightIcon from '@mui/icons-material/ChevronRightRounded'
import ScienceIcon from '@mui/icons-material/ScienceRounded'
import SettingsIcon from '@mui/icons-material/SettingsRounded'
import CheckIcon from '@mui/icons-material/CheckRounded'
import { useInstrumentsActions, useInstrumentsState } from '../context/InstrumentsContext'
import { alpha } from '@mui/material/styles'
import PowerRoundedIcon from '@mui/icons-material/PowerRounded'
import { useThemeMode, type ThemePreference } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import { CONTROL_H, SIDEBAR_W, TOP_BAR_H } from '../ui/tokens'
import { useShellLayout } from '../ui/useShellLayout'
import { testRegistry } from '../tests/registry'
import { useInstrumentsUnavailableReason } from '../context/CapabilitiesContext'
import type { TestModule } from '../tests/types'
import { LatchingKey, PRESS_SX } from '../ui'
import { useDutLink } from '../context/dutLink'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import { selectOnFocus, useSelectOnFocusSetting } from '../lib/selectOnFocus'

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
  /** Fold the floating sidebar away. While it floats it covers the toolbar's
   *  logo toggle that opened it, so its own logo -- in the same spot -- is
   *  the second press that closes it. */
  onClose?: () => void
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
  // The key fills what the voltage field leaves of the footer line (16 px
  // gutters, 80 px field, 8 px gap), so the two end flush at both edges.
  const { sidebarW } = useShellLayout()
  const keyW = sidebarW - 32 - 80 - 8
  const dc = instruments['dc-analyzer']
  const dcConnected = dc?.status === 'connected'
  const dcConnecting = dc?.status === 'connecting'
  const { connect, openInstrument } = useInstrumentsActions()
  const [enabled, setEnabled] = usePersistedState<boolean>(STORAGE_KEYS.dcSupplyEnabled, false)
  const [voltage, setVoltage] = usePersistedState<number>(STORAGE_KEYS.dcSupplyVoltage, 3.6)
  const [draft, setDraft] = useState<string>(String(voltage))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Kept apart from the supply's own error and read only while disconnected,
  // so a failed connect stops marking the footer once the analyzer connects
  // by any route (here, the panel, a preflight).
  const [connectErr, setConnectErr] = useState<string | null>(null)
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

  // Connecting is the step before the supply can do anything, so it is offered
  // where the supply is rather than a panel away. A blank address is fine: the
  // connect scans for the N6705 and binds it. When it fails, the panel opens
  // at the DC analyzer -- the address and the explained failure are there.
  const onConnect = async () => {
    setConnectErr(null)
    const r = await connect('dc-analyzer')
    if (!r.ok) {
      setConnectErr(r.failure?.title ?? 'Could not connect')
      openInstrument('dc-analyzer')
    }
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
  const shownConnectErr = dcConnected ? null : connectErr
  const reason = err
    ? `Supply command failed: ${err}`
    : shownConnectErr ? `DC analyzer: ${shownConnectErr}`
    : dcConnected ? (enabled ? 'DC analyzer supply is on' : 'Turn the DC analyzer supply on')
      : dcConnecting ? 'Connecting the DC analyzer…' : 'Connect the DC analyzer'
  return (
    <Box sx={{ minWidth: 0 }}>
      {/* The error mark sits on the label line, so the keys below it can take
          the full width of the footer in two even parts. */}
      <Stack direction="row" alignItems="center" sx={{ mb: 0.75, gap: 0.75 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: s.textDim }}>
          DC supply
        </Typography>
        <Box sx={{ display: 'flex', color: p.data.bad, visibility: err || shownConnectErr ? 'visible' : 'hidden' }}>
          <ErrorOutlineRoundedIcon sx={{ fontSize: 15 }} />
        </Box>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Tooltip title={reason} placement="top">
          <span>
            {dcConnected ? (
              <LatchingKey
                value={enabled}
                onChange={onToggle}
                offLabel="Off"
                onLabel="On"
                pending={busy}
                width={keyW}
              />
            ) : (
              // Until the analyzer is connected the slot holds the step that
              // is actually next, instead of a greyed Off that only said
              // "not yet". Same box as the power key that replaces it, so
              // nothing in the footer moves when it connects. Tinted, not
              // filled: the page's Run is the one filled key on screen. The
              // word holds while connecting; the spinner says it is working.
              <ButtonBase
                disableRipple
                onClick={() => { void onConnect() }}
                disabled={dcConnecting}
                aria-busy={dcConnecting || undefined}
                aria-label="Connect the DC analyzer"
                sx={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
                  width: keyW, minWidth: keyW, height: CONTROL_H.md, px: 1.5,
                  borderRadius: '8px', overflow: 'hidden', whiteSpace: 'nowrap',
                  fontSize: 13.5, fontWeight: 600,
                  color: s.accent, bgcolor: alpha(s.accent, 0.14),
                  transition: 'background-color .15s ease, transform 120ms',
                  ...PRESS_SX,
                  '&:hover': { bgcolor: alpha(s.accent, 0.2) },
                  '&.Mui-focusVisible': { outline: `2px solid ${s.accent}`, outlineOffset: 2 },
                  '&.Mui-disabled': { color: s.accent, bgcolor: alpha(s.accent, 0.1) },
                }}
              >
                {dcConnecting
                  ? <CircularProgress size={14} color="inherit" />
                  : <PowerRoundedIcon sx={{ fontSize: 17 }} />}
                Connect
              </ButtonBase>
            )}
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
          onFocus={selectOnFocus}
          inputProps={{ step: 0.1, min: 0, max: 60, 'aria-label': 'DC supply voltage' }}
          InputProps={{ endAdornment: <Typography sx={{ fontSize: 12, color: s.textDim }}>V</Typography> }}
          // Tight inner padding: in a 240 px sidebar the default 14 px each
          // side left room for one digit, and "3.6" read as "3".
          sx={{ width: 80, '& .MuiInputBase-root': { color: s.text, pr: 1 }, '& input': { pl: 1.25, pr: 0.5 } }}
        />
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
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: s.textDim, mb: 0.5 }}>
        DUT scan time
      </Typography>
      <TextField
        size="small"
        type="number"
        value={duration}
        disabled={isConnected || scanning}
        onChange={(e) => setDuration(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
        onFocus={selectOnFocus}
        inputProps={{ min: 1, max: 30, 'aria-label': 'DUT scan time in seconds' }}
        InputProps={{ endAdornment: <Typography sx={{ fontSize: 12, color: s.textDim }}>s</Typography> }}
        sx={{ width: 96, '& .MuiInputBase-root': { color: s.text } }}
      />
    </Box>
  )
}

/** Whether clicking into a field selects its value. Off by default. */
function SelectOnFocusSetting() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const [on, setOn] = useSelectOnFocusSetting()
  return (
    // The whole row toggles, as a settings row does; the switch mirrors it.
    <Stack
      component="label"
      direction="row"
      alignItems="center"
      sx={{ px: 1.5, py: 0.5, gap: 1, cursor: 'pointer', borderRadius: '6px', '&:hover': { bgcolor: s.hover } }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: s.text }}>
          Select text on focus
        </Typography>
        <Typography sx={{ fontSize: 12, color: s.textDim }}>
          Clicking a field selects its value
        </Typography>
      </Box>
      <Switch size="small" checked={on} onChange={(e) => setOn(e.target.checked)} inputProps={{ 'aria-label': 'Select text on focus' }} />
    </Stack>
  )
}

function SettingsButton() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  const { preference, setPreference } = useThemeMode()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Tooltip title="Settings" placement="bottom">
        <IconButton
          aria-label="Settings"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ color: s.textDim, mr: -0.75, '&:hover': { color: s.text, bgcolor: s.hover } }}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        keepMounted
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 240,
              bgcolor: getAppPalette(mode).paper,
              color: s.text,
              borderRadius: '10px',
              p: 1,
              mt: 0.5,
            },
          },
        }}
      >
        <ScanTimeSetting />
        <SelectOnFocusSetting />
        <Typography sx={{ px: 1.5, pt: 0.5, pb: 0.5, fontSize: 12, fontWeight: 600, color: s.textDim }}>
          Theme
        </Typography>
        {/* Real menu items, so the theme can be chosen from the keyboard and
            a screen reader hears which one is on. They were clickable rows
            with no role or tab stop. */}
        <MenuList dense aria-label="Theme" sx={{ py: 0 }}>
          {THEME_OPTIONS.map((opt) => {
            const sel = preference === opt.value
            return (
              <MenuItem
                key={opt.value}
                role="menuitemradio"
                aria-checked={sel}
                onClick={() => { setPreference(opt.value); setAnchor(null) }}
                sx={{
                  px: 1.5, minHeight: CONTROL_H.md, borderRadius: '6px', color: s.text, gap: 1,
                  // The hover row is the accent fill, so an accent check on
                  // it vanished; it takes the row's text colour there.
                  '&:hover .theme-check, &.Mui-focusVisible .theme-check': { color: 'inherit' },
                }}
              >
                <Typography sx={{ flexGrow: 1, fontSize: 13, fontWeight: 500 }}>
                  {opt.label}
                </Typography>
                <CheckIcon className="theme-check" sx={{ fontSize: 16, color: s.accent, visibility: sel ? 'visible' : 'hidden' }} />
              </MenuItem>
            )
          })}
        </MenuList>
      </Popover>
    </>
  )
}

function StatusFoot() {
  const { mode } = useThemeMode()
  const s = getAppPalette(mode).sidebar
  // The DC supply, in view on every page: it powers the DUT. The credit that
  // used to float over the bottom-right corner of the window lives here too,
  // where it no longer paints over the inspector.
  return (
    <Box sx={{ px: 2, pt: 1.25, pb: 1, borderTop: `1px solid ${s.border}` }}>
      <DcSupplySection />
      <Typography noWrap sx={{ fontSize: 12, color: s.textDim, mt: 1 }}>
        © {new Date().getFullYear()}{' '}
        <Box
          component="a"
          href="https://github.com/YossiAbutbul"
          target="_blank"
          rel="noopener noreferrer"
          sx={{ color: s.textDim, textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline', color: s.text } }}
        >
          Yossi Abutbul
        </Box>
      </Typography>
    </Box>
  )
}

export function Sidebar({ activeId, onSelect, open, floating, onClose }: SidebarProps) {
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
    // Every section starts open: a flat list of a dozen rows fits the column,
    // and a closed section hides the page you came for. The root pages
    // (Components) fold too, under the key 'root'.
    const out: Record<string, boolean> = { root: true }
    for (const p of PROTOCOLS) out[p] = true
    if (initialMod) out[initialMod.root ? 'root' : initialMod.protocol] = true
    return out
  })
  const toggleProto = (key: string) => setExpandedProto((st) => ({ ...st, [key]: !st[key] }))
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
          bgcolor: s.bg,
          color: s.text,
          border: 0,
          borderRight: `1px solid ${s.border}`,
          ...(floating ? { boxShadow: '8px 0 24px rgba(0,0,0,0.18)' } : null),
          // Full height, as a macOS sidebar: the window toolbar starts at its
          // edge rather than running across it.
          top: 0,
          height: '100vh',
          display: 'flex', flexDirection: 'column',
          zIndex: (t) => t.zIndex.drawer + 1,
        },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ height: TOP_BAR_H, px: 2, gap: 1.25, flexShrink: 0 }}>
        {floating && onClose ? (
          // The same key, at the same place, as the toolbar's logo toggle the
          // floating sidebar now covers: pressing it again closes the menu.
          <Tooltip title="Hide menu" placement="bottom-start">
            <IconButton aria-label="Hide menu" aria-expanded onClick={onClose} sx={{ ml: -0.5, mr: -0.75 }}>
              <Box
                sx={{
                  width: 26, height: 26, borderRadius: '7px',
                  bgcolor: s.text, color: s.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <ScienceIcon sx={{ fontSize: 16 }} />
              </Box>
            </IconButton>
          </Tooltip>
        ) : (
          <Box
            sx={{
              width: 26, height: 26, borderRadius: '7px', flexShrink: 0,
              bgcolor: s.text, color: s.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ScienceIcon sx={{ fontSize: 16 }} />
          </Box>
        )}
        <Typography noWrap sx={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', flexGrow: 1 }}>
          Test Console
        </Typography>
        {/* Settings with the app's name, as an app's preferences sit with its
            name in macOS. In the footer it was a 28 px glyph wedged beside the
            DC supply keys, none of them the same size. */}
        <SettingsButton />
      </Stack>
      <Box component="nav" aria-label="Pages" sx={{ flexGrow: 1, overflowY: 'auto', px: 1.25, pb: 1.5 }}>
        {/* Sections, not a folder tree. The protocol is the section header;
            its groups (TX, Other) were a second level of folders that each
            held a handful of rows, and opening one was a click spent on
            finding a page rather than on using it. Protocols with no pages yet
            (BLE) are not listed: a greyed "coming soon" row was a control that
            did nothing. */}
        {tree.filter((p) => p.groups.length > 0).map(({ protocol, groups }) => {
          const isRoot = protocol == null
          const pkey = protocol ?? 'root'
          const protoExp = expandedProto[pkey] ?? true
          const mods = groups.flatMap((g) => g.mods)
          const heading = isRoot ? (groups[0]?.group ?? 'Components') : protocol
          const headerProps = {
            role: 'button' as const,
            tabIndex: 0,
            'aria-expanded': protoExp,
            // A plain toggle, not an accordion: comparing two protocols means
            // having both open.
            onClick: () => toggleProto(pkey),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleProto(pkey)
              }
            },
          }
          return (
            <Box key={pkey} sx={{ mt: 1.5 }}>
              <Stack
                direction="row"
                alignItems="center"
                {...headerProps}
                sx={{
                  px: 1, height: 26, borderRadius: '6px',
                  color: s.textDim,
                  cursor: 'pointer',
                  // The chevron shows on hover, as in Finder: a section header
                  // that always carried one read as a control first and a
                  // heading second. A closed section keeps it, as the sign
                  // there is more inside.
                  '& .sb-chev': { opacity: protoExp ? 0 : 1, transition: 'opacity .15s' },
                  '&:hover .sb-chev, &:focus-visible .sb-chev': { opacity: 1 },
                  '&:focus-visible': { outline: 'none', bgcolor: s.hover },
                }}
              >
                <Typography sx={{ flexGrow: 1, fontSize: 12, fontWeight: 600 }}>{heading}</Typography>
                <Box
                  className="sb-chev"
                  component="span"
                  sx={{ display: 'flex', transform: protoExp ? 'rotate(90deg)' : 'none', transition: 'transform .18s, opacity .15s' }}
                >
                  <ChevronRightIcon sx={{ fontSize: 16 }} />
                </Box>
              </Stack>
              <Collapse in={protoExp} unmountOnExit>
                {mods.map((m) => {
                  const sel = m.id === activeId
                  // Greyed out rather than hidden, so the sidebar reads the
                  // same on a PC without a rig and the tooltip can say what is
                  // missing.
                  const blocked = m.requiresInstruments ? noInstruments : null
                  return (
                    <Tooltip
                      key={m.id}
                      title={blocked ?? ''}
                      placement="right"
                      // A disabled button fires no pointer events, so the
                      // tooltip has to listen on the wrapper.
                      disableHoverListener={!blocked}
                    >
                      <Box>
                        <ListItemButton
                          disableRipple
                          disabled={!!blocked}
                          selected={sel}
                          aria-current={sel ? 'page' : undefined}
                          onClick={() => onSelect(m.id)}
                          sx={{
                            borderRadius: '6px',
                            px: 1, mx: 0, my: '1px',
                            height: 30,
                            gap: 1,
                            color: s.text,
                            '&:hover': { bgcolor: sel ? s.accentSoftHover : s.hover },
                            '&.Mui-disabled': { opacity: 0.38 },
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ display: 'flex', width: 18, justifyContent: 'center', color: s.accent, '& svg': { fontSize: 17 } }}
                          >
                            {m.icon}
                          </Box>
                          <ListItemText
                            primary={m.label}
                            primaryTypographyProps={{ fontSize: 13.5, fontWeight: sel ? 600 : 400, noWrap: true }}
                          />
                        </ListItemButton>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Collapse>
            </Box>
          )
        })}
      </Box>
      <StatusFoot />
    </Drawer>
  )
}
