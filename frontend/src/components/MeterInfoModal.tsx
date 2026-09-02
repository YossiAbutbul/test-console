import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Select, Snackbar, Stack, Tooltip, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import { device } from '../api/device'
import { useConnection } from '../context/ConnectionContext'
import { useLog } from '../context/LogContext'
import type {
  AppModeOption, MeterInfoField, SaveResetResponse, SetAppModeResponse,
  SetChannelsResponse,
} from '../types/models'

interface Props {
  open: boolean
  onClose: () => void
}

/** What a field that came back `ok: false` should read as.
 *
 *  A non-zero status is the unit declining a query it understood, which the
 *  vendor dialog prints as "Not Supported". A transport failure is a different
 *  thing and says so, otherwise a dropped link looks like a missing feature. */
function failureText(f: MeterInfoField): string {
  if (f.error) return 'Unavailable'
  return 'Not Supported'
}

/** Pending choices, by row. Absent means "whatever the unit reported". */
interface Picked {
  mode?: number
  primary?: number
  secondary?: number
}

interface Notice {
  severity: 'success' | 'warning' | 'error'
  message: string
}

/** Fold one or two writes into a single message.
 *
 *  Update can send both the channels and the app mode, so the result is not
 *  one outcome but up to two, and they can disagree — channels accepted while
 *  the mode change went unanswered, say. The worst of the two sets the colour,
 *  because a success tint over a half-failed write is the wrong thing to see.
 *
 *  Each write has three outcomes, not two: unanswered is the expected shape
 *  when the unit saves and reboots, so it stays "unknown" rather than being
 *  dressed up as either result. */
function summarize(
  ch?: SetChannelsResponse, am?: SetAppModeResponse, reset?: SaveResetResponse,
): Notice {
  const parts: string[] = []
  let severity: Notice['severity'] = 'success'
  const worsen = (s: Notice['severity']) => {
    if (s === 'error' || severity === 'error') severity = 'error'
    else if (s === 'warning') severity = 'warning'
  }

  if (ch) {
    if (ch.ok) {
      // Same sentence the app-mode success uses. The channels only actually
      // take once save-and-reset lands, so the reset is not reported as a
      // step of its own -- it is what makes this message true.
      parts.push(`Channels set to ${ch.primary_label} + ${ch.secondary_label}.`)
      if (reset?.ok) parts.push('The unit saves and resets, so the link may drop and come back.')
    } else if (ch.acknowledged) {
      parts.push(`The unit refused the channel change (status ${ch.status}).`)
      worsen('error')
    } else {
      parts.push('Channels sent, but the unit did not reply.')
      worsen('warning')
    }
  }
  if (am) {
    if (am.ok) {
      parts.push(`App mode set to ${am.label}. The unit saves and resets, so the link may drop and come back.`)
    } else if (am.acknowledged) {
      parts.push(`The unit refused the app mode change (status ${am.status}).`)
      worsen('error')
    } else {
      parts.push(`App mode ${am.label} sent, but the unit did not reply — it may have reset while applying it.`)
      worsen('warning')
    }
  }
  // A reset that worked says nothing of its own — the channels line above
  // already carries it. Only a reset that did not happen earns a sentence,
  // because then the change silently will not persist.
  if (reset && !reset.ok) {
    if (reset.acknowledged) {
      parts.push(`Save and reset was refused (status ${reset.status}) — the channel change will not persist.`)
      worsen('error')
    } else {
      parts.push('Save and reset got no reply, so the channel change may not persist. Reconnect and re-read.')
      worsen('warning')
    }
  } else if (!reset && ch?.ok) {
    // Channels staged but never committed. Silence here would look like a
    // clean success and the unit would come back on the old channels.
    parts.push('Not saved — the change will be lost on the next reset.')
    worsen('warning')
  }

  if (!parts.length) parts.push('Nothing to send.')
  if (severity !== 'success' && !reset?.ok) parts.push('Reconnect and re-read to confirm.')
  return { severity, message: parts.join(' ') }
}

/** A labelled dropdown over one of the backend's option lists.
 *
 *  Option values are strings so the empty state has a type to sit in: '' means
 *  the unit's value is not known yet, and the row falls back to whatever the
 *  read reported (or why it could not be read). */
function Picker({ label, options, value, fallback, disabled, onChange }: {
  label: string
  options: AppModeOption[]
  value: number | null
  fallback: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
        {label}
      </Typography>
      <Select
        size="small"
        fullWidth
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled || !options.length}
        displayEmpty
        renderValue={(v) =>
          v === '' ? fallback : (options.find((o) => String(o.mode) === v)?.label ?? v)
        }
      >
        {options.map((o) => (
          <MenuItem key={o.mode} value={String(o.mode)}>{o.label}</MenuItem>
        ))}
      </Select>
    </Box>
  )
}

