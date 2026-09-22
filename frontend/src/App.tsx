import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Drawer, IconButton, Stack, Tooltip, Typography, type Theme,
} from '@mui/material'
import ArticleIcon from '@mui/icons-material/Article'
import CloseIcon from '@mui/icons-material/Close'
import ScienceIcon from '@mui/icons-material/Science'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import { ConnectionPanel } from './components/ConnectionPanel'
import { SearchBar } from './components/SearchBar'
import { LogPanel } from './components/LogPanel'
import { ChatPanel } from './components/ChatPanel'
import { useChat } from './context/ChatContext'
import { InstrumentsModal } from './components/InstrumentsModal'
import { useConnection } from './context/ConnectionContext'
import {
  useCapabilities, useInstrumentsUnavailableReason,
} from './context/CapabilitiesContext'
import { useThemeMode } from './context/ThemeModeContext'
import { getAppPalette } from './theme'
import { testRegistry } from './tests/registry'
import { Sidebar, TOP_BAR_H } from './components/Sidebar'
import { SHELL_NARROW_W } from './ui/tokens'
import { useShellLayout } from './ui'

/** Band at the bottom of the window owned by the fixed copyright footer.
 *  Anything that paints under it has to stop short by this much. */
const FOOTER_CLEARANCE = 26
import { STORAGE_KEYS, usePersistedState } from './store'

const LOG_MIN_W = 240
const LOG_MAX_W = 720
const LOG_DEFAULT_W = 340

/** How much of a narrow window the floating dock may cover. It overlays the
 *  page rather than sharing the row with it, so it can afford to be wider
 *  than the docked default -- but not so wide the page behind it is gone. */
const LOG_OVERLAY_MAX_FRAC = 0.62

/** Shown in place of a rig page on a build that has no instrument support. */
function NoInstrumentsNotice({ label, reason }: { label: string; reason: string }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ flexGrow: 1, minHeight: 0, p: 4, textAlign: 'center' }}
    >
      <ScienceIcon sx={{ fontSize: 40, opacity: 0.35 }} />
      <Typography sx={{ fontSize: 18, fontWeight: 600 }}>
        {label} needs an instrument
      </Typography>
      <Typography sx={{ fontSize: 14, opacity: 0.7, maxWidth: 440 }}>
        {reason} The pages that talk to the DUT still work; this one drives rig
        hardware and has nothing to do without it.
      </Typography>
    </Stack>
  )
}

