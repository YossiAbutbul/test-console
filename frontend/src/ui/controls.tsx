import {
  Box, Button, CircularProgress, Divider, Stack, Tabs, Tooltip,
  Typography, type ButtonProps, type TabsProps,
} from '@mui/material'
import { alpha, type Theme } from '@mui/material/styles'
import PowerRoundedIcon from '@mui/icons-material/PowerRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import type { CommandResponse } from '../types/models'
import { useAppPalette } from '../context/ThemeModeContext'
import { Section } from './Section'
import { useDutGated } from './gate'
import { HazardGlyph } from './HazardGlyph'
import { hazardRingSx, type HazardKind } from './hazardStyle'
import { actionSx } from './actionSx'
import { ACTION_W, CONTROL_H, MONO, TEXT } from './tokens'


interface ConnectButtonProps {
  connected: boolean
  /** True while the connect/disconnect request is in flight. */
  pending: boolean
  disabled?: boolean
  onConnect: () => void
  onDisconnect: () => void
}

/** The in-place progress mark every key shows while its request is in
 *  flight: a spinner in the icon slot, the label left as it was. Swapping the
 *  label ("…", "Sending…") made a key's words flicker on sub-second requests
 *  and, on the keys without a fixed width, changed its size. */
export function KeySpinner() {
  return <CircularProgress size={14} color="inherit" />
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
      startIcon={pending ? <KeySpinner /> : <PowerRoundedIcon />}
      onClick={() => (connected ? onDisconnect() : onConnect())}
      disabled={disabled || pending}
      sx={actionSx(ACTION_W.wide)}
    >
      {connected ? 'Disconnect' : 'Connect'}
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
        startIcon={stopping ? <KeySpinner /> : <StopRoundedIcon />}
        disabled={!running || stopping}
        onClick={onStop}
        sx={actionSx(ACTION_W.default)}
      >
        Stop
      </Button>
      {/* A tooltip only when the key cannot name its blocker itself: on a
          plain "Needs DUT" it made a disabled key answer the pointer, which
          read as one that could be pressed. */}
      {blocker && blockedLabel === 'Not ready' ? (
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
 * any content and without costing layout space. The divider, the red tint and
 * the "E-Stop" label keep it from reading as a third ordinary button, and the
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
          operator reads "E-Stop", and two square stop glyphs a divider apart
          (this and the ordinary Stop) were the one thing on the page that
          could be confused. Wider than Stop and red, so it is also the
          easiest of the two to hit. */}
      <Tooltip title="Stops motor, run and RF" placement="bottom">
        <Button
          aria-label={title}
          variant="contained"
          disableElevation
          onClick={onStop}
          startIcon={busy
            ? <CircularProgress size={16} color="inherit" />
            : <StopRoundedIcon sx={{ fontSize: 18 }} />}
          // A tinted destructive key, as macOS draws one: red ink on a red
          // wash, the palette's `disconnect` pair. It was a solid red slab in
          // 800-weight spaced capitals with an inner ring -- the loudest thing
          // on every Load Pull screen while nothing was wrong. Still the only
          // red key in the toolbar, with its glyph and its divider, so it is
          // found at once when it is needed; the press darkens the wash.
          sx={{
            ...actionSx(112),
            bgcolor: p.actions.disconnect.bg,
            color: p.actions.disconnect.fg,
            fontWeight: 600,
            '&:hover': { bgcolor: p.actions.disconnect.bgHover },
            '&:active': { bgcolor: alpha(p.actions.disconnect.fg, 0.22) },
          }}
        >
          E-Stop
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
  /** Why Send is disabled when `canSend` is false ("PA duty cycle and HP max
   *  must be 1–7"), shown on hover. A grey key that said nothing left the
   *  operator to find the bad field. */
  sendDisabledReason?: string
  onSend: () => void
  onStop: () => void
}

/** Send/Stop pair for the one-shot DUT command pages (Power, Debug, Modulated).
 *
 *  The same footprint as RunControls -- Stop 120 with its glyph, the primary
 *  176 -- because the two pairs share a toolbar slot on the pages with a
 *  Manual and an Automation tab. Send used to be 120, so switching tabs moved
 *  Stop 56 px and gave it an icon it did not have a moment before. */
export function SendStopControls({
  busy, sending, stopping, canSend = true, canStop = true, sendDisabledReason, onSend, onStop,
}: SendStopControlsProps) {
  const gated = useDutGated()
  const send = (
    <Button
      variant="contained"
      startIcon={sending ? <KeySpinner /> : <HazardGlyph kind="tx" />}
      disabled={busy || !canSend || gated}
      onClick={onSend}
      sx={[actionSx(ACTION_W.run), hazardRingSx('tx')]}
    >
      {gated ? 'Needs DUT' : 'Send'}
    </Button>
  )
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="outlined"
        startIcon={stopping ? <KeySpinner /> : <StopRoundedIcon />}
        // With no DUT there is nothing to stop, and a live Stop beside a
        // greyed "Needs DUT" read as the one key that still did something.
        // Once the DUT is up it is never held back by the gate, so the safe
        // way out stays available.
        disabled={busy || !canStop || gated}
        onClick={onStop}
        sx={actionSx(ACTION_W.default)}
      >
        Stop
      </Button>
      {/* No tooltip on "Needs DUT", which says it already (see RunControls);
          one only for a reason the key cannot show. */}
      {!gated && !canSend && sendDisabledReason ? (
        <Tooltip title={sendDisabledReason}>
          <span>{send}</span>
        </Tooltip>
      ) : send}
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
  // Collapsible from the start, folded, so the card is one heading tall before
  // the first Send and after it. It used to be a plain card with a two-line
  // hint that turned collapsible -- and 30 px shorter -- the moment a reply
  // arrived, moving everything under it.
  return (
    <Section
      title="Last frame"
      panel
      collapsible
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
                ...TEXT.hint, fontWeight: 600,
                color: result.ok ? p.data.ok : p.data.bad,
              }}
            >
              {result.ok ? 'ok' : 'failed'}
            </Typography>
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              status {result.status}
            </Typography>
          </Stack>
        ) : (
          <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>nothing sent yet</Typography>
        )
      }
    >
      {result ? (
        <FrameDump result={result} plain />
      ) : (
        <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
          Send a command to see the raw request and reply here.
        </Typography>
      )}
    </Section>
  )
}

