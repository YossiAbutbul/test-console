import {
  Box, Button, Chip, CircularProgress, Divider, Stack, Tabs, Tooltip,
  Typography, type ButtonProps, type TabsProps,
} from '@mui/material'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import PowerIcon from '@mui/icons-material/Power'
import StopIcon from '@mui/icons-material/Stop'
import type { CommandResponse } from '../types/models'
import { useAppPalette } from '../context/ThemeModeContext'
import { Section } from './Section'
import { useDutGated } from './gate'
import { HazardGlyph } from './HazardGlyph'
import { hazardRingSx, type HazardKind } from './hazardStyle'
import { ACTION_W, CONTROL_H, MONO, TEXT } from './tokens'

/** Shared sizing for every header action, so button rows line up page to
 *  page. A fixed width (see ACTION_W): the label may change, the box may not.
 *  A label that would still not fit is cut with an ellipsis, never allowed to
 *  widen the key. */
const actionSx = (width: number) => ({
  width, minWidth: width, height: CONTROL_H.md, flexShrink: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
} as const)

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
      sx={actionSx(ACTION_W.wide)}
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
  /**
   * What is stopping the run, in a word or two ("DUT", "RF path"). Shown on
   * the button itself, so a greyed-out Run says why. The page's DUT gate
   * fills this in on its own.
   */
  blockedBy?: string
  /** What Run does to the bench; drawn as the key's glyph and ring. Every
   *  run on this rig transmits, so `tx` unless a page says otherwise. */
  hazard?: HazardKind
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
  onRun, onStop, children, blockedBy, hazard = 'tx',
}: RunControlsProps) {
  const gated = useDutGated()
  const blocker = gated ? 'DUT' : (!canRun && !running ? blockedBy : undefined)
  // The key keeps its width, so a blocker too long for it is named in the
  // tooltip and on the page's check course rather than squeezed onto it.
  const blockedLabel = blocker && blocker.length <= 11 ? `Needs ${blocker}` : 'Not ready'
  const primary = (
    <Button
      variant="contained"
      startIcon={
        starting
          ? <CircularProgress size={14} color="inherit" />
          : <HazardGlyph kind={hazard} />
      }
      disabled={running || starting || !canRun || gated}
      onClick={onRun}
      sx={[actionSx(ACTION_W.run), hazardRingSx(hazard)]}
    >
      {running && progress ? `Running ${progress}` : blocker ? blockedLabel : runLabel}
    </Button>
  )
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {children}
      <Button
        variant="outlined"
        startIcon={<StopIcon />}
        disabled={!running || stopping}
        onClick={onStop}
        sx={actionSx(ACTION_W.default)}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
      {blocker ? (
        <Tooltip title={`${runLabel} is blocked until the ${blocker} step is done`}>
          <span>{primary}</span>
        </Tooltip>
      ) : primary}
    </Stack>
  )
}

interface EmergencyStopProps {
  /** Issues every halt the page can perform. Must not throw. */
  onStop: () => void
  /** Shows a spinner in place of the icon. Never blocks the click. */
  busy?: boolean
  /** Accessible name and tooltip. */
  title?: string
}

/**
 * Always-live emergency halt for the page header, sitting to the left of the
 * Run/Stop pair behind a divider.
 *
 * In the header rather than floating over the page: `PageHeader` lives outside
 * the scrolling `PageBody`, so this is permanently on screen without covering
 * any content and without costing layout space. The divider, the red fill and
 * the "E-STOP" label keep it from reading as a third ordinary button, and the
 * divider puts a gap between it and Run so neither is easy to hit by accident.
 *
 * Sized to `CONTROL_H.md` — the same height as every other header action — so
 * it sits on the shared baseline instead of standing proud of the row.
 *
 * Deliberately never disabled. The motor can be travelling from a jog with no
 * run in progress, which is exactly when a runaway is most likely, so gating
 * this on `running` would hide it at the moment it is needed. Repeat presses
 * are harmless and expected.
 */
export function EmergencyStop({
  onStop, busy, title = 'Emergency stop',
}: EmergencyStopProps) {
  const p = useAppPalette()
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      {/* A labelled key, not an icon in a red disc: under stress the
          operator reads "E-STOP", and two square stop glyphs a divider apart
          (this and the ordinary Stop) were the one thing on the page that
          could be confused. Wider than Stop and filled, so it is also the
          easiest of the two to hit. */}
      <Tooltip title={`${title}: stops the motor, then the run, then the transmitter`} placement="bottom">
        <Button
          aria-label={title}
          variant="contained"
          disableElevation
          onClick={onStop}
          startIcon={busy
            ? <CircularProgress size={16} color="inherit" />
            : <StopIcon sx={{ fontSize: 20 }} />}
          sx={{
            ...actionSx(112),
            bgcolor: 'error.main',
            color: p.actions.danger.fg,
            fontWeight: 800,
            letterSpacing: 0.6,
            boxShadow: (t) => `inset 0 0 0 2px ${t.palette.error.dark}`,
            '&:hover': { bgcolor: 'error.dark' },
          }}
        >
          E-STOP
        </Button>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
    </Stack>
  )
}