function Row({ label, value, mono, dim }: {
  label: string
  value: string
  mono?: boolean
  dim?: boolean
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 14.5,
          color: dim ? 'text.disabled' : 'text.primary',
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
            : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

export function MeterInfoModal({ open, onClose }: Props) {
  const { status } = useConnection()
  const { log } = useLog()
  const qc = useQueryClient()

  const q = useQuery({
    // Keyed by the connected unit, not just 'info'. React Query serves the
    // cached entry for a key while it refetches, so a single shared key means
    // swapping the DUT and reopening shows the *previous* unit's identity for
    // as long as the read takes -- values that look entirely plausible and are
    // for the wrong device. A per-address key has nothing to show instead.
    queryKey: ['device', 'info', status?.address ?? null],
    queryFn: ({ signal }) => device.info({ signal }),
    // Only while the dialog is up: this is a round trip to the DUT per field,
    // and none of it is worth spending link time on in the background.
    enabled: open,
    // Re-read on every open. These fields rarely change, but a stale answer
    // from a unit that has since been swapped or reflashed is worse than the
    // second it costs to ask again.
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const byKey = new Map((q.data?.fields ?? []).map((f) => [f.key, f]))
  const get = (key: string) => byKey.get(key)

  /** Decoded value, or the reason there isn't one. */
  const text = (key: string): { value: string; dim: boolean } => {
    const f = get(key)
    if (!f) return { value: '—', dim: true }
    if (!f.ok) return { value: failureText(f), dim: true }
    return { value: f.value ?? '—', dim: false }
  }

  // Two commands, one row -- the dialog shows the version triple with the
  // full build string after it. They are separate opcodes reporting separate
  // things, and on a development build they do not have to agree: `02 00` is
  // three integers, `04 00` is whatever string the build stamped in.
  const versionRow = (): { value: string; dim: boolean } => {
    const v = get('version')
    const fw = get('fw_version')
    if (v?.ok && fw?.ok) return { value: `${v.value}  (${fw.value})`, dim: false }
    if (v?.ok) return { value: v.value ?? '—', dim: false }
    if (fw?.ok) return { value: fw.value ?? '—', dim: false }
    return text('version')
  }

  const connectedName = status?.name ?? status?.address ?? '—'

  // --- editable settings --------------------------------------------------

  const modesQ = useQuery({
    queryKey: ['device', 'app-modes'],
    queryFn: () => device.appModes(),
    // A constant of the firmware, not of the unit — fetch it once.
    staleTime: Infinity,
  })
  const channelsQ = useQuery({
    queryKey: ['device', 'channel-options'],
    queryFn: () => device.channelOptions(),
    staleTime: Infinity,
  })
  const modes = modesQ.data?.modes ?? []
  const primaries = channelsQ.data?.primary ?? []
  const secondaries = channelsQ.data?.secondary ?? []

  // Matched by label rather than parsed out of the raw bytes: the backend owns
  // the names, so agreeing with it here keeps one source of truth.
  const valueOf = (opts: AppModeOption[], key: string) =>
    opts.find((o) => o.label === get(key)?.value)?.mode ?? null
  const currentMode = valueOf(modes, 'app_mode')
  const currentPrimary = valueOf(primaries, 'primary_channel')
  const currentSecondary = valueOf(secondaries, 'secondary_channel')

  // `picked` is only the operator's pending choices; each row falls back to
  // what the unit reported. Deliberately not synced with an effect — clearing
  // it after a write (and on close) lets the re-read win on its own.
  const [picked, setPicked] = useState<Picked>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const selMode = picked.mode ?? currentMode
  const selPrimary = picked.primary ?? currentPrimary
  const selSecondary = picked.secondary ?? currentSecondary

  const modeDirty = selMode != null && selMode !== currentMode
  const channelsDirty = selPrimary != null && selSecondary != null
    && (selPrimary !== currentPrimary || selSecondary !== currentSecondary)

  const update = useMutation({
    mutationFn: async () => {
      // Order matters, and everything that reboots the meter goes last.
      //
      // `4C 10` only stages the channels; save-and-reset is what makes them
      // stick, and it takes the BLE link down with it. So both writes go out
      // first, then the one reset at the end — reset in the middle would
      // drop the link before the second write ever landed.
      const channels = channelsDirty
        ? await device.setChannels(selPrimary, selSecondary)
        : undefined
      const appMode = modeDirty ? await device.setAppMode(selMode) : undefined
      // Only for channels. An app-mode change reboots on its own, and asking
      // a unit that is already going down to save and reset achieves nothing.
      const reset = channelsDirty && channels?.ok
        ? await device.saveReset()
        : undefined
      return { channels, appMode, reset }
    },
    onSuccess: ({ channels, appMode, reset }) => {
      const n = summarize(channels, appMode, reset)
      setNotice(n)
      setPicked({})
      log('DUT', n.message, n.severity === 'success' ? 'info' : 'error')
      // The link is down or about to be, so the cached read is worthless.
      // Dropped rather than refetched: re-reading a meter that is rebooting
      // just fills every row with "Unavailable".
      qc.removeQueries({ queryKey: ['device', 'info'] })
      qc.invalidateQueries({ queryKey: ['ble-status'] })
      // Closing for the same reason — there is nothing left to show until
      // the operator reconnects, and the toast outlives the dialog.
      if (reset?.ok || appMode?.ok) close()
    },
    onError: (e: Error) => {
      setNotice({ severity: 'error', message: e.message })
      log('DUT', `Meter write failed: ${e.message}`, 'error')
    },
  })

  const close = () => {
    setPicked({})
    onClose()
  }

  const canUpdate = (modeDirty || channelsDirty)
    && !update.isPending && !!status?.connected

  return (
    <>
    <Dialog
      open={open}
      onClose={close}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2 } } }}
    >
      <DialogTitle
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          py: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Meter Information</Typography>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Tooltip title="Re-read">
            <span>
              <IconButton size="small" onClick={() => q.refetch()} disabled={q.isFetching}>
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={close}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {q.isPending && (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 4 }}>
            <CircularProgress size={22} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Reading the unit...
            </Typography>
          </Stack>
        )}

        {q.isError && (
          <Alert severity="error" sx={{ my: 1 }}>
            {(q.error as Error).message}
          </Alert>
        )}


        {q.data && (
          <Stack spacing={2} sx={{ py: 1 }}>
            <Row label="Connected To" value={connectedName} />
            <Row label="Device ID" {...text('device_id')} mono />
            <Row label="FW Version" {...versionRow()} />
            <Row label="MAC Address" {...text('ble_mac')} mono />
            <Picker
              label="App Mode"
              options={modes}
              value={selMode}
              fallback={text('app_mode').value}
              disabled={update.isPending}
              onChange={(v) => setPicked((p) => ({ ...p, mode: v }))}
            />
            <Picker
              label="Primary Channel"
              options={primaries}
              value={selPrimary}
              fallback={text('primary_channel').value}
              disabled={update.isPending}
              onChange={(v) => setPicked((p) => ({ ...p, primary: v }))}
            />
            <Picker
              label="Secondary Channel"
              options={secondaries}
              value={selSecondary}
              fallback={text('secondary_channel').value}
              disabled={update.isPending}
              onChange={(v) => setPicked((p) => ({ ...p, secondary: v }))}
            />
            {/* No Alarms, Radio Mode or Radio Information: the vendor dialog
                shows them, this one does not. Their opcodes and decoders are
                still in device/info.py — only the query list dropped them. */}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {/* Disabled until something actually differs from what the unit
            reported. This writes to a live meter and can reboot it, so
            re-sending the settings it already has should not be one stray
            click away. Sends only the rows that changed. */}
        <Button
          variant="contained"
          disabled={!canUpdate}
          onClick={() => update.mutate()}
          endIcon={update.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ minWidth: 120 }}
        >
          {update.isPending ? 'Sending' : 'Update'}
        </Button>
      </DialogActions>
    </Dialog>

    {/* A toast rather than a banner inside the dialog. Anything in the dialog
        either resizes it as the message comes and goes -- moving the button
        out from under the pointer that just pressed it -- or needs a reserved
        slot that sits empty the rest of the time. This floats above both, so
        the dialog is sized by its content and never moves.

        It also outlives the dialog: closing on the back of an Update is the
        normal thing to do, and the result should not vanish with it. */}
    <Snackbar
      open={!!notice}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      // Success speaks for itself; the other two are asking the operator to go
      // and check something, so they stay up longer.
      autoHideDuration={notice?.severity === 'success' ? 6000 : 15000}
      onClose={(_, reason) => {
        // Not on clickaway: picking the next mode should not wipe the message.
        if (reason !== 'clickaway') setNotice(null)
      }}
    >
      {notice ? (
        <Alert
          severity={notice.severity}
          variant="filled"
          onClose={() => setNotice(null)}
          sx={{ maxWidth: 420 }}
        >
          {notice.message}
        </Alert>
      ) : undefined}
    </Snackbar>
    </>
  )
}
