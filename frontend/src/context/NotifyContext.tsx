/**
 * App-wide notifications.
 *
 *   const notify = useNotify()
 *   notify.success('Automation finished')
 *   notify.error('Connect failed', { title: 'DC analyzer' })
 *
 * Design: bottom-right stack (clear of the top bar and every page's
 * instrument bar), flat surface bg, severity-colored icon, no
 * coloring on the body. Quick fade in/out (100 ms), and the stack closes up
 * after a toast leaves rather than jumping. Info/success self-clear after 6 s
 * (paused while the pointer or focus is on the toast); warning/error are
 * sticky until the user closes them.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import {
  Box, Button, Collapse, Dialog, DialogActions, DialogContent, Fade, IconButton,
  Stack, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import WarningRoundedIcon from '@mui/icons-material/WarningRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import CloseIcon from '@mui/icons-material/CloseRounded'
import { useAppPalette } from './ThemeModeContext'
import type { AppPalette } from '../theme'

export type NotifySeverity = 'success' | 'info' | 'warning' | 'error'

export interface NotifyOptions {
  title?: string
  /** Override the per-severity default. Pass `null` to make it sticky. */
  autoHideMs?: number | null
}

export interface CompleteOptions {
  severity?: NotifySeverity
  title?: string
  message: string
}

interface ToastEntry {
  id: number
  severity: NotifySeverity
  message: string
  title?: string
  autoHideMs: number | null
  /**
   * Set for a *condition* rather than an event.
   *
   * A toast announces something that happened and then goes. A notice states
   * something that is still true — a precondition blocking the run, a table
   * showing an imported file — so it never fades, and re-stating the same key
   * replaces it instead of stacking another copy.
   */
  noticeKey?: string
  /** Set on dismissal: the toast plays its exit and is removed after it. */
  leaving?: boolean
}

interface NotifyApi {
  notify: (severity: NotifySeverity, message: string, opts?: NotifyOptions) => void
  /**
   * Show, replace, or clear a standing notice.
   *
   * Pass `null` as the message to clear. Never auto-hides: it is showing
   * because something is still the case, and it goes when that stops being
   * true or when the operator dismisses it.
   */
  notice: (key: string, severity: NotifySeverity, message: string | null, title?: string) => void
  success: (message: string, opts?: NotifyOptions) => void
  info: (message: string, opts?: NotifyOptions) => void
  warning: (message: string, opts?: NotifyOptions) => void
  error: (message: string, opts?: NotifyOptions) => void
  /** Centered completion modal — use for end-of-run automation outcomes. */
  complete: (opts: CompleteOptions) => void
}

const NotifyCtx = createContext<NotifyApi | null>(null)

// Routine outcomes self-dismiss; problems linger until acknowledged.
const DEFAULT_HIDE: Record<NotifySeverity, number | null> = {
  success: 6000,
  info: 6000,
  warning: null,
  error: null,
}

const ICONS: Record<NotifySeverity, typeof CheckCircleRoundedIcon> = {
  success: CheckCircleRoundedIcon,
  info: InfoRoundedIcon,
  warning: WarningRoundedIcon,
  error: ErrorRoundedIcon,
}

/**
 * Severity colours come from the active palette rather than being fixed, so a
 * toast, an inline notice and a failed cell in a results table are the same
 * colour on the same ground. Fixed values drifted from `data.*` as the modes
 * were retuned, which left a bright generic red floating over a slate page.
 */
function iconColor(p: AppPalette): Record<NotifySeverity, string> {
  return {
    success: p.data.ok,
    info: p.sidebar.accent,
    warning: p.data.warn,
    error: p.data.bad,
  }
}

/** Same lift as the theme's menus, popovers and dialogs (`floatShadow` in
 *  theme.ts, which is not exported) -- a toast floats like they do, so it
 *  casts the same shadow, with no border. Keep the two in step. */
function floatShadow(mode: 'light' | 'dark'): string {
  return mode === 'light'
    ? '0 12px 32px -6px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)'
    : '0 16px 40px -6px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.10)'
}

