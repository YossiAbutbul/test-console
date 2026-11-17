import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Box, Button, IconButton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import FirstPageIcon from '@mui/icons-material/FirstPageRounded'
import LastPageIcon from '@mui/icons-material/LastPageRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded'
import NearMeIcon from '@mui/icons-material/NearMeRounded'
import { alpha } from '@mui/material/styles'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { JOG_SPEEDS, PULSES_PER_MM } from '../../lib/trombone'
import {
  EmergencyStop, JogPad, KeySpinner, MONO, ModalShell, SegmentedChoice, StatusChip, TEXT, hazardRingSx,
} from '../../ui'
import { findRange, isComplete, sameFreq, withRange, type FreqRange } from './tromboneRanges'

/** Same row height as the Load Pull page's trombone cards. */
const ROW_H = 32
/** "Capture" and "Recapture" share one width, so a capture moves nothing. */
const CAPTURE_W = 96
/** "Show" and "On VNA" share one width too. */
const VNA_W = 84
/** A Start / Stop column: the value, its go-to key and Capture. */
const END_COL_W = 196

const FORM_SX = {
  display: 'grid',
  gridTemplateColumns: '72px minmax(0, 1fr)',
  gridAutoRows: `${ROW_H}px`,
  columnGap: 1.5,
  rowGap: 1,
  alignItems: 'center',
} as const

/** Two equal halves of the control column. */
const PAIR_SX = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 1 } as const

const fmtMm = (p: number) => (p / PULSES_PER_MM).toFixed(2)

type End = 'startPulses' | 'stopPulses'
const ENDS: End[] = ['startPulses', 'stopPulses']

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ ...TEXT.label, color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {children}
    </Typography>
  )
}

export interface TromboneJogProps {
  connected: boolean
  moving: boolean
  position: number | null
  jogDir: number
  jogFocused: boolean
  onJogStart: (positive: boolean) => void
  onJogStop: () => void
  onJogKeyDown: (e: ReactKeyboardEvent) => void
  onJogKeyUp: (e: ReactKeyboardEvent) => void
  onJogFocusChange: (focused: boolean) => void
  jogSpeed: number
  onJogSpeed: (n: number) => void
}

/** The range of every frequency without one of its own. */
export interface DefaultRange {
  startPulses: number | null
  stopPulses: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  /** The test's frequencies, in plan order, with how to name each (an LTE
   *  channel carries its EARFCN). */
  freqs: Array<{ freqMhz: number; label: string }>
  ranges: FreqRange[]
  defaultRange: DefaultRange
  /** Called on every capture and clear: there is no draft to lose. */
  onChange: (ranges: FreqRange[], defaultRange: DefaultRange) => void
  trombone: TromboneJogProps
  /** A Load Pull run holds the rig: nothing here may move it. */
  locked: boolean
  /** The page's E-Stop: motor, run and RF. Repeated here so it is on the
   *  dialog that moves the motor, not only on the toolbar above it. */
  onEmergencyStop: () => void
  vna: VnaSpanProps
}

/** Putting the analyzer on a frequency's span and marker, as the page's VNA
 *  span Apply does, so a row's ends can be chosen watching its Smith chart. */
export interface VnaSpanProps {
  ready: boolean
  busy: boolean
  /** The frequency last put on the analyzer from this page, if any. */
  shownMhz: number | null
  /** The frequency being put on it now. */
  pendingMhz: number | null
  onShow: (freqMhz: number) => void
  /** "span 1 875.30-1 884.70 MHz", for the tooltip. */
  describe: (freqMhz: number) => string
}

/**
 * Where the trombone sweeps: one range for every frequency, and any
 * frequency's own in place of it.
 *
 * The same shape as the Path loss table -- a default and a row per
 * frequency -- with the trombone's controls on top, so each end is found by
 * moving the carriage and taken from where it actually is rather than typed.
 *
 * Every capture is saved as it is taken, one end alone included. It used to
 * be a draft kept only on Save, and closing the dialog after the first end
 * threw that end away; a one-sided range is kept now and Run waits for its
 * other end instead (the page's blockers). Every move is the operator's: a key press here, never a side
 * effect of opening, capturing or saving.
 */
