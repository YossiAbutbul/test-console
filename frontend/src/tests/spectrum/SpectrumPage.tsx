import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Autocomplete, Box, Button, MenuItem, Select, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography, useTheme,
} from '@mui/material'
import {
  Area, CartesianGrid, ComposedChart, ReferenceDot, ReferenceLine, ResponsiveContainer,
  XAxis, YAxis,
} from 'recharts'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import {
  DETECTOR_NAMES, TRACE_MODE_NAMES, spectrumApi,
  type MarkerAction, type SpectrumCommand, type SpectrumSettings, type SpectrumState,
  type SpectrumTrace,
} from '../../api/spectrum'
import type { DiscoverCandidate } from '../../api/instruments'
import { useInstrumentValue, useInstrumentsActions } from '../../context/InstrumentsContext'
import { useLog } from '../../context/LogContext'
import { DASH, fmt } from '../../lib/format'
import {
  ACTION_W, CONTROL_H, FieldGrid, InstrumentBar, MONO, PANEL_SX, PageBody, Section,
  TEXT,
} from '../../ui'
import type { TestPageProps } from '../types'
import { persistSpectrumPage, spectrumPageSnapshot } from '../../store/spectrumPageStore'

/**
 * Live refresh periods, seconds. Every query interrupts the FSC3's own sweep
 * and display, so this is a load dial on the analyzer, not just a frame rate:
 * 1 s is comfortable, 0.3 s is visibly heavier on its own screen.
 */
const PERIODS = [0.3, 0.5, 1, 2, 5]
const DEFAULT_PERIOD_S = 1

const MARKER_COUNTS = [1, 2, 3, 4, 5, 6]

/** Marker panel height limits and default, px. Double-clicking the divider
 *  resets. The screen takes whatever the panel leaves. The floor still shows
 *  the table's header and one row: panel padding 24 + border 2 + heading 30 +
 *  its gap 10 + header row 37 + one row 33 = 136, plus a little slack. */
const MARKERS_MIN = 144
const MARKERS_MAX = 600
const MARKERS_DEFAULT = 190

interface DividerProps {
  height: number
  onChange: (h: number) => void
}

/**
 * The drag handle between the screen and the marker panel, sizing the panel
 * below it: dragging up grows the table, and the screen fills what is left.
 *
 * Pointer capture keeps the drag alive when the pointer leaves the thin
 * handle, which it always does on a fast move.
 */
function PanelDivider({ height, onChange }: DividerProps) {
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null)
  return (
    <Box
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the marker table"
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag({ y: e.clientY, h: height })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        onChange(Math.max(MARKERS_MIN, Math.min(MARKERS_MAX, drag.h - (e.clientY - drag.y))))
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={() => onChange(MARKERS_DEFAULT)}
      sx={{
        flexShrink: 0, height: 14, my: '-3px !important', cursor: 'row-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'none', userSelect: 'none',
        '& > span': {
          width: 48, height: 4, borderRadius: 2,
          bgcolor: drag ? 'text.secondary' : 'divider', transition: 'background-color 0.15s',
        },
        '&:hover > span': { bgcolor: 'text.secondary' },
      }}
    >
      <span />
    </Box>
  )
}

interface ChoiceButtonsProps {
  value: string | undefined
  options: string[]
  names: Record<string, string>
  disabled?: boolean
  onPick: (v: string) => void
}

/** One button per option, the analyzer's current one filled. Wraps to the
 *  column width, so five options fit the narrow settings column. */
function ChoiceButtons({ value, options, names, disabled, onPick }: ChoiceButtonsProps) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 1 }}>
      {options.map((o) => (
        <Button
          key={o}
          size="small"
          variant={o === value ? 'contained' : 'outlined'}
          disabled={disabled}
          onClick={() => { if (o !== value) onPick(o) }}
          sx={{ px: 1, whiteSpace: 'nowrap' }}
        >
          {names[o] ?? o}
        </Button>
      ))}
    </Box>
  )
}

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Trim a fixed-precision number for an input box: 915.000000 -> 915. */
const trim = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

