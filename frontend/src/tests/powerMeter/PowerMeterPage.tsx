import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrowRounded'
import StopIcon from '@mui/icons-material/StopRounded'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepRounded'
import { PageHeader } from '../../components/PageHeader'
import { instrumentsApi } from '../../api/instruments'
import {
  useInstrumentValue, useInstrumentsActions,
} from '../../context/InstrumentsContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { describeMeasureError } from '../../lib/instrumentError'
import { DASH } from '../../lib/format'
import {
  DenseTabs, InstrumentBar, KeySpinner, MONO, PageBody, Section, StatRow, StatTile, TEXT,
  InstrumentError,
  ACTION_W,
  MiniAction,
  HeadCell, NUM_CELL_SX, actionSx,
} from '../../ui'
import type { TestPageProps } from '../types'
import {
  persistPowerMeterPage, powerMeterPageSnapshot, type PowerMeterTab,
} from '../../store/powerMeterPageStore'

/** Slowest that still feels live, fastest that will not swamp a USB sensor. */
const MIN_INTERVAL_MS = 200
const MAX_INTERVAL_MS = 60_000
/** What continuous mode runs at unless told otherwise. */
const DEFAULT_INTERVAL_MS = 400

/**
 * Below this the sensor is reporting its under-range sentinel rather than a
 * measurement -- a disconnected or unpowered input reads around -900 dBm.
 *
 * Continuous mode shows it anyway. It is the honest reading, and a blank where
 * a number should be is indistinguishable from a read that never happened;
 * the label beside it says which kind of number it is.
 */
const UNDER_RANGE_DBM = -100

/** Kept for the statistics. Deep enough to average a drifting reading over a
 *  few minutes, shallow enough not to grow without bound on an overnight run. */
const MAX_SAMPLES = 500
/** Only the tail is listed — the rest exists for min/max/mean. */
const LISTED = 10

interface Sample {
  /** ms since epoch, for the timestamp column. */
  t: number
  /** Raw, as the sensor reported it. The correction is applied at display
   *  time so changing the factor re-reads the whole trace rather than
   *  leaving older samples corrected by a figure that no longer applies. */
  dbm: number
}

function fmt(v: number | null | undefined, digits: number): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return v.toFixed(digits)
}

