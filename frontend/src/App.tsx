import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { alpha } from '@mui/material/styles'
import {
  Box, Button, Drawer, IconButton, Stack, Tooltip, Typography, type Theme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/CloseRounded'
import ScienceIcon from '@mui/icons-material/ScienceRounded'
import MenuOpenIcon from '@mui/icons-material/MenuOpenRounded'
import { BenchPane } from './components/BenchInspector'
import { DutLinkProvider } from './context/DutLinkContext'
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
import {
  DutGateContext, PageActiveContext, SegmentedChoice, ToolbarSlotContext, useShellLayout,
} from './ui'
import { STORAGE_KEYS, usePersistedState } from './store'

/** The inspector's width range. Its floor is the bench's: the DUT's MAC field
 *  and its two keys need 280 px to sit on their lines without clipping. */
const LOG_MIN_W = 280
const LOG_MAX_W = 720
const LOG_DEFAULT_W = 320

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

/** Everything the DUT gate dims: the topmost elements that neither are nor
 *  contain an ungated panel (see TestArea). */
const GATE_DIMMED = `& > :not([data-ungated]):not(:has([data-ungated])),
  & :has([data-ungated]) > :not([data-ungated]):not(:has([data-ungated]))`

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
          [GATE_DIMMED]: { opacity: 0.6 },
          '& [data-ungated]': { pointerEvents: 'auto' },
        } : null),
        // The fade sits on the same selector list as the dim, gated or not, so
        // it runs on the way in and the way out -- on `& > *` alone the
        // elements dimmed through the second branch snapped.
        [GATE_DIMMED]: { transition: 'opacity 0.15s' },
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
            {/* Send and Run read the gate to say what they are waiting for
                (see ui/gate.ts). Only the page on screen can be gated. */}
            <DutGateContext.Provider value={isActive && gated}>
              <PageActiveContext.Provider value={isActive}>
                <Page protocol={mod.protocol} group={mod.group} active={isActive} />
              </PageActiveContext.Provider>
            </DutGateContext.Provider>
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

/** Which pane the inspector is showing. */
type DockTab = 'bench' | 'log' | 'chat'