/** Hz in the largest readable unit, without trailing zeros: "906.2 MHz". */
function hzShort(hz: number | null | undefined): string {
  if (hz == null || !Number.isFinite(hz)) return DASH
  const [div, unit] = Math.abs(hz) >= 1e9 ? [1e9, 'GHz'] : Math.abs(hz) >= 1e6 ? [1e6, 'MHz']
    : Math.abs(hz) >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz']
  return `${trim((hz / div).toFixed(6))} ${unit}`
}

/**
 * Round tick positions across [lo, hi]: a step of 1, 2 or 5 x 10^k chosen to
 * give about `target` ticks, so a 906.2-911.2 MHz span reads 907, 908, 909.
 */
function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((st) => st >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Number(v.toFixed(10)))
  }
  return out
}

interface SettingFieldProps {
  label: string
  /** A control centred beside the input, e.g. an Auto button. */
  action?: ReactNode
  hint?: string
  /** What the analyzer reports, already in the field's unit. */
  value: number | null | undefined
  digits: number
  disabled?: boolean
  onApply: (v: number) => void
}

/**
 * A number the analyzer holds. Shows the instrument's value until focused;
 * applies on Enter or when focus leaves with a changed value. Like the
 * analyzer's own front panel, nothing is sent until the entry is finished.
 */
function SettingField({ label, action, hint, value, digits, disabled, onApply }: SettingFieldProps) {
  const shown = value == null ? '' : trim(value.toFixed(digits))
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const v = numOrNull(draft)
    setDraft(null)
    if (v != null && draft.trim() !== shown) onApply(v)
  }
  return (
    <LabeledField
      label={label}
      hint={hint}
      action={action}
      value={draft ?? shown}
      placeholder={DASH}
      disabled={disabled}
      onFocus={() => setDraft(shown)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
      }}
      sx={{ '& input': { fontFamily: MONO } }}
    />
  )
}

/**
 * The R&S FSC3 spectrum analyzer, as a live control panel.
 *
 * Unlike the tests, this page does not put the analyzer back: what is set here
 * is meant to stay set.
 *
 * Live mode leaves the analyzer free-running and only reads its trace — arming
 * a sweep per refresh would put it into single sweep, make its own screen step
 * along with the page, and break max hold and averaging. Sweep once is the
 * deliberate single-shot path.
 */
