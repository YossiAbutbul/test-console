import { useState, type ReactNode } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Stack, Tooltip, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import { ConnectButton } from './controls'
import { StatusChip } from './Readout'
import { ACTION_W, CONTROL_H, MONO, PANEL_SX, TEXT } from './tokens'

export type InstrumentBarStatus = 'connected' | 'connecting' | 'error' | 'disconnected'

interface InstrumentBarProps {
  /** What the operator calls it, e.g. "DC analyzer". */
  name: string
  /** Make and model, e.g. "Keysight N6705B". */
  model: string
  status: InstrumentBarStatus
  /**
   * Replaces the plain Connected label while connected, for an instrument
   * whose live state is worth more than the link's — the trombone's Moving.
   */
  liveLabel?: string
  liveTone?: 'ok' | 'busy'
  /** Shown after the model: the IDN once connected. */
  detail?: string | null
  /**
   * The settings the next Connect will use, in one line — "COM4 · 9600 baud".
   * Shown so the operator can see what they are about to open without
   * opening the dialog, and so a blank address is visible before it fails.
   */
  summary?: string | null
  /** Body of the Config dialog. Omit when there is nothing to configure. */
  config?: ReactNode
  /** False blocks Connect and says so in the summary line: nothing chosen yet. */
  configReady?: boolean
  pending?: boolean
  /** Blocks both buttons, e.g. while a move is in flight. */
  disabled?: boolean
  onConnect: () => void
  onDisconnect: () => void
}

/**
 * The connection row at the top of every Components page.
 *
 * One layout for every instrument — status, name, the settings Connect will
 * use, Config, Connect — so the pages read alike whatever sits behind them:
 * VISA, a COM port, a vendor DLL. Connection settings live in a dialog rather
 * than inline, because they differ per instrument and are touched once per
 * session, while the row itself is looked at on every visit.
 *
 * The settings are only editable while disconnected: changing a port or
 * channel under an open session would describe a link that is already open.
 * The dialog still opens, read-only, so the operator can see what is in use.
 */
export function InstrumentBar({
  name, model, status, liveLabel, liveTone = 'ok', detail, summary, config,
  configReady = true, pending, disabled, onConnect, onDisconnect,
}: InstrumentBarProps) {
  const [open, setOpen] = useState(false)
  const connected = status === 'connected'

  const chip = connected
    ? { label: liveLabel ?? 'Connected', tone: liveTone }
    : status === 'connecting'
      ? { label: 'Connecting', tone: 'busy' as const }
      : status === 'error'
        ? { label: 'Error', tone: 'error' as const }
        : { label: 'Disconnected', tone: 'off' as const }

  const line = connected ? detail : summary

  return (
    <Box sx={{ ...PANEL_SX, px: 2, py: 1.25, mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
        <StatusChip
          label={chip.label}
          tone={chip.tone}
          spinning={status === 'connecting' || (connected && liveTone === 'busy')}
        />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography sx={{ ...TEXT.dense, fontWeight: 700, lineHeight: 1.3 }} noWrap>
            {name}
            <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1 }}>
              {model}
            </Box>
          </Typography>
          <Typography
            noWrap
            title={line ?? undefined}
            sx={{
              fontFamily: MONO, fontSize: 11.5, lineHeight: 1.3,
              color: !connected && !configReady ? 'warning.main' : 'text.secondary',
            }}
          >
            {line || (connected ? '' : 'not configured — open Config')}
          </Typography>
        </Box>
        {config && (
          <Tooltip title={connected ? 'Connection settings (disconnect to change)' : 'Connection settings'}>
            <span>
              <Button
                // Always the same grey button: the line beside it already says
                // "not configured", and Connect is disabled until it is.
                variant="outlined"
                color="inherit"
                startIcon={<TuneIcon sx={{ fontSize: 16 }} />}
                onClick={() => setOpen(true)}
                disabled={disabled}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md, borderColor: 'divider' }}
              >
                Config
              </Button>
            </span>
          </Tooltip>
        )}
        <ConnectButton
          connected={connected}
          pending={pending || status === 'connecting'}
          disabled={disabled || (!connected && !configReady)}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      </Stack>

      {config && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          maxWidth="xs"
          fullWidth
          slotProps={{ paper: { sx: { borderRadius: 2 } } }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{name}</Typography>
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>{model}</Typography>
            </Box>
            <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close">
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              {config}
              {connected && (
                <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                  Connected — disconnect to change these.
                </Typography>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Done</Button>
            {!connected && (
              <Button
                variant="contained"
                disabled={!configReady || pending || status === 'connecting'}
                onClick={() => { setOpen(false); onConnect() }}
              >
                Connect
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
