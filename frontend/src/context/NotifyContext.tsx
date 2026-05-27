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
import { Box, Fade, IconButton, Stack, Typography } from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import WarningRoundedIcon from '@mui/icons-material/WarningRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import CloseIcon from '@mui/icons-material/Close'

export type NotifySeverity = 'success' | 'info' | 'warning' | 'error'

export interface NotifyOptions {
  title?: string
  /** Override the per-severity default. Pass `null` to make it sticky. */
  autoHideMs?: number | null
}

interface ToastEntry {
  id: number
  severity: NotifySeverity
  message: string
  title?: string
  autoHideMs: number | null
}

interface NotifyApi {
  notify: (severity: NotifySeverity, message: string, opts?: NotifyOptions) => void
  success: (message: string, opts?: NotifyOptions) => void
  info: (message: string, opts?: NotifyOptions) => void
  warning: (message: string, opts?: NotifyOptions) => void
  error: (message: string, opts?: NotifyOptions) => void
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

const ICON_COLOR: Record<NotifySeverity, string> = {
  success: '#16A34A',
  info: '#2563EB',
  warning: '#D97706',
  error: '#DC2626',
}

let nextId = 1

function Toast({ entry, onClose }: { entry: ToastEntry; onClose: () => void }) {
  const Icon = ICONS[entry.severity]
  const color = ICON_COLOR[entry.severity]
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

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id))
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
    success: (m, o) => notify('success', m, o),
    info: (m, o) => notify('info', m, o),
    warning: (m, o) => notify('warning', m, o),
    error: (m, o) => notify('error', m, o),
  }), [notify])

  return (
    <NotifyCtx.Provider value={api}>
      {children}
      <Stack
        spacing={1}
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: (t) => t.zIndex.snackbar + 1,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} entry={t} onClose={() => dismiss(t.id)} />
        ))}
      </Stack>
    </NotifyCtx.Provider>
  )
}

export function useNotify(): NotifyApi {
  const v = useContext(NotifyCtx)
  if (!v) throw new Error('useNotify must be inside NotifyProvider')
  return v
}