export default function App() {
  const { narrow } = useShellLayout()
  // Read the query directly for the initial value rather than leaning on
  // `narrow` plus an effect: an effect runs after the first paint, so these
  // would flash open and shove the page sideways on every reload at half
  // width. Both open by default on a window wide enough to hold them, as
  // before.
  const [paneOpen, setPaneOpen] = useState(() => !isNarrowWindow())
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
   * The same for the inspector while it floats: a click anywhere else, or
   * Escape, puts it away. Docked it has its own column and stays put.
   *
   * Clicks inside what the inspector opens are not "elsewhere": the
   * Instruments dialog, the path-loss table, a select's menu and the MAC
   * list all render in portals outside the panel, and closing the inspector
   * under them would pull the bench out from under the operator. Escape is
   * left to an open dialog or menu first, for the same reason.
   */
  useEffect(() => {
    if (!narrow || !paneOpen) return
    const PORTALS = '.MuiModal-root, .MuiPopover-root, .MuiPopper-root, .MuiAutocomplete-popper'
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest(`[data-app-inspector],[data-inspector-toggle],${PORTALS}`)) return
      setPaneOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.MuiModal-root:not(.MuiModal-hidden), .MuiPopper-root')) return
      setPaneOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [narrow, paneOpen])
  /**
   * One-shot nudge after the menu folds itself away.
   *
   * The fold happens as a side effect of dragging the window narrower, not of
   * anything the operator clicked, so without this the menu simply vanishes
   * and the toggle gives no sign it has taken it. Shown only on that crossing,
   * and only until it is acknowledged or times out -- a tooltip that reappears
   * every time the pointer nears the corner is worse than no hint at all.
   */
  const [navHint, setNavHint] = useState(false)
  const [toggleHover, setToggleHover] = useState(false)
  // Always opens on Bench, not on whichever tab was last left up: Bench is
  // where a session starts (DUT, path loss, instruments), and coming back to
  // the Log after a reload hid the DUT connection behind a tab.
  const [dockTab, setDockTab] = useState<DockTab>('bench')
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
      setPaneOpen(false)
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
  // The toolbar is the page's to fill (see ui/toolbarSlot.ts); a callback ref
  // in state, so pages re-render into it once it exists.
  const [barEl, setBarEl] = useState<HTMLElement | null>(null)
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null)
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)
  const toolbarSlots = useMemo(
    () => ({ bar: barEl, title: titleEl, actions: actionsEl }),
    [barEl, titleEl, actionsEl],
  )
  // A stored "chat" tab from a session that had the assistant on falls back to
  // the bench rather than leaving the inspector showing nothing.
  const tab: DockTab = dockTab === 'chat' && !chatOn ? 'bench' : dockTab
  const { status: dutStatus } = useConnection()
  const activeMod = testRegistry.find((m) => m.id === activeId)
  const gatedHere = !!activeMod?.requiresConnection
    && !(dutStatus?.connected && dutStatus?.transport_ready)

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

  const tabs = [
    { value: 'bench' as const, label: 'Bench' },
    { value: 'log' as const, label: 'Log' },
    ...(chatOn ? [{ value: 'chat' as const, label: 'Assistant' }] : []),
  ]

  return (
    <DutLinkProvider>
    <ToolbarSlotContext.Provider value={toolbarSlots}>
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Sidebar
        open={navVisible}
        floating={narrow}
        onClose={() => setNavOpen(false)}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
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
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          // Pages that own the remaining height still scroll inside
          // themselves; this is for the case they cannot cover -- a window
          // short enough that the page header alone overflows it. That used to
          // be clipped with no way to reach it.
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
        {/* The window toolbar: the page's title and header keys (portalled in
            by PageHeader), the live-output pills, and the inspector toggle. A
            material rather than a slab: the page scrolls under it, and a light
            blur keeps it a layer above the content instead of a strip cut out
            of it. Solid again for people who ask for less transparency. */}
        <Box
          component="header"
          ref={setBarEl}
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: (t) => t.zIndex.appBar,
            flexShrink: 0,
            height: TOP_BAR_H,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            [`@media (min-width:${SHELL_NARROW_W}px)`]: { px: 3 },
            bgcolor: alpha(p.contentBg, 0.8),
            backdropFilter: 'blur(20px) saturate(180%)',
            borderBottom: `1px solid ${alpha(p.appBarBorder, 0.8)}`,
            '@media (prefers-reduced-transparency: reduce)': {
              bgcolor: p.contentBg,
              backdropFilter: 'none',
            },
          }}
        >
          {narrow && (
            <Tooltip
              placement="bottom-start"
              // Controlled, because the hint has to appear without the pointer
              // going anywhere near the toggle. Hover and focus still drive it
              // through `onOpen`/`onClose`, which MUI fires either way.
              open={navHint || toggleHover}
              onOpen={() => setToggleHover(true)}
              onClose={() => { setToggleHover(false); setNavHint(false) }}
              title={navHint ? 'Menu hidden - click to show' : (navOpen ? 'Hide menu' : 'Show menu')}
              slotProps={{ tooltip: { sx: { whiteSpace: 'nowrap', maxWidth: 'none' } } }}
            >
              <IconButton
                data-nav-toggle=""
                aria-label={navOpen ? 'Hide menu' : 'Show menu'}
                aria-expanded={navOpen}
                onClick={() => { setNavHint(false); setNavOpen((v) => !v) }}
                aria-pressed={navOpen}
                sx={{ ml: -0.5 }}
              >
                {/* The app's logo, the same mark the sidebar opens with: on a
                    narrow window it is what the folded sidebar leaves behind,
                    and clicking it brings the sidebar back. */}
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
          )}
          <Box ref={setTitleEl} sx={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center' }} />
          {/* No live-output pills: the operator removed them. The badge
              ("DC ON 3.60 V") read as a key with no clear purpose, and each
              page already shows its own output's state. This slot sits between
              the title and the keys, so what it holds takes its room from the
              title and never moves a key (see ToolbarSlots). */}
          <Box sx={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', display: 'flex', gap: 0.5 }}>
            {/* With the inspector closed (the default below 1200 px) a gated
                page dimmed with its only Connect control out of sight behind
                an unlabelled glyph. This names the missing step and opens the
                bench. */}
            {gatedHere && !paneOpen && (
              <Button
                size="small"
                variant="outlined"
                data-inspector-toggle=""
                onClick={() => { setDockTab('bench'); setPaneOpen(true) }}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap', borderRadius: 999, px: 1.5 }}
              >
                Connect DUT
              </Button>
            )}
          </Box>
          <Box ref={setActionsEl} sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }} />
          <Tooltip title={paneOpen ? 'Hide inspector' : 'Show inspector'} placement="bottom-end">
            <IconButton
              data-inspector-toggle=""
              aria-label={paneOpen ? 'Hide inspector' : 'Show inspector'}
              aria-pressed={paneOpen}
              onClick={() => setPaneOpen((v) => !v)}
              sx={{ color: paneOpen ? s.text : s.textDim, mr: -0.5 }}
            >
              {/* Its own glyph: the same sidebar mark as the menu toggle, only
                  mirrored, made the two corners of the toolbar look alike. The
                  arrow points the way the panel will go: in from the right
                  while closed, back out while open. */}
              <MenuOpenIcon sx={{ fontSize: 20, transform: paneOpen ? 'scaleX(-1)' : 'none' }} />
            </IconButton>
          </Tooltip>
        </Box>
        <Box
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            // 32px of side gutter is a luxury on a half-width window -- it is
            // two number fields' worth of room taken from the page to leave
            // white space at the edges.
            px: 2,
            [`@media (min-width:${SHELL_NARROW_W}px)`]: { px: 3 },
            pt: 2.5,
            pb: 3,
          }}
        >
          <TestArea activeId={activeId} />
        </Box>
      </Box>

      <InstrumentsModal />

      {/* The inspector: the bench on every page, with the log and the
          assistant as its other panes. It took over the top bar's DUT row,
          its Instruments lamp and the log dock, which said the same things in
          three places. */}
      <Drawer
        anchor="right"
        // Marks the paper for the click-away above.
        PaperProps={{ 'data-app-inspector': '' } as Record<string, string>}
        open={paneOpen}
        onClose={() => setPaneOpen(false)}
        variant="persistent"
        sx={{
          // Zero while floating: `persistent` reserves its width by sizing the
          // root, and the whole point on a narrow window is that the dock
          // costs the page nothing. The paper is `position: fixed` either way,
          // so dropping the root's width is all it takes to turn a column into
          // an overlay -- no modal, no backdrop, and the page underneath stays
          // clickable, which a `temporary` drawer would have taken away.
          width: paneOpen && !narrow ? logW : 0,
          flexShrink: 0,
          // The column eases on the paper's own curve, so page and panel move
          // as one. It used to flip in a single frame while the paper slid:
          // the page snapped 320 px and painted over the panel on its way out.
          transition: (t: Theme) => t.transitions.create('width', {
            easing: t.transitions.easing.sharp,
            duration: paneOpen ? t.transitions.duration.enteringScreen : t.transitions.duration.leavingScreen,
          }),
          '& .MuiDrawer-paper': {
            width: narrow
              ? `min(${logW}px, ${Math.round(LOG_OVERLAY_MAX_FRAC * 100)}vw)`
              : logW,
            boxSizing: 'border-box',
            bgcolor: p.logBg,
            border: 0,
            borderLeft: `1px solid ${p.appBarBorder}`,
            // Floating over the page rather than beside it, so it needs a
            // shadow of its own; docked, the hairline is enough. The paper is
            // fixed, but the docked root that carries MUI's own z-index is
            // statically positioned, so the rule never applies and the page
            // painted straight over the top of the panel. Docked that never
            // showed, because the panel had its own column to sit in.
            ...(narrow
              ? {
                  zIndex: (t: Theme) => t.zIndex.drawer + 1,
                  boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
                }
              : null),
            top: 0,
            height: '100vh',
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
            '&:active': { bgcolor: s.accent },
            transition: 'background-color 0.15s',
          }}
        />
        {/* `flex: 1` rather than `height: 100%`: the drawer paper is a column
            flex container whose height comes from its own sx, and a percentage
            height on a child of it resolves against nothing -- the panel
            collapsed to zero and its chips and input row overflowed on top of
            each other rather than the transcript giving up the space. */}
        <Stack sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Stack direction="row" alignItems="center" sx={{ height: TOP_BAR_H, px: 2, gap: 1, flexShrink: 0 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <SegmentedChoice
                text
                fullWidth
                size="md"
                aria-label="Inspector pane"
                value={tab}
                options={tabs}
                onChange={setDockTab}
              />
            </Box>
            {narrow && (
              <IconButton size="small" onClick={() => setPaneOpen(false)} aria-label="Close panel">
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Stack>
          {/* All stay mounted: switching panes must not lose the log's scroll
              position or a half-typed question. */}
          <Box sx={{ display: tab === 'bench' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <BenchPane />
          </Box>
          <Box sx={{ display: tab === 'log' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, px: 2, pb: 2 }}>
            <LogPanel embedded />
          </Box>
          <Box sx={{ display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, px: 2, pb: 2 }}>
            {chatOn && <ChatPanel embedded />}
          </Box>
        </Stack>
      </Drawer>
    </Box>
    </ToolbarSlotContext.Provider>
    </DutLinkProvider>
  )
}