const FADE_MS = 100
const COLLAPSE_MS = 150

let nextId = 1

function Toast({ entry, onClose, onExited }: {
  entry: ToastEntry
  onClose: () => void
  onExited: () => void
}) {
  const Icon = ICONS[entry.severity]
  const color = iconColor(useAppPalette())[entry.severity]
  const mode = useTheme().palette.mode
  const leaving = !!entry.leaving

  // The auto-hide clock lives here so it can stop while someone is reading or
  // reaching for the toast -- otherwise it can vanish from under the pointer.
  // Remaining time carries over a pause; it does not start again.
  const [paused, setPaused] = useState(false)
  const remaining = useRef(entry.autoHideMs)
  useEffect(() => {
    if (remaining.current == null || paused || leaving) return
    const started = Date.now()
    const t = window.setTimeout(onClose, remaining.current)
    return () => {
      window.clearTimeout(t)
      if (remaining.current != null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started))
      }
    }
  }, [paused, leaving, onClose])

  return (
    // Collapse round the fade so the stack closes up smoothly when one goes.
    // The gap is padding inside it for the same reason: a Stack margin would
    // stay behind at full size and snap away at the end.
    <Collapse in={!leaving} appear={false} timeout={COLLAPSE_MS} onExited={onExited}>
      <Box sx={{ pt: 1 }}>
        <Fade in={!leaving} timeout={FADE_MS} appear>
          <Box
            // A problem is announced as it lands; a routine outcome waits its turn.
            role={entry.severity === 'error' || entry.severity === 'warning' ? 'alert' : 'status'}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
            }}
            sx={{
              position: 'relative',
              minWidth: 280,
              maxWidth: 420,
              borderRadius: 1.5,
              bgcolor: 'background.paper',
              border: 0,
              boxShadow: floatShadow(mode),
              pointerEvents: 'auto',
              overflow: 'hidden',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, px: 1.75, py: 1.25 }}>
              <Icon sx={{ fontSize: 20, color, flexShrink: 0, mt: 0.125 }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                {entry.title && (
                  <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: 'text.primary' }}>
                    {entry.title}
                  </Typography>
                )}
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {entry.message}
                </Typography>
              </Box>
              <IconButton size="small" aria-label="Dismiss" onClick={onClose} sx={{ mt: -0.25, mr: -0.5 }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
            {/* Countdown bar: only for auto-dismiss toasts. Width shrinks from
                100% to 0% over the toast's autoHideMs lifetime so the user can
                see how long is left before it disappears. Held while the toast
                is paused, so it keeps agreeing with the clock above. */}
            {entry.autoHideMs != null && (
              <Box
                sx={{
                  position: 'absolute', left: 0, right: 0, bottom: 0,
                  height: 2,
                  bgcolor: color,
                  transformOrigin: 'left center',
                  animation: `notify-shrink-${entry.id} ${entry.autoHideMs}ms linear forwards`,
                  animationPlayState: paused ? 'paused' : 'running',
                  [`@keyframes notify-shrink-${entry.id}`]: {
                    from: { transform: 'scaleX(1)' },
                    to: { transform: 'scaleX(0)' },
                  },
                }}
              />
            )}
          </Box>
        </Fade>
      </Box>
    </Collapse>
  )
}

/** Binds a toast's callbacks to its id once, so the Toast's auto-hide effect
 *  is not restarted (and its clock re-armed) by every render of the stack. */
function ToastSlot({ entry, dismiss, remove }: {
  entry: ToastEntry
  dismiss: (id: number) => void
  remove: (id: number) => void
}) {
  const { id } = entry
  const onClose = useCallback(() => dismiss(id), [dismiss, id])
  const onExited = useCallback(() => remove(id), [remove, id])
  return <Toast entry={entry} onClose={onClose} onExited={onExited} />
}