export function TromboneRangesModal({
  open, onClose, freqs, ranges, defaultRange, onChange, trombone: t, locked, onEmergencyStop, vna,
}: Props) {
  const { log } = useLog()
  const notify = useNotify()
  const qc = useQueryClient()
  const draft = ranges
  const draftDefault = defaultRange

  const moveM = useMutation({
    mutationFn: (pos: number) => motor.move(pos, true),
    onSuccess: (_d, pos) => {
      log('Motor', `go to ${fmtMm(pos)} mm ok`)
      void qc.invalidateQueries({ queryKey: ['motor', 'status'] })
    },
    onError: (e: Error) => {
      log('Motor', `move failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Trombone move' })
    },
  })
  const canMove = t.connected && !locked && !moveM.isPending
  const goTo = (pulses: number) => { if (canMove) moveM.mutate(pulses) }

  /** `freqMhz` null: the All frequencies row. */
  const capture = (freqMhz: number | null, end: End) => {
    const pos = t.position
    if (pos == null) return
    if (freqMhz == null) onChange(ranges, { ...defaultRange, [end]: pos })
    else onChange(withRange(ranges, freqMhz, { [end]: pos }), defaultRange)
  }
  const clearRow = (freqMhz: number | null) => {
    if (freqMhz == null) onChange(ranges, { startPulses: null, stopPulses: null })
    else onChange(withRange(ranges, freqMhz, { startPulses: null, stopPulses: null }), defaultRange)
  }

  // A row with one end captured is kept, and named here: Run waits for its
  // other end rather than quietly sweeping the default in its place.
  const defaultHalf = (draftDefault.startPulses == null) !== (draftDefault.stopPulses == null)
  const halfLabels = [
    ...(defaultHalf ? ['All frequencies'] : []),
    ...freqs.filter((f) => {
      const r = findRange(draft, f.freqMhz)
      return r != null && !isComplete(r)
    }).map((f) => f.label),
  ]
  const own = freqs.filter((f) => isComplete(findRange(draft, f.freqMhz))).length
  const defaultOk = draftDefault.startPulses != null && draftDefault.stopPulses != null

  // The extent of every end in the table, saved or still a draft: the two
  // places the operator most often drives back to. Only the test's
  // frequencies -- a range kept for one no longer in the spec is not
  // anywhere this sweep goes.
  const ends = [
    draftDefault.startPulses, draftDefault.stopPulses,
    ...freqs.flatMap((f) => {
      const r = findRange(draft, f.freqMhz)
      return [r?.startPulses ?? null, r?.stopPulses ?? null]
    }),
  ].filter((p): p is number => p != null)
  const lowest = ends.length ? Math.min(...ends) : null
  const highest = ends.length ? Math.max(...ends) : null
  // The Sweep column's scale: every captured end and the carriage, with a
  // little air either side so a capsule never touches the cell's edge.
  const scaleEnds = t.position != null ? [...ends, t.position] : ends
  const scale = scaleEnds.length ? (() => {
    const a = Math.min(...scaleEnds), b = Math.max(...scaleEnds)
    const pad = Math.max(400, (b - a) * 0.04)
    return { lo: a - pad, hi: b + pad }
  })() : null

  const close = () => { t.onJogStop(); onClose() }
  const captureDisabled = t.position == null || locked

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="Trombone range"
      subtitle="Move the carriage to each end of the sweep and capture it, for all frequencies or per frequency."
      // Wider than Path loss: each end carries its value, a go-to and Capture.
      maxWidth="md"
      dividers
      // A full scrim, toolbar included, as every other dialog: the carriage
      // moves while this is up, so the dialog carries its own E-Stop beside
      // the close key instead of leaving the toolbar's lit above the scrim.
      headerActions={<EmergencyStop onStop={() => { t.onJogStop(); onEmergencyStop() }} />}
      footer={{
        leading: (
          <Typography sx={{ ...TEXT.hint, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {own} of {freqs.length} with their own range
          </Typography>
        ),
        // Captures are already saved; this only closes.
        primary: <Button onClick={close} variant="contained">Done</Button>,
      }}
    >
      <Stack spacing={2.5}>
        {/* The carriage: where it is, the jog, and the two ends of it all. */}
        <Box
          sx={{
            border: 1, borderColor: 'divider', borderRadius: 2, p: 1.75,
            bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)'),
          }}
        >
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography
              aria-live="polite"
              title={t.position == null ? undefined : `${t.position.toLocaleString()} pulses`}
              sx={{
                fontFamily: MONO, fontSize: 28, fontWeight: 600, lineHeight: 1.1,
                letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
                color: t.position == null ? 'text.disabled' : 'text.primary',
                // Room for "-000.00", so a sign or digit never moves the chip.
                minWidth: 150,
              }}
            >
              {t.position == null ? '—' : fmtMm(t.position)}
              <Box component="span" sx={{ ...TEXT.hint, fontFamily: 'inherit', fontWeight: 400, color: 'text.secondary', ml: 0.75, letterSpacing: 0 }}>
                mm
              </Box>
            </Typography>
            <StatusChip
              plain
              label={!t.connected ? 'Offline' : locked ? 'Run going' : t.moving ? 'Moving' : 'Idle'}
              tone={!t.connected ? 'off' : t.moving ? 'busy' : locked ? 'off' : 'ok'}
              spinning={t.connected && t.moving}
            />
          </Stack>

          <Box sx={FORM_SX}>
            <Label>Jog</Label>
            <Box sx={PAIR_SX}>
              <JogPad
                dir={t.jogDir}
                focused={t.jogFocused}
                disabled={!t.connected || locked}
                onStart={t.onJogStart}
                onStop={t.onJogStop}
                onKeyDown={t.onJogKeyDown}
                onKeyUp={t.onJogKeyUp}
                onFocusChange={t.onJogFocusChange}
              />
              <SegmentedChoice
                text fullWidth size="md"
                aria-label="Jog speed"
                value={String(t.jogSpeed)}
                options={JOG_SPEEDS}
                onChange={(v) => t.onJogSpeed(Number(v))}
                disabled={!t.connected || locked}
              />
            </Box>

            <Label>Go to</Label>
            <Box sx={PAIR_SX}>
              {/* Labels fixed, the position in the tooltip, so the keys keep
                  their size as ends are captured. */}
              <Tooltip title={lowest == null ? 'Nothing captured yet' : `${fmtMm(lowest)} mm`}>
                <span>
                  <Button
                    variant="outlined" size="small" fullWidth
                    startIcon={moveM.isPending && moveM.variables === lowest
                      ? <KeySpinner /> : <FirstPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => { if (lowest != null) goTo(lowest) }}
                    disabled={!canMove || lowest == null}
                    sx={[{ height: ROW_H }, hazardRingSx('move')]}
                  >
                    Lowest start
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={highest == null ? 'Nothing captured yet' : `${fmtMm(highest)} mm`}>
                <span>
                  <Button
                    variant="outlined" size="small" fullWidth
                    endIcon={moveM.isPending && moveM.variables === highest
                      ? <KeySpinner /> : <LastPageIcon sx={{ fontSize: 16 }} />}
                    onClick={() => { if (highest != null) goTo(highest) }}
                    disabled={!canMove || highest == null}
                    sx={[{ height: ROW_H }, hazardRingSx('move')]}
                  >
                    Highest end
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>
        </Box>

        <Box>
          <Table size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 150 }}>Frequency</TableCell>
                {/* Each row's range drawn on one shared scale, with the
                    carriage marked across all of them -- where the ranges sit
                    against each other, and where the carriage is against
                    each, while it is jogged to the next end. */}
                <TableCell>Sweep</TableCell>
                <TableCell sx={{ width: END_COL_W }}>Start</TableCell>
                <TableCell sx={{ width: END_COL_W }}>Stop</TableCell>
                {/* What the analyzer shows, as its own column: a key per
                    row, labelled, rather than an unlabelled glyph. */}
                <TableCell sx={{ width: VNA_W + 16 }}>VNA</TableCell>
                <TableCell sx={{ width: 44 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Every frequency without a range of its own is swept over
                  this one: capturing it alone is a single-range sweep. */}
              <TableRow sx={{ '& td': { bgcolor: 'action.hover' } }}>
                <TableCell sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  All frequencies
                </TableCell>
                <TableCell sx={{ px: 1 }}>
                  <SweepBar
                    scale={scale}
                    start={draftDefault.startPulses}
                    stop={draftDefault.stopPulses}
                    tone="all"
                    position={t.position}
                  />
                </TableCell>
                {ENDS.map((end) => (
                  <TableCell key={end} sx={{ px: 1 }}>
                    <EndCell
                      value={draftDefault[end]}
                      fallback={null}
                      missing={defaultHalf && draftDefault[end] == null}
                      name={`${end === 'startPulses' ? 'start' : 'stop'} for all frequencies`}
                      captureDisabled={captureDisabled}
                      goDisabled={!canMove}
                      onCapture={() => capture(null, end)}
                      onGo={goTo}
                    />
                  </TableCell>
                ))}
                <TableCell />
                <TableCell padding="none" sx={{ textAlign: 'center' }}>
                  <ClearKey
                    shown={draftDefault.startPulses != null || draftDefault.stopPulses != null}
                    label="Clear the range for all frequencies"
                    onClear={() => clearRow(null)}
                  />
                </TableCell>
              </TableRow>
              {freqs.map((f) => {
                const r = findRange(draft, f.freqMhz)
                const isHalf = r != null && !isComplete(r)
                const onVna = vna.shownMhz != null && sameFreq(vna.shownMhz, f.freqMhz)
                const pending = vna.pendingMhz != null && sameFreq(vna.pendingMhz, f.freqMhz)
                return (
                  <TableRow key={f.freqMhz}>
                    <TableCell sx={{ fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.label}
                    </TableCell>
                    <TableCell sx={{ px: 1 }}>
                      <SweepBar
                        scale={scale}
                        // Its own range; or, without one, All frequencies',
                        // greyed, since that is what it will be swept over.
                        start={r ? r.startPulses : defaultOk ? draftDefault.startPulses : null}
                        stop={r ? r.stopPulses : defaultOk ? draftDefault.stopPulses : null}
                        tone={r ? (isHalf ? 'half' : 'own') : 'fallback'}
                        position={t.position}
                      />
                    </TableCell>
                    {ENDS.map((end) => (
                      <TableCell key={end} sx={{ px: 1 }}>
                        <EndCell
                          value={r?.[end] ?? null}
                          fallback={!isComplete(r) && defaultOk ? draftDefault[end] : null}
                          missing={isHalf && r?.[end] == null}
                          name={`${end === 'startPulses' ? 'start' : 'stop'} at ${f.label}`}
                          captureDisabled={captureDisabled}
                          goDisabled={!canMove}
                          onCapture={() => capture(f.freqMhz, end)}
                          onGo={goTo}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <VnaKey
                        on={onVna}
                        pending={pending}
                        disabled={!vna.ready || vna.busy || locked}
                        title={!vna.ready ? 'Connect the network analyzer first'
                          : `${onVna ? 'On the VNA' : 'Put the VNA on'} ${f.label} · ${vna.describe(f.freqMhz)}`}
                        label={f.label}
                        onShow={() => vna.onShow(f.freqMhz)}
                      />
                    </TableCell>
                    <TableCell padding="none" sx={{ textAlign: 'center' }}>
                      <ClearKey
                        shown={r != null}
                        label={`Clear the range at ${f.label}`}
                        onClear={() => clearRow(f.freqMhz)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {/* One line, always: the hint, or the one-ended ranges Run is
              waiting on in its place. A separate warning used to hold a
              blank strip open under the table for the rare time it showed. */}
          <Typography
            role={halfLabels.length ? 'status' : undefined}
            sx={{
              ...TEXT.hint, mt: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              color: halfLabels.length ? 'warning.main' : 'text.secondary',
              fontWeight: halfLabels.length ? 500 : 400,
            }}
          >
            {halfLabels.length
              ? `${halfLabels.join(', ')}: one end captured. Run waits for the other.`
              : freqs.length === 0
                ? 'No frequencies in the test yet - enter them under Test point to give one its own range.'
                : own === freqs.length
                  ? 'Every frequency has its own range.'
                  : defaultOk
                    ? 'A frequency without its own range is swept over All frequencies, shown in grey.'
                    : 'Capture All frequencies, or a range for each frequency, before running.'}
          </Typography>
        </Box>
      </Stack>
    </ModalShell>
  )
}

interface EndCellProps {
  value: number | null
  /** The All frequencies range, shown greyed where this frequency takes it. */
  fallback: number | null
  /** The other end is captured and this one is not. */
  missing: boolean
  name: string
  captureDisabled: boolean
  goDisabled: boolean
  onCapture: () => void
  onGo: (pulses: number) => void
}

/** One captured end: its value, a key to drive back to it, and Capture. */
function EndCell({
  value, fallback, missing, name, captureDisabled, goDisabled, onCapture, onGo,
}: EndCellProps) {
  const shown = value ?? fallback
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) 28px ${CAPTURE_W}px`, alignItems: 'center', columnGap: 0.5 }}>
      <Typography
        sx={{
          fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          fontWeight: value != null ? 600 : 400,
          color: missing ? 'error.main' : value != null ? 'text.primary' : 'text.disabled',
        }}
      >
        {missing ? 'needed' : shown == null ? '—' : fmtMm(shown)}
      </Typography>
      {/* Held in its slot with `visibility`, so the value never shifts. */}
      <Tooltip title={value == null ? '' : `Go to ${fmtMm(value)} mm`}>
        <span style={{ visibility: value == null ? 'hidden' : 'visible' }}>
          <IconButton
            size="small"
            aria-label={`Go to the ${name}`}
            onClick={() => { if (value != null) onGo(value) }}
            disabled={goDisabled || value == null}
            sx={{ color: 'text.secondary' }}
          >
            <NearMeIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Button
        size="small" variant="outlined" color="inherit"
        aria-label={`${value == null ? 'Capture' : 'Recapture'} the ${name}`}
        onClick={onCapture}
        disabled={captureDisabled}
        sx={{ width: CAPTURE_W, minWidth: CAPTURE_W, height: 28 }}
      >
        {value == null ? 'Capture' : 'Recapture'}
      </Button>
    </Box>
  )
}

/** The row's clear key, held in its slot while there is nothing to clear. */
function ClearKey({ shown, label, onClear }: { shown: boolean; label: string; onClear: () => void }) {
  return (
    <Tooltip title="Clear both">
      <span style={{ visibility: shown ? 'visible' : 'hidden' }}>
        <IconButton
          size="small"
          aria-label={label}
          onClick={onClear}
          disabled={!shown}
          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}

/**
 * The row's analyzer key: "Show" puts the VNA on the row's span and marker,
 * and once there it reads "On VNA", tinted, so which row the Smith chart is
 * showing is visible from across the bench. Fixed width in every state.
 */
function VnaKey({ on, pending, disabled, title, label, onShow }: {
  on: boolean
  pending: boolean
  disabled: boolean
  title: string
  label: string
  onShow: () => void
}) {
  return (
    <Tooltip title={title}>
      <span>
        <Button
          size="small"
          variant={on ? 'contained' : 'outlined'}
          color={on ? 'primary' : 'inherit'}
          disableElevation
          aria-pressed={on}
          aria-label={`${on ? 'On the VNA' : 'Show on the VNA'}: ${label}`}
          onClick={onShow}
          disabled={disabled && !on}
          startIcon={pending ? <KeySpinner /> : on ? (
            <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} />
          ) : undefined}
          sx={[
            { width: VNA_W, minWidth: VNA_W, height: 28, whiteSpace: 'nowrap' },
            // Tinted rather than solid: it reports state, and solid blue is
            // kept for the one key that acts (Done).
            on && {
              bgcolor: (th) => alpha(th.palette.primary.main, 0.14),
              color: 'primary.main',
              '&:hover': { bgcolor: (th) => alpha(th.palette.primary.main, 0.22) },
            },
          ]}
        >
          {on ? 'On VNA' : 'Show'}
        </Button>
      </span>
    </Tooltip>
  )
}

type SweepTone = 'own' | 'all' | 'fallback' | 'half'

/**
 * One row's range on the table's shared scale, and the carriage on it.
 *
 * A capsule from Start to Stop: blue for a frequency's own range, neutral for
 * the All frequencies row, a lighter grey for a frequency that takes it. One
 * end captured is a single amber dot where it is, the rest of the lane empty
 * -- the range is half chosen, and Run waits for the other end.
 *
 * The carriage is a thin line at its live position in every row, so jogging
 * toward an end shows where it is against every range at once. It glides
 * between the position polls rather than jumping; with reduced motion, it
 * jumps.
 */
function SweepBar({ scale, start, stop, tone, position }: {
  scale: { lo: number; hi: number } | null
  start: number | null
  stop: number | null
  tone: SweepTone
  position: number | null
}) {
  const at = (p: number) => (scale ? ((p - scale.lo) / (scale.hi - scale.lo)) * 100 : 0)
  const both = start != null && stop != null
  const one = start ?? stop
  return (
    <Box sx={{ position: 'relative', height: 18 }}>
      {/* The lane. */}
      <Box
        sx={(th) => ({
          position: 'absolute', left: 0, right: 0, top: 7, height: 4, borderRadius: 2,
          bgcolor: alpha(th.palette.text.primary, 0.06),
        })}
      />
      {scale && both && (
        <Box
          sx={(th) => ({
            position: 'absolute', top: 7, height: 4, borderRadius: 2,
            left: `${at(Math.min(start, stop))}%`,
            width: `${Math.max(1.5, at(Math.max(start, stop)) - at(Math.min(start, stop)))}%`,
            bgcolor: tone === 'own' ? th.palette.primary.main
              : tone === 'all' ? alpha(th.palette.text.primary, 0.45)
                : alpha(th.palette.text.secondary, 0.3),
          })}
        />
      )}
      {scale && !both && one != null && (
        <Box
          sx={(th) => ({
            position: 'absolute', top: 5, width: 8, height: 8, borderRadius: '50%',
            left: `calc(${at(one)}% - 4px)`, bgcolor: th.palette.warning.main,
          })}
        />
      )}
      {scale && position != null && (
        <Box
          aria-hidden
          sx={(th) => ({
            position: 'absolute', top: 1, bottom: 1, width: 2, borderRadius: 1,
            left: `calc(${at(position)}% - 1px)`,
            bgcolor: alpha(th.palette.text.primary, 0.7),
            // Glides across the half-second between position polls.
            transition: 'left 0.45s linear',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          })}
        />
      )}
    </Box>
  )
}