/**
 * Small text button for a panel heading's secondary actions ("Add", "Graph",
 * "Export", "Clear"). `CONTROL_H.sm` tall, the one height for every control
 * in a Section heading, so a heading's field, segmented choice and actions
 * share a centre line. It sizes its own icon; callers pass the glyph only.
 *
 * `tone="destructive"` for the one that throws data away (Clear): quieter
 * ink rather than the accent, so it does not read as one more Export.
 */
export function MiniAction({ sx, tone, ...rest }: ButtonProps & { tone?: 'destructive' }) {
  return (
    <Button
      size="small"
      variant="text"
      {...rest}
      sx={[
        {
          minWidth: 0, height: CONTROL_H.sm, fontSize: 12.5, px: 1,
          '& .MuiButton-startIcon': { mr: 0.5 },
          '& .MuiButton-startIcon > svg, & .MuiButton-endIcon > svg': { fontSize: 16 },
        },
        tone === 'destructive' ? { color: 'text.secondary', '&:hover': { color: 'error.main' } } : {},
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  )
}

const DENSE_TABS = {
  /** A page's own sub-tabs, under the header. */
  md: { h: 32, fontSize: 13, px: 1.75 },
  /** A view switch inside a panel heading. */
  sm: { h: 28, fontSize: 12, px: 1.25 },
} as const

/**
 * MUI Tabs drawn as the macOS segmented control: a filled track with the
 * chosen tab raised out of it. An underline across the page read as a rule
 * dividing it, and a sub-tab row as tall as MUI's 48 px default was a band
 * as heavy as the header.
 *
 * One weight for every tab, chosen or not: tabs size to their labels, and a
 * label going bold on selection widened its tab and shifted the next one.
 * Placement (a nudge up) stays with the caller via `sx`.
 */
export function DenseTabs({ size = 'md', sx, ...rest }: TabsProps & { size?: 'md' | 'sm' }) {
  const d = DENSE_TABS[size]
  return (
    <Tabs
      {...rest}
      sx={[
        (t: Theme) => ({
          minHeight: d.h,
          display: 'inline-flex',
          alignSelf: 'flex-start',
          maxWidth: '100%',
          flexShrink: 0,
          p: '2px',
          borderRadius: '8px',
          bgcolor: alpha(t.palette.text.secondary, 0.14),
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { gap: '2px' },
          '& .MuiTab-root': {
            minHeight: d.h - 4,
            minWidth: 0,
            py: 0,
            px: d.px,
            fontSize: d.fontSize,
            fontWeight: 500,
            borderRadius: '6px',
            color: 'text.secondary',
            transition: 'background-color .15s ease, color .15s ease',
            '&:hover': { color: 'text.primary' },
          },
          '& .MuiTab-root.Mui-selected': {
            color: 'text.primary',
            // White out of a grey track in Light; on the dark grounds a raised
            // white would glare, so the tab is lifted by a translucent step.
            bgcolor: t.palette.mode === 'light' ? '#FFFFFF' : alpha(t.palette.text.primary, 0.16),
            boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)',
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  )
}
