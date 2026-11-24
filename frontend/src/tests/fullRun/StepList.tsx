/**
 * The sequence: one grouped list, a row per step, hairlines between them, and
 * a slim re-cable line wherever the bench has to change.
 *
 * A row opens in place to edit the step. Its handle drags it: the row lifts
 * and follows the pointer 1:1 from where it was grabbed, the others slide
 * aside on `transform` by its height (nothing reflows), and on release it
 * settles from where it was let go. A test dragged in from the library parts
 * the rows where it would land. A step just added arrives rather than
 * appearing. Reduced motion keeps every change and drops the movement.
 *
 * The list is also the run's progress: a row's result slot counts up while
 * its step runs and keeps the verdict after. The slot is reserved whatever it
 * shows, so a row never changes size as a run moves through it.
 */
import {
  useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react'
import {
  Box, CircularProgress, Collapse, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Switch, Tooltip, Typography,
} from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import CableIcon from '@mui/icons-material/CableRounded'
import CopyIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded'
import DragIcon from '@mui/icons-material/DragIndicatorRounded'
import ChevronIcon from '@mui/icons-material/ChevronRightRounded'
import { formatDuration } from '../../lib/async'
import { useAppPalette } from '../../context/ThemeModeContext'
import { REDUCED_MOTION, scrollBehavior } from '../../ui'
import type { StepOutcome } from './runSuite'
import { LIBRARY_MIME, PROTOCOLS, protocolMime } from './catalog'
import type { Protocol } from '../types'

export const ROW_H = 56
/** A setup's heading over its group. */
const GROUP_H = 28
/** The status capsule's slot, which Duplicate and Delete share on hover. */
const STATUS_W = 112

/** Critically damped, ~0.3 s: rows settle without overshoot. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const SLIDE = `transform 280ms ${EASE}`

/** A step arriving: it grows into place from just above, so the eye catches
 *  where it went. */
const arrive = keyframes`
  from { opacity: 0; transform: translateY(-6px) scale(0.985); }
  to { opacity: 1; transform: none; }
`
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`
/** The new row's highlight: strong as it lands, easing to the tint it keeps. */
const flash = (from: string, to: string) => keyframes`
  from { background-color: ${from}; }
  to { background-color: ${to}; }
`

export interface StepView {
  uid: string
  /** The operator's name for it, or the test's label. */
  title: string
  /** The test's label, when the step has a name of its own. */
  testLabel: string | null
  /** The note, or what the step measures at. */
  summary: string
  /** "LoRa", "LTE", "BLE": the group the step is in. */
  protocol: string
  /** Its bench setup's name, for the number's tooltip. */
  setupName: string
  /** Its protocol's colour: the group heading's and the step's number's. */
  color: string
  enabled: boolean
  points: number
  estimateMs: number
  /** Why the step cannot run as set, or null. */
  problem: string | null
  /** Its last result, if it has run. */
  outcome: StepOutcome | null
  /** Points done / planned, while it is the step in flight. */
  live: { done: number; total: number } | null
  /** Where the list moves onto this step's protocol: the heading's name
   *  ("LTE") and, for a re-cable, the setup it moves from. */
  group: { name: string; from: string | null } | null
}

function resultText(o: StepOutcome): string {
  switch (o.verdict) {
    case 'pass': return `${o.pass}/${o.pass + o.fail} PASS`
    case 'fail': return `${o.fail} FAIL · ${o.pass} PASS`
    case 'na': return `${o.measured} measured`
    case 'error': return o.message ? 'Could not go on' : `${o.errors} error${o.errors === 1 ? '' : 's'}`
    case 'stopped': return `Stopped ${o.measured}/${o.planned}`
    case 'not-run': return 'Not run'
  }
}

interface Props {
  steps: StepView[]
  running: boolean
  /** The step open for editing, if any. */
  open: string | null
  onOpen: (uid: string | null) => void
  /** The open step's editor. */
  detail: ReactNode
  /** The step added last, brought in with a short arrival. */
  arrived: string | null
  onMove: (from: number, to: number) => void
  /** A test dropped in from the library, at this index. */
  onInsert: (testId: string, index: number) => void
  onToggle: (uid: string, enabled: boolean) => void
  onDuplicate: (uid: string) => void
  onRemove: (uid: string) => void
  /** Shown, and a drop target, while there are no steps. */
  empty?: ReactNode
  /** The element that takes a drop from the library; the list by default. */
  zone?: HTMLElement | null
  /** A test from the library is over the zone (true) or has left it. */
  onDropOver?: (over: boolean) => void
}

interface Drag {
  uid: string
  from: number
  to: number
  startY: number
  dy: number
  /** Each item's top and height as the drag began. */
  tops: number[]
  heights: number[]
}

export function StepList({
  steps, running, open, onOpen, detail, arrived, onMove, onInsert, onToggle, onDuplicate, onRemove, empty, zone, onDropOver,
}: Props) {
  const palette = useAppPalette()
  // The right-click menu: the step it is for, and where it was opened.
  const [menu, setMenu] = useState<{ uid: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The frame the order changes in: transitions off, so the rows that had
  // stepped aside land in their new places without sliding a second time,
  // and the dropped row starts from where it was let go.
  const [settle, setSettle] = useState<{ uid: string; offset: number } | null>(null)
  // Where a test dragged in from the library would land: its index, and the
  // top of the gap the rows part to make for it. Measured in the drag
  // handler; render may not read the rows' refs.
  const [dropAt, setDropAt] = useState<{ index: number; y: number } | null>(null)
  const items = useRef(new Map<string, HTMLDivElement | null>())
  const handles = useRef(new Map<string, HTMLButtonElement | null>())
  const listRef = useRef<HTMLDivElement | null>(null)
  const refocus = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!settle) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettle(null)))
    return () => cancelAnimationFrame(id)
  }, [settle])

  // A step just added is brought into view if it landed out of sight: the
  // list may be scrolled, or the step dropped into a group below the fold.
  useEffect(() => {
    if (!arrived) return
    items.current.get(arrived)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [arrived])

  // Keyboard moves keep focus on the handle of the row that moved.
  useLayoutEffect(() => {
    const uid = refocus.current
    if (!uid) return
    refocus.current = null
    handles.current.get(uid)?.focus()
  })

  const n = steps.length
  const measure = () => steps.map((s) => {
    const el = items.current.get(s.uid)
    return { top: el?.offsetTop ?? 0, height: el?.offsetHeight ?? ROW_H }
  })

  // ---- reorder by dragging a handle
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, uid: string, index: number) => {
    if (running || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const m = measure()
    setDrag({
      uid, from: index, to: index, startY: e.clientY, dy: 0,
      tops: m.map((x) => x.top), heights: m.map((x) => x.height),
    })
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    // The place whose middle the dragged row's middle has passed.
    const mid = drag.tops[drag.from] + drag.heights[drag.from] / 2 + dy
    let to = 0
    for (let i = 0; i < n; i++) {
      if (i === drag.from) continue
      if (drag.tops[i] + drag.heights[i] / 2 < mid) to++
    }
    // Within its protocol's group: the sequence is kept grouped, so a place
    // in another group is one it would not stay in.
    const [lo, hi] = groupOf(drag.from)
    setDrag({ ...drag, dy, to: Math.max(lo, Math.min(hi, to)) })
  }
  const onPointerUp = () => {
    if (!drag) return
    const { uid, from, to, dy, tops, heights } = drag
    setDrag(null)
    if (to === from) {
      setSettle({ uid, offset: dy })
      return
    }
    onMove(from, to)
    const newTop = to > from ? tops[to] + heights[to] - heights[from] : tops[to]
    setSettle({ uid, offset: tops[from] + dy - newTop })
  }

  /** The first and last index of the protocol group step `i` is in. */
  const groupOf = (i: number): [number, number] => {
    let lo = i
    let hi = i
    while (lo > 0 && steps[lo - 1].protocol === steps[i].protocol) lo--
    while (hi < n - 1 && steps[hi + 1].protocol === steps[i].protocol) hi++
    return [lo, hi]
  }

  const move = (uid: string, from: number, to: number) => {
    const [lo, hi] = groupOf(from)
    if (to === from || to < lo || to > hi) return
    refocus.current = uid
    onMove(from, to)
  }
  const onHandleKey = (e: KeyboardEvent, uid: string, index: number) => {
    if (running) return
    if (e.key === 'ArrowUp') { e.preventDefault(); move(uid, index, index - 1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(uid, index, index + 1) }
  }

  /** Where a row is drawn relative to its place. */
  const offsetOf = (uid: string, i: number): number => {
    if (settle?.uid === uid) return settle.offset
    if (dropAt && i >= dropAt.index) return ROW_H
    if (!drag) return 0
    if (uid === drag.uid) return drag.dy
    const h = drag.heights[drag.from]
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return h
    return 0
  }

  // ---- insert from the library
  const fromLibrary = (e: globalThis.DragEvent) => !!e.dataTransfer?.types.includes(LIBRARY_MIME)
  const onDragOver = (e: globalThis.DragEvent) => {
    if (running || !fromLibrary(e) || !e.dataTransfer) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    onDropOver?.(true)
    const y = e.clientY - (listRef.current?.getBoundingClientRect().top ?? 0)
    const m = measure()
    let at = 0
    for (const x of m) if (x.top + x.height / 2 < y) at++
    // The test lands in its own protocol's group, however far from it it
    // is dropped: at the nearest place in the group, or where the group
    // goes if it has no steps yet. The gap opens there, so what is shown is
    // what will happen.
    const protocol = PROTOCOLS.find((p) => e.dataTransfer!.types.includes(protocolMime(p)))
    if (protocol) {
      const rank = PROTOCOLS.indexOf(protocol)
      const rankOf = (j: number) => PROTOCOLS.indexOf(steps[j].protocol as Protocol)
      let lo = 0
      while (lo < n && rankOf(lo) < rank) lo++
      let hi = lo
      while (hi < n && rankOf(hi) === rank) hi++
      at = Math.max(lo, Math.min(hi, at))
    }
    if (at === dropAt?.index) return
    const gapY = m.length === 0 ? 0
      : at >= m.length ? m[m.length - 1].top + m[m.length - 1].height
        : m[at].top
    setDropAt({ index: at, y: gapY })
  }
  const onDrop = (e: globalThis.DragEvent) => {
    const id = e.dataTransfer?.getData(LIBRARY_MIME)
    const at = dropAt?.index ?? n
    setDropAt(null)
    onDropOver?.(false)
    if (!id || running) return
    e.preventDefault()
    onInsert(id, at)
  }

  // The drop target is the whole zone the page names (the Sequence panel,
  // heading and all), else the list. Native listeners on it, reading the
  // handlers of the latest render through a ref, so they are added once.
  const dropHandlers = useRef({ over: onDragOver, drop: onDrop, dropOver: onDropOver })
  useEffect(() => { dropHandlers.current = { over: onDragOver, drop: onDrop, dropOver: onDropOver } })
  useEffect(() => {
    const el = zone ?? listRef.current
    if (!el) return
    const over = (e: globalThis.DragEvent) => dropHandlers.current.over(e)
    const drop = (e: globalThis.DragEvent) => dropHandlers.current.drop(e)
    const leave = (e: globalThis.DragEvent) => {
      if (el.contains(e.relatedTarget as Node | null)) return
      setDropAt(null)
      dropHandlers.current.dropOver?.(false)
    }
    el.addEventListener('dragover', over)
    el.addEventListener('drop', drop)
    el.addEventListener('dragleave', leave)
    return () => {
      el.removeEventListener('dragover', over)
      el.removeEventListener('drop', drop)
      el.removeEventListener('dragleave', leave)
    }
  }, [zone])

  return (
    <Box
      ref={listRef}
      role="list"
      aria-label="Steps"
      sx={{
        position: 'relative',
        // The whole of the sequence's area takes a drop, not just the rows:
        // the space under them is where most tests are let go.
        minHeight: '100%',
        // No text selection while a row is dragged: the pointer crosses other
        // rows' titles on the way, and they would light up under it.
        userSelect: drag ? 'none' : undefined,
        // Room for the gap a dropped test would land in, below the last row.
        pb: dropAt && n > 0 ? `${ROW_H}px` : 0,
      }}
    >
      {n === 0 && (
        <Box
          sx={{
            height: 2 * ROW_H, borderRadius: '12px', border: 1, borderStyle: 'dashed',
            borderColor: dropAt ? 'primary.main' : 'divider',
            bgcolor: dropAt ? 'action.hover' : 'transparent',
            display: 'grid', placeItems: 'center', transition: 'background-color 150ms, border-color 150ms',
          }}
        >
          {empty}
        </Box>
      )}

      {steps.map((s, i) => {
        const dragging = drag?.uid === s.uid
        const isOpen = open === s.uid
        const animate = !settle && !dragging
        const dim = s.enabled ? 1 : 0.45
        // During a run a step can still be opened to read its results --
        // once it has some -- but not to change it.
        const canOpen = !running || !!s.outcome || !!s.live
        const toggle = () => { if (canOpen) onOpen(isOpen ? null : s.uid) }
        // Where the step sits in its setup's group: the group's first row
        // takes the top corners, its last the bottom ones.
        const first = !!s.group
        const last = i === n - 1 || !!steps[i + 1]?.group
        const radius = dragging ? '12px'
          : `${first ? 12 : 0}px ${first ? 12 : 0}px ${last ? 12 : 0}px ${last ? 12 : 0}px`
        return (
          <Box
            key={s.uid}
            ref={(el: HTMLDivElement | null) => { items.current.set(s.uid, el) }}
            role="listitem"
            aria-label={`Step ${i + 1}: ${s.title}`}
            sx={{
              position: 'relative',
              // Space between groups is padding, not margin, so it travels
              // with the row when one is dragged (offsetHeight counts it).
              pt: first && i > 0 ? 2.5 : 0,
              transform: `translateY(${offsetOf(s.uid, i)}px)`,
              transition: animate ? SLIDE : 'none',
              zIndex: dragging ? 3 : 1,
              animation: s.uid === arrived ? `${arrive} 320ms ${EASE}` : undefined,
              [REDUCED_MOTION]: {
                transition: 'none',
                animation: s.uid === arrived ? `${fadeIn} 200ms ease` : 'none',
              },
            }}
          >
            {/* The setup's heading over its group, as a grouped list heads
                its sections: name, and the re-cable getting here costs.
                Hidden, not removed, while a row is dragged -- it describes
                the order being dragged away from. */}
            {s.group && (
              <Box
                sx={{
                  height: GROUP_H, display: 'flex', alignItems: 'center', gap: 1, px: 1.5,
                  visibility: drag ? 'hidden' : 'visible',
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
                  {s.group.name}
                </Typography>
                {s.group.from && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', ml: 'auto' }}>
                    <CableIcon sx={{ fontSize: 14 }} />
                    <Typography sx={{ fontSize: 12 }}>re-cable from {s.group.from}</Typography>
                  </Box>
                )}
              </Box>
            )}

            <Box
              sx={{
                bgcolor: 'background.paper',
                border: 1, borderColor: 'divider',
                borderTopWidth: first || dragging ? 1 : 0,
                borderBottomWidth: last || dragging ? 1 : 0,
                borderRadius: radius,
                overflow: 'hidden',
                // Lifted while dragged: a shadow and a touch larger, as a
                // card picked up off the table.
                transform: dragging ? 'scale(1.015)' : 'none',
                boxShadow: dragging ? '0 12px 32px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.08)' : 'none',
                transition: 'box-shadow 200ms, transform 200ms',
              }}
            >
              <Box
                onContextMenu={(e) => {
                  if (running) return
                  e.preventDefault()
                  setMenu({ uid: s.uid, x: e.clientX, y: e.clientY })
                }}
                sx={{
                  position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', gap: 1.25,
                  pl: 0.5, pr: 1,
                  // The step added last is selected, as a new item is in a
                  // Finder window: an accent flash as it lands that settles
                  // into a soft tint, until it is opened or another is added.
                  // Not on hover: passing over a row is not looking at it.
                  bgcolor: isOpen ? 'action.hover' : s.uid === arrived ? alpha(palette.sidebar.accent, 0.07) : undefined,
                  animation: s.uid === arrived ? `${flash(alpha(palette.sidebar.accent, 0.24), alpha(palette.sidebar.accent, 0.07))} 1400ms ease-out` : undefined,
                  [REDUCED_MOTION]: { animation: 'none' },
                  transition: 'background-color 150ms',
                  // The separator starts where the text does, not at the
                  // edge: the number circles read as one column.
                  '&::before': first || dragging ? undefined : {
                    content: '""', position: 'absolute', top: 0, left: 68, right: 0,
                    borderTop: 1, borderColor: 'divider',
                  },
                  // The handle is there when the pointer is: at rest the row
                  // leads with its number, not with a grip.
                  '& .row-handle': { opacity: 0.3, transition: 'opacity 150ms' },
                  '&:hover .row-handle, & .row-handle:focus-visible': { opacity: 1 },
                  '@media (hover: none)': { '& .row-handle': { opacity: 1 } },
                  // Duplicate and Delete take the status's place while the
                  // pointer is on the row (or focus is in them): one cross-
                  // fade in a fixed slot, out quicker than in.
                  '& .row-status': { transition: 'opacity 100ms ease-out' },
                  '& .row-keys': { opacity: 0, pointerEvents: 'none', transition: 'opacity 160ms ease-out 60ms' },
                  ...(running ? {} : {
                    '@media (hover: hover)': {
                      '&:hover .row-keys': { opacity: 1, pointerEvents: 'auto' },
                      '&:hover .row-status': { opacity: 0 },
                    },
                    '&:has(.row-keys:focus-within) .row-keys': { opacity: 1, pointerEvents: 'auto' },
                    '&:has(.row-keys:focus-within) .row-status': { opacity: 0 },
                  }),
                }}
              >
                <Tooltip title={running ? '' : 'Drag to reorder, or ↑ ↓'} enterDelay={600}>
                  <IconButton
                    className="row-handle"
                    size="small"
                    aria-label={`Move step ${i + 1}`}
                    ref={(el) => { handles.current.set(s.uid, el) }}
                    disabled={running}
                    onPointerDown={(e) => onPointerDown(e, s.uid, i)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={(e) => onHandleKey(e, s.uid, i)}
                    sx={{
                      width: 22, color: 'text.secondary', flexShrink: 0,
                      cursor: running ? 'default' : dragging ? 'grabbing' : 'grab', touchAction: 'none',
                    }}
                  >
                    <DragIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>

                {/* The step's number on its protocol's colour. */}
                <Box
                  sx={{
                    width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                    bgcolor: alpha(s.color, s.enabled ? 0.14 : 0.06),
                    color: s.enabled ? s.color : 'text.disabled',
                    fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {i + 1}
                </Box>

                {/* The step: the whole of it opens the step, as a list row does. */}
                <Box
                  role="button"
                  tabIndex={canOpen ? 0 : -1}
                  aria-expanded={isOpen}
                  aria-label={`Edit step ${i + 1}`}
                  onClick={toggle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); return }
                    if (running) return
                    // Delete removes the focused step, as in a Finder list;
                    // Undo brings it back.
                    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(s.uid) }
                  }}
                  sx={{
                    flexGrow: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', cursor: canOpen ? 'pointer' : 'default', borderRadius: '6px', opacity: dim,
                    '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, lineHeight: '19px', letterSpacing: '-0.01em' }}>
                      {s.title}
                    </Typography>
                    {s.testLabel && (
                      <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }}>
                        {s.testLabel}
                      </Typography>
                    )}
                    {/* The step added last, until it is opened or another is
                        added: a dot after its name, as a new item is marked. */}
                    {s.uid === arrived && (
                      <Box
                        role="img"
                        aria-label="New"
                        sx={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: palette.sidebar.accent,
                          animation: `${fadeIn} 240ms ease-out`,
                        }}
                      />
                    )}

                  </Box>
                  <Typography
                    noWrap
                    title={s.problem ?? s.summary}
                    sx={{ fontSize: 12.5, lineHeight: '17px', color: s.problem && s.enabled ? 'warning.main' : 'text.secondary' }}
                  >
                    {s.problem ?? s.summary}
                    {!s.problem && (
                      <Box component="span" sx={{ color: 'text.disabled' }}>
                        {'  ·  '}{s.points} point{s.points === 1 ? '' : 's'} · ≈ {formatDuration(s.estimateMs)}
                      </Box>
                    )}
                  </Typography>
                </Box>

                {/* The status, or on hover what can be done to the step: one
                    fixed slot, so neither moves anything. */}
                <Box sx={{ position: 'relative', width: STATUS_W, alignSelf: 'stretch', flexShrink: 0 }}>
                  <Box className="row-status" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <StatusCapsule s={s} palette={palette} onClick={s.outcome || s.live ? toggle : undefined} />
                  </Box>
                  <Box className="row-keys" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.25 }}>
                    <Tooltip title="Duplicate">
                      <IconButton size="small" aria-label={`Duplicate step ${i + 1}`} disabled={running} onClick={() => onDuplicate(s.uid)}>
                        <CopyIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        aria-label={`Delete step ${i + 1}`}
                        disabled={running}
                        onClick={() => onRemove(s.uid)}
                        sx={{ '&:hover': { color: 'error.main' } }}
                      >
                        <DeleteIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Tooltip title={s.enabled ? 'In the run' : 'Skipped'} enterDelay={600}>
                  <Switch
                    size="small"
                    checked={s.enabled}
                    disabled={running}
                    onChange={(e) => onToggle(s.uid, e.target.checked)}
                    slotProps={{ input: { 'aria-label': `Run step ${i + 1}` } }}
                  />
                </Tooltip>

                {/* The disclosure, at the row's end as in a Mac or iOS list. */}
                <IconButton
                  size="small"
                  aria-label={isOpen ? `Close step ${i + 1}` : `Open step ${i + 1}`}
                  disabled={!canOpen}
                  onClick={toggle}
                  sx={{ color: 'text.secondary', flexShrink: 0 }}
                >
                  <ChevronIcon
                    sx={{
                      fontSize: 20,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: `transform 220ms ${EASE}`, [REDUCED_MOTION]: { transition: 'none' },
                    }}
                  />
                </IconButton>
              </Box>

              <Collapse in={isOpen} unmountOnExit timeout={{ enter: 260, exit: 200 }} easing={EASE}>
                {/* White, like the row: the editor's fields are filled grey
                    and need a light ground to stand out from. */}
                <Box sx={{ px: 2.5, pt: 1.5, pb: 2, borderTop: 1, borderColor: 'divider' }}>
                  {isOpen && detail}
                </Box>
              </Collapse>
            </Box>
          </Box>
        )
      })}

      {/* A step's right-click menu, opened at the pointer, as a Mac list's
          is. The same two actions are in the open step's Name & test tab. */}
      <Menu
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        open={!!menu}
        onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 160, borderRadius: '10px' } } }}
      >
        <MenuItem onClick={() => { if (menu) onDuplicate(menu.uid); setMenu(null) }}>
          <ListItemIcon><CopyIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { if (menu) onRemove(menu.uid); setMenu(null) }} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteIcon sx={{ fontSize: 18, color: 'error.main' }} /></ListItemIcon>
          <ListItemText>Remove</ListItemText>
        </MenuItem>
      </Menu>

      {/* The gap the rows part to make for a test from the library. */}
      {dropAt && n > 0 && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute', left: 8, right: 8, top: dropAt.y + 6, height: ROW_H - 12,
            borderRadius: '8px', border: 1.5, borderStyle: 'dashed', borderColor: 'primary.main',
            bgcolor: 'action.hover', pointerEvents: 'none', zIndex: 0,
            transition: `top 280ms ${EASE}`, [REDUCED_MOTION]: { transition: 'none' },
          }}
        />
      )}
    </Box>
  )
}

/**
 * A step's status as a capsule: tinted, the word in the colour, as a system
 * status reads -- quiet before a run, coloured by the verdict after. Colour
 * is never the only carrier: the word is always there.
 */
function StatusCapsule({ s, palette, onClick }: {
  s: StepView
  palette: ReturnType<typeof useAppPalette>
  /** Opens the step on its results, once it has some -- during a run too. */
  onClick?: () => void
}) {
  let color: string
  let text: string
  if (!s.enabled) { color = palette.sidebar.textDim; text = 'Skipped' }
  else if (s.live) { color = palette.sidebar.accent; text = `${s.live.done} of ${s.live.total}` }
  else if (s.outcome) {
    const v = s.outcome.verdict
    color = v === 'pass' ? palette.data.ok : v === 'fail' || v === 'error' ? palette.data.bad
      : v === 'stopped' ? palette.data.warn : palette.sidebar.textDim
    text = resultText(s.outcome)
  } else if (s.problem) { color = palette.data.warn; text = 'Check settings' }
  else { color = palette.sidebar.textDim; text = 'Ready' }
  return (
    <Box
      component={onClick ? 'button' : 'span'}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={onClick ? `${text} — see the points` : text}
      aria-label={onClick ? `${text}: see the points` : undefined}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.625, height: 24, px: 1.25, maxWidth: '100%',
        border: 0, font: 'inherit', borderRadius: '12px', bgcolor: alpha(color, 0.12), color,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 200ms, color 200ms, transform 100ms ease-out',
        '&:hover': onClick ? { bgcolor: alpha(color, 0.2) } : undefined,
        // Gives under the pointer, as a key does.
        '&:active': onClick ? { transform: 'scale(0.96)' } : undefined,
        [REDUCED_MOTION]: { '&:active': { transform: 'none' } },
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      {s.live && <CircularProgress size={10} thickness={6} sx={{ color }} />}
      <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </Typography>
    </Box>
  )
}
