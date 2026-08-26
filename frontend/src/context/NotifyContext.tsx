/**
 * App-wide notifications.
 *
 *   const notify = useNotify()
 *   notify.success('Automation finished')
 *   notify.error('Connect failed', { title: 'DC analyzer' })
 *
 * Design: top-right stack, flat surface bg, severity-colored icon, no
 * coloring on the body. Quick fade in/out (100 ms). Info/success self-clear
 * after 6 s; warning/error are sticky until the user closes them.
 */
import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, Fade, IconButton, Stack, Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import WarningRoundedIcon from '@mui/icons-material/WarningRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import CloseIcon from '@mui/icons-material/Close'
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

let nextId = 1

function Toast({ entry, onClose }: { entry: ToastEntry; onClose: () => void }) {
  const Icon = ICONS[entry.severity]
  const color = iconColor(useAppPalette())[entry.severity]
  return (
    <Fade in timeout={100} appear>
      <Box
        role="status"
        sx={{
          position: 'relative',
          minWidth: 280,
          maxWidth: 420,
          borderRadius: 1.5,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
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
          <IconButton size="small" onClick={onClose} sx={{ mt: -0.25, mr: -0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        {/* Countdown bar: only for auto-dismiss toasts. Width shrinks from
            100% to 0% over the toast's autoHideMs lifetime so the user can
            see how long is left before it disappears. */}
        {entry.autoHideMs != null && (
          <Box
            sx={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: 2,
              bgcolor: color,
              transformOrigin: 'left center',
              animation: `notify-shrink-${entry.id} ${entry.autoHideMs}ms linear forwards`,
              [`@keyframes notify-shrink-${entry.id}`]: {
                from: { transform: 'scaleX(1)' },
                to: { transform: 'scaleX(0)' },
              },
            }}
          />
        )}
      </Box>
    </Fade>
  )
}

function CompletionModal({ entry, onClose }: { entry: CompleteOptions; onClose: () => void }) {
  const severity = entry.severity ?? 'success'
  const Icon = ICONS[severity]
  const color = iconColor(useAppPalette())[severity]
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
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
        <Button variant="contained" onClick={onClose} sx={{ minWidth: 140, height: 38 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const [completion, setCompletion] = useState<CompleteOptions | null>(null)

  const dismiss = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id))
  }, [])

  const notice = useCallback<NotifyApi['notice']>((key, severity, message, title) => {
    setToasts((arr) => {
      const without = arr.filter((t) => t.noticeKey !== key)
      if (message == null) return without
      const existing = arr.find((t) => t.noticeKey === key)
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
    setToasts((arr) => [...arr, t])
    if (ms != null) {
      window.setTimeout(() => dismiss(id), ms)
    }
  }, [dismiss])

  const api = useMemo<NotifyApi>(() => ({
    notify,
    notice,
    success: (m, o) => notify('success', m, o),
    info: (m, o) => notify('info', m, o),
    warning: (m, o) => notify('warning', m, o),
    error: (m, o) => notify('error', m, o),
    complete: (opts) => setCompletion(opts),
  }), [notify, notice])

  return (
    <NotifyCtx.Provider value={api}>
      {children}
      <Stack
        spacing={1}
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
          <Toast key={t.id} entry={t} onClose={() => dismiss(t.id)} />
        ))}
      </Stack>
      {completion && (
        <CompletionModal entry={completion} onClose={() => setCompletion(null)} />
      )}
    </NotifyCtx.Provider>
  )
}

export function useNotify(): NotifyApi {
  const v = useContext(NotifyCtx)
  if (!v) throw new Error('useNotify must be inside NotifyProvider')
  return v
}
