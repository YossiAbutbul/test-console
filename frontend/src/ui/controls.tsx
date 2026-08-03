import { Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PowerIcon from '@mui/icons-material/Power'
import StopIcon from '@mui/icons-material/Stop'
import type { CommandResponse } from '../types/models'
import { useAppPalette } from '../context/ThemeModeContext'
import { Section } from './Section'
import { ACTION_W, CONTROL_H, MONO, TEXT } from './tokens'

/** Shared sizing for every header action, so button rows line up page to page. */
const actionSx = (minWidth: number) => ({ minWidth, height: CONTROL_H.md })

interface ConnectButtonProps {
  connected: boolean
  /** True while the connect/disconnect request is in flight. */
  pending: boolean
  disabled?: boolean
  onConnect: () => void
  onDisconnect: () => void
}

/**
 * Instrument connect/disconnect toggle.
 *
 * Trombone, Switch and Network Analyzer each had their own copy of this,
 * differing only in the disabled predicate.
 */
export function ConnectButton({
  connected, pending, disabled, onConnect, onDisconnect,
}: ConnectButtonProps) {
  return (
    <Button
      variant={connected ? 'outlined' : 'contained'}
      startIcon={<PowerIcon sx={{ fontSize: 16 }} />}
      onClick={() => (connected ? onDisconnect() : onConnect())}
      disabled={disabled || pending}
      sx={actionSx(ACTION_W.default)}
    >
      {pending ? '…' : connected ? 'Disconnect' : 'Connect'}
    </Button>
  )
}

interface RunControlsProps {
  running: boolean
  /** True between the click and the backend acknowledging the start. */
  starting?: boolean
  /** True between the stop click and the run actually ending. */
  stopping?: boolean
  /** Blocks Run — e.g. invalid inputs or a disconnected DUT. */
  canRun?: boolean
  /** Label on the primary button when idle. */
  runLabel?: string
  /** Progress shown on the primary button while running, e.g. "3/40". */
  progress?: string
  onRun: () => void
  onStop: () => void
  /** Extra buttons (Export, Clear) placed before Stop. */
  children?: React.ReactNode
}

/**
 * The Run/Stop pair every long-running test page puts in its header.
 *
 * Order is Stop then Run (destructive left, primary right, matching the
 * Send/Stop pairs on the one-shot pages) and the primary keeps a fixed width
 * so the header does not reflow when the label becomes a progress counter.
 */
export function RunControls({
  running, starting, stopping, canRun = true, runLabel = 'Run', progress,
  onRun, onStop, children,
}: RunControlsProps) {
  return (
    <Stack direction="row" spacing={1}>
      {children}
      <Button
        variant="outlined"
        startIcon={<StopIcon />}
        disabled={!running || stopping}
        onClick={onStop}
        sx={actionSx(ACTION_W.compact)}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
      <Button
        variant="contained"
        startIcon={
          starting
            ? <CircularProgress size={14} color="inherit" />
            : <PlayArrowIcon />
        }
        disabled={running || starting || !canRun}
        onClick={onRun}
        sx={actionSx(ACTION_W.wide)}
      >
        {running && progress ? `Running ${progress}` : runLabel}
      </Button>
    </Stack>
  )
}

interface SendStopControlsProps {
  busy: boolean
  sending: boolean
  stopping: boolean
  canSend?: boolean
  onSend: () => void
  onStop: () => void
}

/** Send/Stop pair for the one-shot DUT command pages (Power, Debug, Modulated). */
export function SendStopControls({
  busy, sending, stopping, canSend = true, onSend, onStop,
}: SendStopControlsProps) {
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="outlined"
        disabled={busy}
        onClick={onStop}
        sx={actionSx(ACTION_W.compact)}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
      <Button
        variant="contained"
        disabled={busy || !canSend}
        onClick={onSend}
        sx={actionSx(ACTION_W.compact)}
      >
        {sending ? 'Sending…' : 'Send'}
      </Button>
    </Stack>
  )
}

/**
 * Global path-loss reminder.
 *
 * The value is set once in the Connection panel and applied by every page that
 * reports DUT power, so the chip states where it came from.
 */
export function PathLossChip({ pathLossDb }: { pathLossDb: number }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Chip size="small" label={`Path loss: ${pathLossDb} dB`} sx={{ ...TEXT.hint, fontWeight: 600 }} />
      <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
        set globally in Connection panel · sensor reading + path loss = DUT power
      </Typography>
    </Stack>
  )
}

/** Raw request/response frame dump shown under the one-shot command pages.
 *  `plain` drops the border/padding so it can nest inside a Section card. */
export function FrameDump({ result, plain }: { result: CommandResponse; plain?: boolean }) {
  return (
    <Box
      sx={{
        fontFamily: MONO,
        ...TEXT.hint,
        lineHeight: 1.7,
        wordBreak: 'break-all',
        ...(plain
          ? null
          : { p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }),
      }}
    >
      <div>tx: {result.tx_hex}</div>
      <div>rx: {result.rx_hex}</div>
      <div>opcode: {result.reply_opcode_hex} payload: {result.reply_payload_hex}</div>
      <div>ok: {String(result.ok)} status: {result.status}</div>
    </Box>
  )
}

/**
 * The last command's wire detail, collapsed behind its outcome.
 *
 * Every one-shot command page ends with the same question — did the DUT accept
 * it? — and only occasionally with the follow-up of what exactly went over the
 * wire. So the ok/status rides on the heading and the hex stays folded away.
 */
export function LastFrameSection({ result }: { result: CommandResponse | null }) {
  const p = useAppPalette()
  return (
    <Section
      title="Last frame"
      panel
      collapsible={result != null}
      defaultOpen={false}
      action={
        result ? (
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Box
              sx={{
                width: 6, height: 6, borderRadius: '50%',
                bgcolor: result.ok ? p.data.ok : p.data.bad,
              }}
            />
            <Typography
              sx={{
                fontSize: 11.5, fontWeight: 600,
                color: result.ok ? p.data.ok : p.data.bad,
                textTransform: 'none', letterSpacing: 0,
              }}
            >
              {result.ok ? 'ok' : 'failed'}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
              status {result.status}
            </Typography>
          </Stack>
        ) : null
      }
    >
      {result ? (
        <FrameDump result={result} plain />
      ) : (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          Send a command to see the raw request and reply here.
        </Typography>
      )}
    </Section>
  )
}