interface SendStopControlsProps {
  busy: boolean
  sending: boolean
  stopping: boolean
  canSend?: boolean
  /**
   * Whether stopping is possible at all.
   *
   * Defaults to true, because on most pages the DUT can always be told to
   * stop. Pass false only where there is genuinely nothing to stop — an LTE
   * modem that is powered down cannot be running a test — and make sure some
   * other control can still cut transmission, since this hides the obvious one.
   */
  canStop?: boolean
  onSend: () => void
  onStop: () => void
}

/** Send/Stop pair for the one-shot DUT command pages (Power, Debug, Modulated). */
export function SendStopControls({
  busy, sending, stopping, canSend = true, canStop = true, onSend, onStop,
}: SendStopControlsProps) {
  const gated = useDutGated()
  const send = (
    <Button
      variant="contained"
      startIcon={<HazardGlyph kind="tx" />}
      disabled={busy || !canSend || gated}
      onClick={onSend}
      sx={[actionSx(ACTION_W.default), hazardRingSx('tx')]}
    >
      {sending ? 'Sending…' : gated ? 'Needs DUT' : 'Send'}
    </Button>
  )
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="outlined"
        disabled={busy || !canStop}
        onClick={onStop}
        sx={actionSx(ACTION_W.default)}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
      {gated ? (
        <Tooltip title="Send is blocked until the DUT step is done">
          <span>{send}</span>
        </Tooltip>
      ) : send}
    </Stack>
  )
}

/**
 * Global path-loss reminder.
 *
 * The value is set once, in the top bar, and applied by every page that
 * reports DUT power.
 */
export function PathLossChip({
  pathLossDb, calibrated = true, freqMhz,
}: {
  pathLossDb: number
  /** False when no table entry matched and this is the default. */
  calibrated?: boolean
  /** The frequency the figure was looked up for, named in the warning. */
  freqMhz?: number
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {/* Outlined, never filled: amber is a lamp in this palette, not a
          surface (DESIGN.md, the Annunciator Rule). The filled chip was the
          loudest thing on Mode Sweep for a figure that does not block. */}
      <Chip
        size="small"
        variant="outlined"
        color={calibrated ? 'default' : 'warning'}
        icon={calibrated ? undefined : <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />}
        label={`Path loss: ${pathLossDb} dB`}
        sx={{ ...TEXT.hint, fontWeight: 600 }}
      />
      {/* Only when it matters: a calibrated figure needs no caption, and the
          long "sensor reading + path loss = DUT power" line on every page was
          more explanation than the operator wanted. */}
      {!calibrated && (
        <Typography sx={{ ...TEXT.hint, color: 'warning.main' }}>
          {`not calibrated${freqMhz != null ? ` at ${freqMhz} MHz` : ''}, using the default`}
        </Typography>
      )}
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
                fontSize: 12, fontWeight: 600,
                color: result.ok ? p.data.ok : p.data.bad,
                textTransform: 'none', letterSpacing: 0,
              }}
            >
              {result.ok ? 'ok' : 'failed'}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
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

/**
 * Small text button for a panel heading's secondary actions ("Add", "Apply",
 * "Store as VNA"). 24px tall so it sits inside a Section header row without
 * pushing it taller than the title.
 *
 * Pass an icon through `startIcon` at fontSize 15 to match the others.
 */
export function MiniAction({ sx, ...rest }: ButtonProps) {
  return (
    <Button
      size="small"
      variant="text"
      {...rest}
      sx={[{ minWidth: 0, height: 24, fontSize: 12, px: 1 }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  )
}

const DENSE_TABS = {
  /** A page's own sub-tabs, under the header. */
  md: { h: 36, fontSize: 13, tab: { py: 0.25 } },
  /** A view switch inside a panel heading. */
  sm: { h: 28, fontSize: 12, tab: { py: 0, px: 1.25 } },
} as const

/**
 * MUI Tabs at the app's density. The default 48px is a touch-screen size and
 * makes a sub-tab row as tall as the page header above it.
 *
 * Placement (a bottom border, a nudge up) stays with the caller via `sx`.
 */
export function DenseTabs({ size = 'md', sx, ...rest }: TabsProps & { size?: 'md' | 'sm' }) {
  const d = DENSE_TABS[size]
  return (
    <Tabs
      {...rest}
      sx={[
        { minHeight: d.h, '& .MuiTab-root': { minHeight: d.h, fontSize: d.fontSize, ...d.tab } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  )
}