function clockOf(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * The connected line under the name, from the sensor's identity string.
 *
 * The backend reports "model,serial,firmware"; the model is already printed
 * beside the name, so repeating it read as the same fact twice. Display only:
 * anything not in that shape is shown as it came.
 */
function idnLine(idn: string | null | undefined): string | null {
  if (!idn) return null
  const parts = idn.split(',').map((p) => p.trim()).filter(Boolean)
  const serialAt = parts.findIndex((p) => /^\d{4,}$/.test(p))
  if (serialAt < 0) return idn
  const fw = parts[serialAt + 1]
  return fw ? `serial ${parts[serialAt]} · firmware ${fw}` : `serial ${parts[serialAt]}`
}

/**
 * The power sensor on its own.
 *
 * No frequency anywhere: the meter is broadband and reports what is at its
 * input, so there is nothing to tune it to. The CW pages pass one because they
 * set the sensor's calibration factor for a known carrier; this page is the
 * instrument, not a test.
 *
 * Both the raw reading and the corrected result are shown, with the factor
 * between them. Displaying only the corrected number would mean an operator
 * chasing a cable fault could not see what the sensor actually reported.
 */
export function PowerMeterPage({ group, active }: TestPageProps) {
  const { log } = useLog()
  const sensor = useInstrumentValue('power-sensor')
  const { connect, disconnect, setAddress } = useInstrumentsActions()
  // The default rather than a per-frequency entry: the table is keyed by
  // frequency and this page has none, so looking one up would silently pick a
  // correction that belongs to some other measurement.
  const { pathLossDb } = usePathLoss()

  const [tab, setTab] = useState<PowerMeterTab>(
    () => powerMeterPageSnapshot.tab ?? 'read',
  )
  const [intervalMs, setIntervalMs] = useState<string>(
    () => powerMeterPageSnapshot.intervalMs ?? String(DEFAULT_INTERVAL_MS),
  )
  useEffect(() => {
    powerMeterPageSnapshot.tab = tab
    powerMeterPageSnapshot.intervalMs = intervalMs
    persistPowerMeterPage()
  }, [tab, intervalMs])

  const [samples, setSamples] = useState<Sample[]>([])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tracing, setTracing] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const connected = sensor.status === 'connected'
  const everyMs = Math.min(
    MAX_INTERVAL_MS,
    Math.max(MIN_INTERVAL_MS, Number(intervalMs) || DEFAULT_INTERVAL_MS),
  )

  /**
   * One read.
   *
   * Also held in a ref so the trace loop can call the current version without
   * listing it as a dependency — re-creating the loop every time a sample
   * lands would restart the timer and the interval would never elapse.
   */
  const readOnce = useCallback(async () => {
    setReading(true)
    try {
      // No frequency argument: nothing to calibrate against on this page.
      //
      // allowNoSignal: this page is the instrument, so an under-range reading
      // is the answer rather than a failure. Without it the backend retries
      // for ~1.5 s and then raises, which both hides the number and makes a
      // 400 ms interval impossible.
      const r = await instrumentsApi.measure(undefined, { allowNoSignal: true })
      if (r.error) {
        setError(r.error)
      } else if (r.power_dbm == null) {
        // A reply with no number and no error is not a reading either; say
        // which of the two happened rather than leaving the tile blank.
        setError(r.power_sensor_connected ? 'Sensor returned no reading' : 'Power sensor is not connected')
      } else {
        setError(null)
        const dbm = r.power_dbm
        setSamples((prev) => [...prev, { t: Date.now(), dbm }].slice(-MAX_SAMPLES))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading(false)
    }
  }, [])

  const readRef = useRef(readOnce)
  useEffect(() => { readRef.current = readOnce }, [readOnce])

  /**
   * The trace loop.
   *
   * Chained timeouts rather than setInterval: a read that takes longer than
   * the interval would otherwise stack up behind the sensor's VISA session,
   * and the queue only ever grows. This waits for each reply, then counts.
   *
   * Stops when the page is not `active`. Every page stays mounted, so a timer
   * left running here would keep a USB sensor busy from a page the operator
   * navigated away from — and lose races with whatever test they moved on to.
   */
  useEffect(() => {
    // Continuous tab only: the Read tab is single shots, and a loop left
    // running behind it would keep the sensor busy for a tab that is not
    // asking for readings.
    if (!tracing || !connected || !active || tab !== 'continuous') return
    let cancelled = false
    let timer: number | undefined
    const loop = async () => {
      if (cancelled) return
      await readRef.current()
      if (cancelled) return
      timer = window.setTimeout(loop, everyMs)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [tracing, connected, active, everyMs, tab])

  const onConnect = async () => {
    setConnecting(true)
    try {
      await connect('power-sensor')
    } finally {
      setConnecting(false)
    }
  }

  const onClear = () => {
    setSamples([])
    setError(null)
    log('Power Sensor', 'Trace cleared')
  }

  const last = samples.length ? samples[samples.length - 1] : null
  const raw = last?.dbm ?? null
  const result = raw != null ? raw + pathLossDb : null
  const resultMw = result != null ? Math.pow(10, result / 10) : null
  // Statistics track the corrected result, which is the number being read off
  // the page. The factor is a constant offset, so the span is the same either
  // way — but mixing two scales in one strip is not worth the saving.
  const corrected = samples.map((s) => s.dbm + pathLossDb)
  const min = corrected.length ? Math.min(...corrected) : null
  const max = corrected.length ? Math.max(...corrected) : null
  const mean = corrected.length ? corrected.reduce((a, b) => a + b, 0) / corrected.length : null
  const underRange = raw != null && raw <= UNDER_RANGE_DBM
  const failure = error ? describeMeasureError(error) : null
  const busy = reading || connecting

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="Power Meter"
        actions={
          // One width for both tabs' keys, so switching tab does not resize
          // the header. Read takes the run glyph, not Refresh: Refresh is
          // Scan elsewhere, and this key takes a measurement.
          tab === 'read' ? (
            <Button
              variant="contained"
              onClick={() => void readOnce()}
              disabled={!connected || busy}
              startIcon={reading ? <KeySpinner /> : <PlayArrowIcon sx={{ fontSize: 16 }} />}
              sx={actionSx(ACTION_W.wide)}
            >
              Read
            </Button>
          ) : (
            <Button
              variant={tracing ? 'outlined' : 'contained'}
              // Not red when tracing: stopping a read-out is not a hazard, and
              // red is kept for the keys that act on the bench.
              onClick={() => setTracing((v) => !v)}
              disabled={!connected}
              startIcon={
                tracing
                  ? <StopIcon sx={{ fontSize: 16 }} />
                  : <PlayArrowIcon sx={{ fontSize: 16 }} />
              }
              sx={actionSx(ACTION_W.wide)}
            >
              {tracing ? 'Stop trace' : 'Start trace'}
            </Button>
          )
        }
      />


      <PageBody width="fluid">
        <InstrumentBar
          name="Power sensor"
          model="Mini-Circuits PWR-SEN-4GHS"
          failure={sensor.failure}
          status={connecting && !connected ? 'connecting' : sensor.status}
          // Tracing is the sensor's live state, so it takes the chip's slot
          // rather than a word inserted before the clock, which shifted it.
          liveLabel={tracing ? 'Tracing' : undefined}
          liveTone={tracing ? 'busy' : 'ok'}
          detail={idnLine(sensor.idn)}
          summary={sensor.address ? `serial ${sensor.address}` : 'first sensor found'}
          onConnect={() => void onConnect()}
          onDisconnect={() => void disconnect('power-sensor')}
          config={
            <Box>
              {/* Set like LabeledField's label, so this dialog reads like the
                  forms on the pages. */}
              <Typography sx={{ ...TEXT.label, color: 'text.primary', mb: 0.5 }}>Serial number</Typography>
              <TextField
                size="small"
                fullWidth
                value={sensor.address}
                disabled={connected}
                placeholder="blank = first sensor found"
                onChange={(e) => setAddress('power-sensor', e.target.value.trim())}
                sx={{ '& input': { fontFamily: MONO, fontSize: 12.5 } }}
              />
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 0.75 }}>
                Needed only with more than one sensor plugged in.
              </Typography>
            </Box>
          }
        />

        <DenseTabs
          value={tab}
          onChange={(_, v: PowerMeterTab) => {
            // Leaving the tab stops the loop rather than letting it run behind
            // a screen that is not showing its readings.
            if (v !== 'continuous') setTracing(false)
            setTab(v)
          }}
          // Under the instrument row, as on the test pages: what the page
          // reads from comes first, how it reads second.
          // No margin of its own: PageBody's grid gap spaces it.
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="read" label="Read" />
          <Tab value="continuous" label="Continuous" />
        </DenseTabs>

        <Section
          title="Reading"
          panel
          action={
            <Stack direction="row" alignItems="center" spacing={1.5}>
              {/* When the strip was last read. Always there at one width,
                  showing a dash before the first reading, so the controls
                  beside it never move when it fills in. */}
              <Typography
                sx={{
                  width: 64, flexShrink: 0, textAlign: 'right',
                  fontSize: 12, color: 'text.secondary',
                  fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                }}
              >
                {last ? clockOf(last.t) : DASH}
              </Typography>
              {/* The trace controls live here rather than in a section of their
                  own: they are two small settings and the strip they govern is
                  immediately below. Kept in the row on the Read tab too, just
                  hidden, so switching tab neither resizes the heading nor
                  slides Clear along it. */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                aria-hidden={tab !== 'continuous' || undefined}
                sx={{ visibility: tab === 'continuous' ? 'visible' : 'hidden' }}
              >
                {/* No floating label: nothing else in the app uses MUI's notched
                    outline, so one here read as a different kind of control. The
                    name sits beside it instead, which is what the row has space
                    for. */}
                <Typography sx={{ ...TEXT.label, color: 'text.secondary' }}>Every</Typography>
                <TextField
                  size="small"
                  type="number"
                  value={intervalMs}
                  onChange={(e) => setIntervalMs(e.target.value)}
                  inputProps={{ step: 100, min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS, 'aria-label': 'Trace interval' }}
                  sx={{
                    width: 104,
                    '& input': { fontFamily: MONO, fontSize: 12.5, textAlign: 'center' },
                  }}
                  InputProps={{
                    endAdornment: (
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', pl: 0.5 }}>ms</Typography>
                    ),
                  }}
                />
              </Stack>
              <MiniAction
                tone="destructive"
                onClick={onClear}
                disabled={!samples.length}
                startIcon={<DeleteSweepIcon />}
              >
                Clear
              </MiniAction>
            </Stack>
          }
        >
          <StatRow inCard>
            {/* Raw first: it is what the instrument said, and an operator
                chasing a cable fault needs it before anything derived. */}
            <StatTile
              label="At sensor"
              value={fmt(raw, 2)}
              unit={raw != null ? 'dBm' : undefined}
              // Under-range is still a reading and still shown. What changes
              // is the label under it: a value near -900 means the sensor sees
              // nothing, and calling that "measured" invites it being taken
              // for a real level.
              sub={
                raw == null
                  ? (connected ? 'not read yet' : 'sensor off')
                  : underRange ? 'under range · no signal' : 'measured'
              }
              off={!connected || raw == null}
              tone={underRange ? 'warn' : undefined}
            />
            <StatTile
              label="Correction"
              value={`${pathLossDb > 0 ? '+' : ''}${fmt(pathLossDb, 1)}`}
              unit="dB"
              // Names where the figure comes from, which a footnote under the
              // strip used to repeat: Result = reading + this, set in the
              // Bench inspector.
              sub={pathLossDb === 0 ? 'none set · Bench' : 'path loss · Bench'}
              off={pathLossDb === 0}
            />
            <StatTile
              label="Result"
              value={fmt(result, 2)}
              unit={result != null ? 'dBm' : undefined}
              sub={resultMw != null ? `${resultMw.toFixed(3)} mW` : connected ? 'no reading' : 'sensor off'}
              off={result == null}
            />
            <StatTile
              label="Min"
              value={fmt(min, 2)}
              unit={min != null ? 'dBm' : undefined}
              sub={samples.length ? `${samples.length} sample${samples.length === 1 ? '' : 's'}` : 'no samples yet'}
              off={min == null}
            />
            <StatTile
              label="Max"
              value={fmt(max, 2)}
              unit={max != null ? 'dBm' : undefined}
              sub={min != null && max != null ? `span ${(max - min).toFixed(2)} dB` : 'no samples yet'}
              off={max == null}
            />
            <StatTile
              label="Mean"
              value={fmt(mean, 2)}
              unit={mean != null ? 'dBm' : undefined}
              sub={mean == null ? 'no samples yet' : undefined}
              off={mean == null}
            />
          </StatRow>
        </Section>

        {failure && <InstrumentError title={failure.title} message={failure.hint ?? ''} />}

        {/* Always on the page, always LISTED rows tall: mounting it at the
            second reading, then growing it a row per sample, moved everything
            under it while the operator was reading. Unfilled rows are blank
            placeholders of the same height. */}
        <Section title="Recent" panel collapsible defaultOpen>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ width: '100%' }}>
              <TableHead>
                <TableRow>
                  <HeadCell label="Time" />
                  <HeadCell label="At sensor" unit="dBm" numeric />
                  <HeadCell label="Result" unit="dBm" numeric />
                  <HeadCell label="Result" unit="mW" numeric />
                </TableRow>
              </TableHead>
              <TableBody>
                {(() => {
                  const rows = samples.length > 1 ? [...samples].slice(-LISTED).reverse() : []
                  return Array.from({ length: LISTED }, (_, i) => {
                    const s = rows[i]
                    if (!s) {
                      return (
                        <TableRow key={`empty-${i}`}>
                          {/* Blank, not a sentence: an empty table reads as one. */}
                          <TableCell colSpan={4} aria-hidden>{' '}</TableCell>
                        </TableRow>
                      )
                    }
                    const res = s.dbm + pathLossDb
                    const ink = i === 0 ? 'text.primary' : 'text.secondary'
                    return (
                      <TableRow key={`${s.t}-${i}`}>
                        <TableCell sx={{ ...NUM_CELL_SX, textAlign: 'left', color: ink }}>{clockOf(s.t)}</TableCell>
                        <TableCell sx={{ ...NUM_CELL_SX, color: ink }}>{s.dbm.toFixed(2)}</TableCell>
                        <TableCell sx={{ ...NUM_CELL_SX, color: ink }}>{res.toFixed(2)}</TableCell>
                        <TableCell sx={{ ...NUM_CELL_SX, color: ink }}>{Math.pow(10, res / 10).toFixed(3)}</TableCell>
                      </TableRow>
                    )
                  })
                })()}
              </TableBody>
            </Table>
          </Box>
        </Section>
      </PageBody>
    </Box>
  )
}