function TestArea({ activeId }: { activeId: string }) {
  const { status } = useConnection()
  const noInstruments = useInstrumentsUnavailableReason()
  const { known } = useCapabilities()
  const activeMod = testRegistry.find((m) => m.id === activeId) ?? testRegistry[0]
  const gated = activeMod.requiresConnection && !(status?.connected && status?.transport_ready)
  // The sidebar will not navigate here, but the last-used page is restored
  // from storage on load -- so a bundle opened on a PC with no rig can land on
  // a rig page that was left selected the last time the same browser profile
  // ran the rig build.
  const unavailable = activeMod.requiresInstruments ? noInstruments : null
  const waiting = !!activeMod.requiresInstruments && !known
  // Rig pages are not mounted at all on a build without instruments, rather
  // than mounted and unreachable. Every page mounts at startup (see below) and
  // these ones go looking for their hardware as they do, so leaving them in
  // means a DUT-only build greets its user with a log full of red 501s from
  // scans that were never going to find anything.
  //
  // They also wait for `known`, which is the same problem one step earlier:
  // capabilities arrive a round trip after first paint, and a rig page mounted
  // in the meantime has already sent its discover. Holding them back costs one
  // localhost round trip on the rig, where it is invisible, and is the
  // difference between a clean start and a wall of errors everywhere else.
  const pages = useMemo(
    () => (known && !noInstruments
      ? testRegistry
      : testRegistry.filter((m) => !m.requiresInstruments)),
    [known, noInstruments],
  )

  // All pages mount once on app start and we toggle visibility via `display`.
  // This trades a slightly slower first paint for instant sidebar navigation —
  // no remount, no useQuery refetch storm. Pages keep their internal state
  // (form inputs, results tables) across switches automatically.
  return (
    <Box
      aria-disabled={gated || undefined}
      sx={{
        minWidth: 0,
        pointerEvents: gated ? 'none' : 'auto',
        // Dim everything except panels marked `data-ungated` (results, with
        // their import/export), which work on data already on screen and have
        // nothing to wait for from the DUT. Opacity cannot be undone by a
        // child, so rather than dimming this box the rule dims the topmost
        // elements that neither are nor contain an ungated panel: the children
        // of the gate, and of any box on the path down to an ungated panel.
        ...(gated ? {
          [`& > :not([data-ungated]):not(:has([data-ungated])),
            & :has([data-ungated]) > :not([data-ungated]):not(:has([data-ungated]))`]: {
            opacity: 0.6,
          },
          '& [data-ungated]': { pointerEvents: 'auto' },
        } : null),
        '& > *': { transition: 'opacity 0.15s' },
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {unavailable && (
        <NoInstrumentsNotice label={activeMod.label} reason={unavailable} />
      )}
      {waiting && (
        // Rig pages are held back until the backend has said what it can
        // drive (see `pages`). Without this the page area is simply empty
        // while it is down, which looks exactly like a broken page.
        <Stack alignItems="center" justifyContent="center" sx={{ flexGrow: 1, minHeight: 0, p: 4 }}>
          <Typography sx={{ fontSize: 14, opacity: 0.7 }}>
            Waiting for the backend…
          </Typography>
        </Stack>
      )}
      {pages.map((mod) => {
        const { Page } = mod
        const isActive = mod.id === activeMod.id && !unavailable && !waiting
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

const NARROW_QUERY = `(max-width:${SHELL_NARROW_W - 1}px)`

/** Whether the window is currently too narrow to dock both side panels. */
function isNarrowWindow() {
  return window.matchMedia(NARROW_QUERY).matches
}

/** Which panel the right-hand dock is showing. */
type DockTab = 'log' | 'chat'

export default function App() {
  const { narrow, sidebarW } = useShellLayout()
  // Read the query directly for the initial value rather than leaning on
  // `narrow` plus an effect: an effect runs after the first paint, so these
  // would flash open and shove the page sideways on every reload at half
  // width. Both open by default on a window wide enough to hold them, as
  // before.
  const [logOpen, setLogOpen] = useState(() => !isNarrowWindow())
  const [navOpen, setNavOpen] = useState(() => !isNarrowWindow())
  /**
   * The menu only folds away on a window too narrow to carry it.
   *
   * Derived rather than stored, so widening the window brings the menu back
   * on its own: a collapsed state that survived into a full-screen window
   * would leave the app with no visible navigation and a logo that gives no
   * sign it is hiding any.
   */
  const navVisible = narrow ? navOpen : true

  /**
   * Dismiss the floating menu on a click anywhere else, and on Escape.
   *
   * It covers the page it is sitting on, so reaching for something underneath
   * it is already the gesture for "done with the menu" -- without this the
   * first click was spent closing it and the second did the work. Only while
   * it floats: docked it costs the page nothing and closing it on a stray
   * click would be a nuisance.
   *
   * `mousedown`, not `click`: a click on a control under the panel would
   * otherwise land on an element that had already moved by the time the click
   * completed. The toggle is excluded, or its own click would close the menu
   * here and reopen it in the handler.
   */
  useEffect(() => {
    if (!narrow || !navOpen) return
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-app-nav],[data-nav-toggle]')) return
      setNavOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [narrow, navOpen])
  /**
   * One-shot nudge after the menu folds itself away.
   *
   * The fold happens as a side effect of dragging the window narrower, not of
   * anything the operator clicked, so without this the menu simply vanishes
   * and the logo gives no sign it has taken it. Shown only on that crossing,
   * and only until it is acknowledged or times out -- a tooltip that reappears
   * every time the pointer nears the corner is worse than no hint at all.
   */
  const [navHint, setNavHint] = useState(false)
  const [logoHover, setLogoHover] = useState(false)
  const [dockTab, setDockTab] = usePersistedState<DockTab>(STORAGE_KEYS.dockTab, 'log')
  const [logW, setLogW] = usePersistedState<number>(STORAGE_KEYS.logWidth, LOG_DEFAULT_W)
  /**
   * The test page on screen, remembered across reloads.
   *
   * Read back through the registry rather than used directly: pages get
   * renamed and refiled between releases, and a stored id that no longer
   * resolves would leave the sidebar with nothing highlighted and the content
   * area falling back on its own. Resolving here keeps the two agreeing. The
   * stale value stays in storage until the next selection overwrites it, which
   * costs nothing.
   */
  const [storedId, setActiveId] = usePersistedState<string>(
    STORAGE_KEYS.activePage, testRegistry[0]?.id ?? '',
  )
  const activeId = testRegistry.some((m) => m.id === storedId)
    ? storedId
    : (testRegistry[0]?.id ?? '')
  // Dragging the window down to half the screen with both panels open used to
  // leave ~300px for the page. Folding them away on the way in is the whole
  // point of the breakpoint; neither is reopened on the way back out, since by
  // then the operator has been working without it.
  //
  // A media-query subscription rather than an effect on `narrow`: this has to
  // fire on the *crossing*, not on every render where the window happens to be
  // narrow, or reopening either panel by hand would immediately undo itself.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        setNavHint(false)
        return
      }
      setLogOpen(false)
      setNavOpen(false)
      setNavHint(true)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Long enough to be read mid-drag, short enough not to sit over the page
  // while the operator gets on with something else.
  useEffect(() => {
    if (!navHint) return
    const t = window.setTimeout(() => setNavHint(false), 5000)
    return () => window.clearTimeout(t)
  }, [navHint])

  const { mode } = useThemeMode()
  // Off unless the backend says otherwise, so the dock is exactly what it was
  // before the assistant existed.
  const { available: chatOn } = useChat()
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

  /**
   * Tab strip and close button for the dock.
   *
   * Lives in the top bar while the dock is docked, so its title sits on the
   * same line as the app title and the search box. Once the dock floats there
   * is no column in the bar to put it in -- the bar belongs to the page
   * underneath -- so it moves inside the panel instead.
   */
  const dockHeader = (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ width: '100%', minWidth: 0 }}
    >
      <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, overflow: 'hidden' }}>
        {(chatOn ? (['log', 'chat'] as DockTab[]) : (['log'] as DockTab[])).map((tab) => (
          <Typography
            key={tab}
            onClick={() => setDockTab(tab)}
            sx={{
              fontSize: 14,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              color: s.text,
              opacity: dockTab === tab ? 1 : 0.45,
              borderBottom: dockTab === tab ? `2px solid ${s.text}` : '2px solid transparent',
              transition: 'opacity 0.15s',
            }}
          >
            {tab === 'log' ? 'Log' : 'Assistant'}
          </Typography>
        ))}
      </Stack>
      <IconButton size="small" onClick={() => setLogOpen(false)} aria-label="Close panel">
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Stack>
  )

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
        {/* On a narrow window the logo doubles as the menu toggle: it already
            sits in the corner the menu belongs to, and a hamburger beside it
            would have spent on a second control the width the sidebar just
            gave back. Inert on a wide window, where the menu never folds and a
            clickable logo would only invite a click that does nothing.

            Only as wide as the sidebar while the sidebar is actually holding
            that column open; once it folds away or starts floating, the bar
            closes up and the search box re-centres. */}
        <Tooltip
          placement="bottom-start"
          // Controlled, because the hint has to appear without the pointer
          // going anywhere near the logo. Hover and focus still drive it
          // through `onOpen`/`onClose`, which MUI fires either way.
          open={narrow && (navHint || logoHover)}
          onOpen={() => setLogoHover(true)}
          onClose={() => { setLogoHover(false); setNavHint(false) }}
          // One line, same length as the ordinary labels. A sentence
          // explaining itself sat across the first two fields of the page and
          // read as an error, which is a lot of weight for a hint.
          title={navHint ? 'Menu hidden - click to show' : (navOpen ? 'Hide menu' : 'Show menu')}
          slotProps={{ tooltip: { sx: { whiteSpace: 'nowrap', maxWidth: 'none' } } }}
        >
          <Box
            component={narrow ? 'button' : 'div'}
            type={narrow ? 'button' : undefined}
            data-nav-toggle=""
            aria-label={narrow ? (navOpen ? 'Hide menu' : 'Show menu') : undefined}
            aria-expanded={narrow ? navOpen : undefined}
            onClick={narrow ? () => { setNavHint(false); setNavOpen((v) => !v) } : undefined}
            sx={{
              width: navVisible && !narrow ? sidebarW : 'auto',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              pl: 2.2,
              pr: 1.5,
              minWidth: 0,
              overflow: 'hidden',
              border: 0,
              bgcolor: 'transparent',
              font: 'inherit',
              textAlign: 'left',
              ...(narrow
                ? {
                    cursor: 'pointer',
                    '&:hover .app-logo-mark': { opacity: 0.82 },
                    '&:focus-visible': {
                      outline: `2px solid ${s.text}`, outlineOffset: -2,
                    },
                  }
                : null),
            }}
          >
            <Box
              className="app-logo-mark"
              sx={{
                width: 34, height: 34, borderRadius: 1.25,
                bgcolor: s.text,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'opacity 0.15s',
              }}
            >
              <ScienceIcon sx={{ fontSize: 20, color: s.bg }} />
            </Box>
            <Typography
              noWrap
              sx={{ fontWeight: 700, fontSize: 18, color: s.text, lineHeight: 1.15 }}
            >
              Test Console
            </Typography>
          </Box>
        </Tooltip>

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
            <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', right: 12 }}>
              <Tooltip title="Open log">
                <IconButton size="small" onClick={() => { setDockTab('log'); setLogOpen(true) }}>
                  <ArticleIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {chatOn && (
                <Tooltip title="Open assistant">
                  <IconButton size="small" onClick={() => { setDockTab('chat'); setLogOpen(true) }}>
                    <SmartToyOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          )}
        </Box>

        {logOpen && !narrow && (
          <Box sx={{ width: logW, flexShrink: 0, px: 1.5, display: 'flex' }}>
            {dockHeader}
          </Box>
        )}
      </Box>

      <Sidebar
        open={navVisible}
        floating={narrow}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
          window.scrollTo({ top: 0, behavior: 'smooth' })
          // A floating menu covers the page it just navigated to, so getting
          // out of the way is part of the selection.
          if (narrow) setNavOpen(false)
        }}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          // 32px of side gutter is a luxury on a half-width window -- it is
          // two number fields' worth of room taken from the page to leave
          // white space at the edges.
          px: 2,
          [`@media (min-width:${SHELL_NARROW_W}px)`]: { px: 4 },
          pt: `${TOP_BAR_H + 24}px`,
          pb: 3,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          // Pages that own the remaining height still scroll inside
          // themselves; this is for the case they cannot cover -- a window
          // short enough that the connection row and the page header alone
          // overflow it. That used to be clipped with no way to reach it.
          //
          // No scrollbar: it would appear and disappear with the window
          // height, and a gutter opening and closing down the side of the page
          // shifts every control under it. The wheel, trackpad, keyboard and
          // focus scrolling all still work.
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Box
          sx={{
            flexShrink: 0,
            pb: 2,
            mb: 2,
            [`@media (min-width:${SHELL_NARROW_W}px)`]: { mb: 3 },
            borderBottom: `1px solid ${p.appBarBorder}`,
            // The connection row sizes its fields off this box rather than off
            // the window, which the floating dock does not change.
            containerType: 'inline-size',
          }}
        >
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
          // Zero while floating: `persistent` reserves its width by sizing the
          // root, and the whole point on a narrow window is that the dock
          // costs the page nothing. The paper is `position: fixed` either way,
          // so dropping the root's width is all it takes to turn a column into
          // an overlay -- no modal, no backdrop, and the page underneath stays
          // clickable, which a `temporary` drawer would have taken away.
          width: logOpen && !narrow ? logW : 0,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: narrow
              ? `min(${logW}px, ${Math.round(LOG_OVERLAY_MAX_FRAC * 100)}vw)`
              : logW,
            boxSizing: 'border-box',
            bgcolor: p.logBg,
            border: 0,
            // Floating over the page rather than beside it, so it needs an
            // edge of its own; docked, the page's own background provides it.
            // The paper is fixed, but the docked root that carries MUI's own
            // z-index is statically positioned, so the rule never applies and
            // the page painted straight over the top of the panel. Docked that
            // never showed, because the panel had its own column to sit in.
            ...(narrow
              ? {
                  zIndex: (t: Theme) => t.zIndex.drawer + 1,
                  borderLeft: `1px solid ${p.appBarBorder}`,
                  boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
                }
              : null),
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
        {/* `flex: 1` rather than `height: 100%`: the drawer paper is a column
            flex container whose height comes from its own sx, and a percentage
            height on a child of it resolves against nothing -- the panel
            collapsed to zero and its chips and input row overflowed on top of
            each other rather than the transcript giving up the space. */}
        <Stack sx={{ p: 2, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {narrow && (
            <Box sx={{ display: 'flex', mb: 1, flexShrink: 0 }}>{dockHeader}</Box>
          )}
          {/* Both stay mounted: switching tabs must not lose the log's scroll
              position or a half-typed question. */}
          <Box
            sx={{
              // Falls back to the log when the assistant is off, so a stored
              // "chat" tab from a session that had it on cannot leave the dock
              // showing nothing.
              display: dockTab === 'log' || !chatOn ? 'flex' : 'none',
              flexDirection: 'column', flex: 1, minHeight: 0,
            }}
          >
            <LogPanel embedded />
          </Box>
          <Box
            sx={{
              display: chatOn && dockTab === 'chat' ? 'flex' : 'none',
              flexDirection: 'column', flex: 1, minHeight: 0,
            }}
          >
            {chatOn && <ChatPanel embedded />}
          </Box>
        </Stack>
      </Drawer>
    </Box>
  )
}