export function SpectrumPage({ group, active }: TestPageProps) {
  const { log } = useLog()
  const theme = useTheme()
  const sa = useInstrumentValue('spectrum')
  const { connect, disconnect, setAddress, discover } = useInstrumentsActions()

  const [candidates, setCandidates] = useState<DiscoverCandidate[]>([])
  const [info, setInfo] = useState<SpectrumState | null>(null)
  const [lastTrace, setTrace] = useState<SpectrumTrace | null>(null)
  const [liveWanted, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [sel, setSel] = useState(1)
  const [periodS, setPeriodS] = useState(() => spectrumPageSnapshot.periodS ?? DEFAULT_PERIOD_S)
  const [showTable, setShowTable] = useState(() => spectrumPageSnapshot.showTable ?? true)
  const [markersH, setMarkersH] = useState(() =>
    Math.max(MARKERS_MIN, Math.min(MARKERS_MAX, spectrumPageSnapshot.markersH ?? MARKERS_DEFAULT)))
  useEffect(() => {
    spectrumPageSnapshot.periodS = periodS
    spectrumPageSnapshot.showTable = showTable
    spectrumPageSnapshot.markersH = markersH
    persistSpectrumPage()
  }, [periodS, showTable, markersH])

  const connected = sa.status === 'connected'
  // A dropped link ends Live, whoever dropped it — derived rather than cleared,
  // so a reconnect starts clean without an effect. The last capture is kept on
  // screen: it is a measurement, and disconnecting should not throw it away.
  const live = liveWanted && connected
  const trace = lastTrace
  const address = sa.address
  const st: Partial<SpectrumSettings> = connected ? (info?.state ?? {}) : {}
  // The settings the last capture was taken at. Kept after a disconnect, with
  // the trace, so it keeps its scale; the fields above go blank instead, as
  // they would otherwise show values nobody can change or confirm.
  const shown: Partial<SpectrumSettings> = info?.state ?? {}
  const zero = !!st.zero_span
  const markerCount = st.markers ?? 0

  // Offer the analyzer's direct-link address when nothing is chosen. The row
  // is shared with the Instruments panel, so whichever connects, both see it.
  useEffect(() => {
    if (!active || connected) return
    let cancelled = false
    discover('spectrum')
      .then((found) => {
        if (cancelled) return
        setCandidates(found)
        if (!address && found[0]) setAddress('spectrum', found[0].resource)
      })
      .catch(() => { /* the address can always be typed */ })
    return () => { cancelled = true }
    // Once per visit: a pick must not re-trigger discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connected, discover])

  const report = useCallback((s: SpectrumState, what: string) => {
    setInfo(s)
    setProblems(s.problems)
    if (s.problems.length) {
      log('Spectrum', `${what} — analyzer rejected: ${s.problems.join('; ')}`, 'warn')
    }
  }, [log])

  // Read the state once the link is up, however it was opened: here, from the
  // Instruments panel, or before a reload. What was read is not shown once the
  // link is down (see `live` and `trace` above), so nothing needs clearing.
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    spectrumApi.state()
      .then(async (s) => {
        if (cancelled) return
        // A snapshot with nothing in it means the backend has not read the
        // analyzer since connecting; one read fills it.
        const full = Object.keys(s.state).length ? s : await spectrumApi.command({ op: 'refresh' })
        if (!cancelled) report(full, 'Read state')
      })
      .catch((e) => log('Spectrum', `Read state failed: ${(e as Error).message}`, 'error'))
    return () => { cancelled = true }
  }, [connected, report, log])

  /** Send one operation, then show what the analyzer reports back. */
  const send = useCallback(async (cmd: SpectrumCommand, what: string) => {
    setBusy(true)
    try {
      report(await spectrumApi.command(cmd), what)
      log('Spectrum', what)
    } catch (e) {
      log('Spectrum', `${what} failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [report, log])

  const readTrace = useCallback(async (single: boolean) => {
    const t = await spectrumApi.trace(single)
    setTrace(t)
    return t
  }, [])

  // Live: read the free-running trace every `periodS`. Gated on `active` so a
  // hidden page never keeps the analyzer busy answering nobody.
  useEffect(() => {
    if (!live || !connected || !active) return
    let cancelled = false
    let timer: number | undefined
    const loop = async () => {
      if (cancelled) return
      try {
        await readTrace(false)
      } catch (e) {
        if (!cancelled) {
          log('Spectrum', `Live stopped: ${(e as Error).message}`, 'error')
          setLive(false)
        }
        return
      }
      if (!cancelled) timer = window.setTimeout(loop, periodS * 1000)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [live, connected, active, periodS, readTrace, log])

  const setLiveOn = async (on: boolean) => {
    if (on) {
      // Going live puts the analyzer back into continuous sweep: the page
      // then only reads the trace it is already producing.
      await send({ op: 'continuous', on: true }, 'Continuous sweep')
    }
    setLive(on)
  }

  const sweepOnce = async () => {
    setLive(false)
    setBusy(true)
    try {
      const t = await readTrace(true)
      if (!t.swept) log('Spectrum', 'Sweep once: the sweep did not finish in time', 'warn')
      // The single sweep left the analyzer in single-sweep mode; show that.
      report(await spectrumApi.command({ op: 'refresh' }), 'Sweep once')
    } catch (e) {
      log('Spectrum', `Sweep once failed: ${(e as Error).message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onConnect = async () => {
    const r = await connect('spectrum')
    if (r.ok) log('Spectrum', `Connected to ${address || 'the analyzer'}`)
    else log('Spectrum', `Connect failed: ${r.failure?.raw ?? r.failure?.title ?? 'unknown'}`, 'error')
  }

  const onDisconnect = async () => {
    setLive(false)
    await disconnect('spectrum')
    log('Spectrum', 'Disconnected — settings left as they are')
  }

  const ensureMarker = async () => {
    if (markerCount > 0) return
    await send({ op: 'markers', count: 1 }, 'Marker 1 on')
    setSel(1)
  }
  const markerAction = async (action: MarkerAction, what: string) => {
    await ensureMarker()
    await send({ op: 'marker_action', n: sel, action }, `M${sel} ${what}`)
    if (!live) await readTrace(false).catch(() => {})
  }
  /** Switch one marker off; the backend renumbers the ones above it. */
  const markerOff = async (n: number) => {
    await send({ op: 'marker_off', n }, `M${n} off`)
    setSel((s) => Math.max(1, Math.min(s, markerCount - 1)))
    if (!live) await readTrace(false).catch(() => {})
  }

  const setMarkerAt = async (v: number) => {
    await ensureMarker()
    // Zero span puts the marker on the time axis: the field is ms, sent as s.
    await send({ op: 'marker_x', n: sel, x: zero ? v / 1000 : v * 1e6 }, `M${sel} set`)
    if (!live) await readTrace(false).catch(() => {})
  }

  const can = connected && !busy
  const span = st.span_hz ?? null

  // --- chart data -----------------------------------------------------------
  const chart = useMemo(() => {
    if (!trace || trace.values.length === 0) return null
    const n = trace.values.length
    const sweepMs = (shown.sweep_time_s ?? 0) * 1000
    const x0 = trace.zero_span ? 0 : (trace.start_hz ?? 0) / 1e6
    const x1 = trace.zero_span ? sweepMs : (trace.stop_hz ?? 0) / 1e6
    const step = n > 1 ? (x1 - x0) / (n - 1) : 0
    return {
      data: trace.values.map((y, i) => ({ x: x0 + i * step, y })),
      domain: [x0, x1] as [number, number],
      markers: trace.markers
        .filter((m) => m.x != null && m.y != null)
        .map((m) => ({ n: m.n, x: trace.zero_span ? m.x! * 1000 : m.x! / 1e6, y: m.y! })),
      xLabel: trace.zero_span ? 'Time (ms)' : 'Frequency (MHz)',
      zero: trace.zero_span,
    }
  }, [trace, shown.sweep_time_s])

  const ref = st.ref_level_dbm ?? null
  const top = shown.ref_level_dbm ?? null
  const range = shown.range_db ?? 100
  const yDomain: [number, number] | ['auto', 'auto'] = top == null ? ['auto', 'auto'] : [top - range, top]
  // Gridlines on round 20 dB levels inside the displayed range.
  const yTicks = top == null ? undefined
    : Array.from({ length: Math.floor(range / 20) + 1 }, (_, i) => Math.floor(top / 20) * 20 - i * 20)
      .filter((v) => v >= top - range)

  const optionsWithHeld: DiscoverCandidate[] = address && !candidates.some((c) => c.resource === address)
    ? [{ resource: address, idn: sa.idn ?? null }, ...candidates]
    : candidates

  /** One line saying what the screen is showing, as the analyzer reports it. */
  const screenSummary = !connected && !trace ? null : [
    connected ? null : 'last capture',
    shown.zero_span ? `${hzShort(shown.center_hz)} · zero span`
      : shown.start_hz != null && shown.stop_hz != null
        ? `${hzShort(shown.start_hz)} – ${hzShort(shown.stop_hz)}` : null,
    shown.detector ? (DETECTOR_NAMES[shown.detector] ?? shown.detector).toLowerCase() : null,
    shown.rbw_hz != null ? `RBW ${hzShort(shown.rbw_hz)}` : null,
  ].filter(Boolean).join(' · ')

  const selectSx = { '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5 } }
  const fieldLabelSx = { fontSize: 13, fontWeight: 500, mb: 0.5 }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="Spectrum Analyzer"
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="contained"
              disabled={!can}
              onClick={() => void markerAction('peak', 'to peak')}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Peak search
            </Button>
            <Button
              variant="outlined"
              disabled={!can}
              onClick={() => void sweepOnce()}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.md }}
            >
              Sweep once
            </Button>
            {/* Go live and Stop are one button, as on the analyzer's own panel:
                red while the page is reading, so it is obvious how to stop. */}
            <Button
              variant={live ? 'contained' : 'outlined'}
              color={live ? 'error' : 'primary'}
              disabled={!connected}
              onClick={() => void setLiveOn(!live)}
              sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md }}
            >
              {live ? 'Stop' : 'Go live'}
            </Button>
          </Stack>
        }
      />

      <PageBody width="fluid" grow>
        <InstrumentBar
          name="Spectrum analyzer"
          model="R&S FSC3 · LAN SCPI"
          status={sa.status}
          detail={[sa.idn, address].filter(Boolean).join(' · ') || null}
          summary={address || null}
          configReady={!!address}
          onConnect={() => void onConnect()}
          onDisconnect={() => void onDisconnect()}
          config={
            <Box>
              <Typography sx={{ ...TEXT.dense, color: 'text.secondary', mb: 0.75 }}>Address</Typography>
              <Autocomplete
                size="small"
                freeSolo
                disabled={connected}
                options={optionsWithHeld.map((c) => c.resource)}
                value={address}
                onChange={(_e, v) => setAddress('spectrum', typeof v === 'string' ? v : (v ?? ''))}
                onInputChange={(_e, v) => setAddress('spectrum', v ?? '')}
                renderInput={(p) => (
                  <TextField {...p} placeholder="172.16.10.1:5555" sx={{ '& input': { fontFamily: MONO, fontSize: 12.5 } }} />
                )}
              />
            </Box>
          }
        />

        {/* Settings on the side, the screen taking the rest, as on the
            analyzer itself. The side column scrolls on its own so the trace
            stays in view while a setting is changed. One column when the
            page is too narrow for both. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
            gap: 2,
            // A height of its own, so the side column scrolls inside it rather
            // than stretching the page and carrying the screen away with it.
            // The page above it — top bar, connection row, header, instrument
            // bar — is about 380 px.
            height: 'calc(100vh - 380px)',
            minHeight: 560,
            // Both columns scroll within the grid's height: the side when the
            // settings are long, the main one when the marker table is.
            // The side column scrolls when the settings are long. The main one
            // never does: the screen fills whatever the marker panel leaves.
            '& > .spectrum-side': { minHeight: 0, overflowY: 'auto', pr: 0.5, pb: 0.5 },
            '& > .spectrum-main': { minHeight: 0, overflow: 'hidden' },
            // Too narrow for both: stack, and let the page scroll as usual.
            '@container (max-width: 700px)': {
              gridTemplateColumns: 'minmax(0, 1fr)',
              height: 'auto',
              '& > .spectrum-side, & > .spectrum-main': { overflowY: 'visible' },
            },
          }}
        >
          <Stack spacing={2} className="spectrum-side">
            <Section title="Frequency" panel>
              <FieldGrid columns={2}>
                <SettingField label="Center" hint="MHz" value={st.center_hz == null ? null : st.center_hz / 1e6} digits={6}
                  disabled={!can} onApply={(v) => void send({ op: 'frequency', center_hz: v * 1e6 }, `Center ${v} MHz`)} />
                <SettingField label="Span" hint="MHz" value={span == null ? null : span / 1e6} digits={6}
                  disabled={!can} onApply={(v) => void send({ op: 'frequency', span_hz: v * 1e6 }, `Span ${v} MHz`)} />
                <SettingField label="Start" hint="MHz" value={st.start_hz == null ? null : st.start_hz / 1e6} digits={6}
                  disabled={!can} onApply={(v) => void send({ op: 'frequency', start_hz: v * 1e6 }, `Start ${v} MHz`)} />
                <SettingField label="Stop" hint="MHz" value={st.stop_hz == null ? null : st.stop_hz / 1e6} digits={6}
                  disabled={!can} onApply={(v) => void send({ op: 'frequency', stop_hz: v * 1e6 }, `Stop ${v} MHz`)} />
              </FieldGrid>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 2 }}>
                <Button size="small" variant="outlined" disabled={!can} onClick={() => void send({ op: 'full_span' }, 'Full span')}>Full span</Button>
                <Button size="small" variant="outlined" disabled={!can || zero} onClick={() => void send({ op: 'frequency', span_hz: 0 }, 'Zero span')}>Zero span</Button>
              </Box>
            </Section>

            <Section title="Amplitude" panel>
              <FieldGrid columns={2}>
                <SettingField label="Ref level" hint="dBm" value={ref} digits={2}
                  disabled={!can} onApply={(v) => void send({ op: 'ref_level', dbm: v }, `Reference level ${v} dBm`)} />
                <SettingField label="Ref offset" hint="dB" value={st.ref_offset_db} digits={2}
                  disabled={!can} onApply={(v) => void send({ op: 'ref_offset', db: v }, `Reference offset ${v} dB`)} />
                <SettingField label="Attenuation" hint="dB" value={st.atten_db} digits={0}
                  disabled={!can} onApply={(v) => void send({ op: 'attenuation', db: v }, `Attenuation ${v} dB`)} />
                <LabeledField label="Display range" hint="dB" value={st.range_db == null ? '' : fmt(st.range_db, 0)}
                  placeholder={DASH} disabled sx={{ '& input': { fontFamily: MONO } }} />
              </FieldGrid>
            </Section>

            <Section title="Trace" panel>
              <Typography sx={fieldLabelSx}>Mode</Typography>
              <ChoiceButtons
                value={st.trace_mode}
                options={info?.trace_modes ?? Object.keys(TRACE_MODE_NAMES)}
                names={TRACE_MODE_NAMES}
                disabled={!can}
                onPick={(m) => void send({ op: 'trace_mode', mode: m }, `Trace ${TRACE_MODE_NAMES[m] ?? m}`)}
              />
              <Typography sx={{ ...fieldLabelSx, mt: 2 }}>Detector</Typography>
              <ChoiceButtons
                value={st.detector}
                options={info?.detectors ?? Object.keys(DETECTOR_NAMES)}
                names={DETECTOR_NAMES}
                disabled={!can}
                onPick={(d) => void send({ op: 'detector', detector: d }, `Detector ${DETECTOR_NAMES[d] ?? d}`)}
              />
            </Section>

            <Section title="Sweep & bandwidth" panel>
              <Stack spacing={1.5}>
                {([
                  ['RBW', 'kHz', st.rbw_hz == null ? null : st.rbw_hz / 1e3,
                    (v: number) => void send({ op: 'rbw', hz: v * 1e3 }, `RBW ${v} kHz`),
                    () => void send({ op: 'rbw', auto: true }, 'RBW auto'), false],
                  ['VBW', 'kHz', st.vbw_hz == null ? null : st.vbw_hz / 1e3,
                    (v: number) => void send({ op: 'vbw', hz: v * 1e3 }, `VBW ${v} kHz`),
                    () => void send({ op: 'vbw', auto: true }, 'VBW auto'), false],
                  // Auto sweep time is refused in zero span, and a fixed one only
                  // takes there, so its Auto is off in zero span.
                  ['Sweep time', 'ms', st.sweep_time_s == null ? null : st.sweep_time_s * 1000,
                    (v: number) => void send({ op: 'sweep_time', seconds: v / 1000 }, `Sweep time ${v} ms`),
                    () => void send({ op: 'sweep_time', auto: true }, 'Sweep time auto'), zero],
                ] as const).map(([label, unit, value, apply, auto, autoOff]) => (
                  <SettingField
                    key={label} label={label} hint={unit} value={value} digits={3} disabled={!can} onApply={apply}
                    action={
                      <Button
                        size="small" variant="outlined" disabled={!can || autoOff} onClick={auto}
                        sx={{ height: 28, minWidth: 48, px: 1, fontSize: 12 }}
                      >
                        Auto
                      </Button>
                    }
                  />
                ))}
              </Stack>
              <Typography sx={{ ...fieldLabelSx, mt: 2 }}>Sweep</Typography>
              <ChoiceButtons
                value={st.continuous == null ? undefined : st.continuous ? 'cont' : 'single'}
                options={['cont', 'single']}
                names={{ cont: 'Continuous', single: 'Single' }}
                disabled={!can}
                onPick={(v) => void send({ op: 'continuous', on: v === 'cont' }, v === 'cont' ? 'Continuous sweep' : 'Single sweep')}
              />
            </Section>

            <Section title="Markers" panel>
              <Typography sx={fieldLabelSx}>Active</Typography>
              {/* How many markers are on, 1..6 (they switch on in order), with
                  All off at the end of the same row. */}
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0.5, flexGrow: 1 }}>
                  {MARKER_COUNTS.map((c) => (
                    <Button
                      key={c}
                      size="small"
                      variant={c <= markerCount ? 'contained' : 'outlined'}
                      disabled={!can}
                      onClick={() => {
                        if (c === markerCount) return
                        setSel((s) => Math.min(s, c))
                        void send({ op: 'markers', count: c }, `${c} marker${c > 1 ? 's' : ''} on`)
                      }}
                      sx={{ minWidth: 0, px: 0, fontFamily: MONO }}
                    >
                      {c}
                    </Button>
                  ))}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  disabled={!can || markerCount === 0}
                  onClick={() => void send({ op: 'markers', count: 0 }, 'Markers off')}
                  sx={{ whiteSpace: 'nowrap', borderColor: 'divider' }}
                >
                  All off
                </Button>
              </Stack>
              <FieldGrid columns={2}>
                <Box sx={{ mt: 2 }}>
                  <Typography sx={fieldLabelSx}>Selected</Typography>
                  <Select
                    size="small" fullWidth
                    value={sel}
                    onChange={(e) => setSel(Number(e.target.value))}
                    sx={selectSx}
                  >
                    {Array.from({ length: Math.max(markerCount, 1) }, (_, i) => i + 1).map((n) => (
                      <MenuItem key={n} value={n} sx={{ fontFamily: MONO, fontSize: 12.5 }}>M{n}</MenuItem>
                    ))}
                  </Select>
                </Box>
                <Box sx={{ mt: 2 }}>
                  <SettingField
                    label={`Place M${sel}`}
                    hint={zero ? 'ms' : 'MHz'}
                    value={(() => {
                      const m = trace?.markers.find((k) => k.n === sel)
                      if (m?.x == null) return null
                      return zero ? m.x * 1000 : m.x / 1e6
                    })()}
                    digits={zero ? 3 : 6}
                    disabled={!can}
                    onApply={(v) => void setMarkerAt(v)}
                  />
                </Box>
              </FieldGrid>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 2 }}>
                <Button size="small" variant="outlined" disabled={!can} onClick={() => void markerAction('next', 'to next peak')}>Next peak</Button>
                <Button size="small" variant="outlined" disabled={!can} onClick={() => void markerAction('min', 'to minimum')}>Min</Button>
                <Button size="small" variant="outlined" disabled={!can || zero} title="Move the center frequency to the selected marker"
                  onClick={() => void markerAction('center', 'to center')}>Mkr → center</Button>
                <Button size="small" variant="outlined" disabled={!can || sel > markerCount}
                  onClick={() => void markerOff(sel)}>M{sel} off</Button>
              </Box>
            </Section>
          </Stack>

          <Stack spacing={2} className="spectrum-main">
            {/* Fills what the marker panel leaves, with a floor: shrunk under the
                chart, the chart spilled over the panel below. */}
            <Box sx={{ flex: '1 1 0', minHeight: 300, display: 'flex', flexDirection: 'column' }}>
            <Section
              title="Screen"
              panel
              grow
              action={
                // Truncates rather than pushing into the title on a narrow page.
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, maxWidth: '75%' }}>
                  {screenSummary && (
                    <Typography noWrap title={screenSummary} sx={{ ...TEXT.micro, color: 'text.secondary', minWidth: 0 }}>
                      {screenSummary}
                    </Typography>
                  )}
                  <Tooltip title="Live refresh. Every read costs the analyzer sweep time; 0.3 s is visibly heavier on its own screen.">
                    <Select
                      size="small"
                      value={periodS}
                      onChange={(e) => setPeriodS(Number(e.target.value))}
                      sx={{ height: 28, '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12 } }}
                    >
                      {PERIODS.map((p) => (
                        <MenuItem key={p} value={p} sx={{ fontFamily: MONO, fontSize: 12 }}>{p} s</MenuItem>
                      ))}
                    </Select>
                  </Tooltip>
                </Stack>
              }
            >
              <Box
                sx={{
                  flexGrow: 1, minHeight: 0, position: 'relative',
                  border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover',
                }}
              >
                {chart ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart.data} margin={{ top: 24, right: 20, bottom: 24, left: 8 }}>
                      <CartesianGrid stroke={theme.palette.divider} strokeOpacity={0.6} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={chart.domain}
                        ticks={niceTicks(chart.domain[0], chart.domain[1])}
                        tickFormatter={(v: number) => trim(v.toFixed(3))}
                        tick={{ fontSize: 11, fontFamily: MONO, fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                        stroke={theme.palette.text.secondary}
                        label={{ value: chart.zero ? 'ms' : 'MHz', position: 'insideBottomRight', offset: -16, fontSize: 11 }}
                      />
                      <YAxis
                        domain={yDomain}
                        ticks={yTicks}
                        allowDataOverflow
                        tickFormatter={(v: number) => v.toFixed(1)}
                        tick={{ fontSize: 11, fontFamily: MONO, fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                        stroke={theme.palette.text.secondary}
                        width={52}
                      />
                      <Area
                        dataKey="y"
                        type="linear"
                        baseValue={typeof yDomain[0] === 'number' ? yDomain[0] : 'dataMin'}
                        isAnimationActive={false}
                        stroke={theme.palette.success.main}
                        strokeWidth={1.25}
                        fill={theme.palette.success.main}
                        fillOpacity={0.07}
                        dot={false}
                        activeDot={false}
                      />
                      {chart.markers.map((m) => (
                        <ReferenceLine
                          key={m.n}
                          x={m.x}
                          stroke={theme.palette.text.primary}
                          strokeDasharray="3 3"
                          strokeOpacity={m.n === sel ? 0.9 : 0.5}
                          label={{
                            value: `M${m.n}  ${fmt(m.y, 1)}`,
                            position: 'insideTopRight',
                            fontSize: 11,
                            fontFamily: MONO,
                            fill: theme.palette.text.primary,
                          }}
                        />
                      ))}
                      {chart.markers.map((m) => (
                        <ReferenceDot
                          key={`d${m.n}`}
                          x={m.x}
                          y={m.y}
                          r={3.5}
                          fill={theme.palette.text.primary}
                          stroke={theme.palette.background.paper}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                    <Typography sx={{ ...TEXT.dense, color: 'text.secondary' }}>
                      {connected ? 'Press Go live, or Sweep once.' : 'Connect the analyzer to see its trace.'}
                    </Typography>
                  </Stack>
                )}
              </Box>
              {problems.length > 0 && (
                <Typography sx={{ ...TEXT.micro, color: 'warning.main', mt: 1.25, fontFamily: MONO }}>
                  Rejected by the analyzer: {problems.join(' · ')}
                </Typography>
              )}
            </Section>
            </Box>

            {showTable && <PanelDivider height={markersH} onChange={setMarkersH} />}
            {!showTable ? (
              // Folded away, the panel is one slim row: the full section
              // padding around a single button took height from the screen.
              <Stack
                direction="row"
                alignItems="center"
                sx={{ ...PANEL_SX, flexShrink: 0, px: 2, py: 0.5 }}
              >
                <Typography
                  sx={{
                    fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                    textTransform: 'uppercase', color: 'text.secondary', flexGrow: 1,
                  }}
                >
                  Markers
                </Typography>
                <Button size="small" onClick={() => setShowTable(true)}>Show table</Button>
              </Stack>
            ) : (
            <Box sx={{ height: markersH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <Section
              title="Markers"
              panel
              grow
              action={
                <Button size="small" onClick={() => setShowTable(false)}>Hide table</Button>
              }
            >
              {trace && trace.markers.length > 0 ? (
                <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
                <Table size="small" stickyHeader sx={{ '& td, & th': { fontFamily: MONO, fontSize: 12 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Marker</TableCell>
                      <TableCell align="right">{trace.zero_span ? 'Time (ms)' : 'Frequency (MHz)'}</TableCell>
                      <TableCell align="right">Level (dBm)</TableCell>
                      <TableCell align="right" sx={{ width: 56 }} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trace.markers.map((m) => (
                      <TableRow key={m.n} hover selected={m.n === sel} onClick={() => setSel(m.n)} sx={{ cursor: 'pointer' }}>
                        <TableCell>M{m.n}</TableCell>
                        <TableCell align="right">
                          {m.x == null ? DASH : trace.zero_span ? fmt(m.x * 1000, 3) : fmt(m.x / 1e6, 6)}
                        </TableCell>
                        <TableCell align="right">{fmt(m.y, 2)}</TableCell>
                        <TableCell align="right" sx={{ py: 0 }}>
                          <Button
                            size="small"
                            disabled={!can}
                            onClick={(e) => { e.stopPropagation(); void markerOff(m.n) }}
                            sx={{ minWidth: 0, px: 1, fontSize: 11 }}
                          >
                            Off
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </Box>
              ) : (
                <Typography sx={{ ...TEXT.dense, color: 'text.secondary' }}>
                  {markerCount === 0 ? 'No markers on. Add them under Markers in the settings.' : 'Marker readings appear with the next trace.'}
                </Typography>
              )}
            </Section>
            </Box>
            )}
          </Stack>
        </Box>
      </PageBody>
    </Box>
  )
}