function CompletionModal({ entry, open, onClose }: {
  entry: CompleteOptions
  open: boolean
  onClose: () => void
}) {
  const severity = entry.severity ?? 'success'
  const Icon = ICONS[severity]
  const color = iconColor(useAppPalette())[severity]
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth>
      <DialogContent sx={{ pt: 4, pb: 2, textAlign: 'center' }}>
        <Box
          sx={{
            width: 64, height: 64, borderRadius: '50%',
            bgcolor: `${color}1A`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            mx: 'auto', mb: 2,
          }}
        >
          <Icon sx={{ fontSize: 38, color }} />
        </Box>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          {entry.title ?? 'Done'}
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', lineHeight: 1.5 }}>
          {entry.message}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', pb: 3, pt: 0 }}>
        <Button variant="contained" onClick={onClose} sx={{ minWidth: 140 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  // The last completion is kept after it is dismissed so the dialog can fade
  // out with its text in place; unmounting it on close cut it off mid-frame.
  const [completion, setCompletion] = useState<CompleteOptions | null>(null)
  const [completionOpen, setCompletionOpen] = useState(false)

  // Dismissal starts the exit; the toast is removed once that has played.
  const dismiss = useCallback((id: number) => {
    setToasts((arr) => arr.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
  }, [])
  const remove = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id))
  }, [])

  const notice = useCallback<NotifyApi['notice']>((key, severity, message, title) => {
    setToasts((arr) => {
      // Cleared: it leaves like any other toast rather than vanishing.
      if (message == null) {
        return arr.map((t) => (t.noticeKey === key ? { ...t, leaving: true } : t))
      }
      const without = arr.filter((t) => t.noticeKey !== key)
      const existing = arr.find((t) => t.noticeKey === key && !t.leaving)
      // Same text already up: leave it alone, or a re-render would restart its
      // entry animation on every parent update.
      if (existing && existing.message === message && existing.severity === severity) return arr
      return [...without, {
        id: nextId++, severity, message, title, autoHideMs: null, noticeKey: key,
      }]
    })
  }, [])

  const notify = useCallback<NotifyApi['notify']>((severity, message, opts) => {
    const id = nextId++
    const ms = opts?.autoHideMs === undefined ? DEFAULT_HIDE[severity] : opts.autoHideMs
    const t: ToastEntry = { id, severity, message, title: opts?.title, autoHideMs: ms }
    // The auto-hide timer runs in the Toast, so hovering it can pause it.
    setToasts((arr) => [...arr, t])
  }, [])

  const api = useMemo<NotifyApi>(() => ({
    notify,
    notice,
    success: (m, o) => notify('success', m, o),
    info: (m, o) => notify('info', m, o),
    warning: (m, o) => notify('warning', m, o),
    error: (m, o) => notify('error', m, o),
    complete: (opts) => { setCompletion(opts); setCompletionOpen(true) },
  }), [notify, notice])

  return (
    <NotifyCtx.Provider value={api}>
      {children}
      <Stack
        sx={{
          position: 'fixed',
          // Clears the global footer, which is fixed at bottom: 6 with a ~14px
          // line. At 16 the toasts sat on top of the copyright line — and a
          // notice, which stays until its condition ends, covered it for as
          // long as that took.
          bottom: 30,
          right: 16,
          // Below the modal layer, not above it. A completion dialog dims the
          // page precisely to say "this is the thing to read now"; a toast
          // sitting on top of that dimming — often the *start* notice for the
          // run the dialog is reporting the end of — contradicts it.
          //
          // Still above the app chrome: the log drawer and top progress bar
          // sit on the drawer layer, well under this.
          zIndex: (t) => t.zIndex.modal - 1,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastSlot key={t.id} entry={t} dismiss={dismiss} remove={remove} />
        ))}
      </Stack>
      {completion && (
        <CompletionModal
          entry={completion}
          open={completionOpen}
          onClose={() => setCompletionOpen(false)}
        />
      )}
    </NotifyCtx.Provider>
  )
}

export function useNotify(): NotifyApi {
  const v = useContext(NotifyCtx)
  if (!v) throw new Error('useNotify must be inside NotifyProvider')
  return v
}
