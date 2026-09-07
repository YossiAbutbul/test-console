import { useEffect, useState } from 'react'
import { Box, Stack, Tab, Tabs } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch } from '../../lib/earfcn'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { CommandResponse, LteCwRequest } from '../../types/models'
import type { TestPageProps } from '../types'
import TuneIcon from '@mui/icons-material/Tune'
import { IconButton, Tooltip } from '@mui/material'
import {
  FieldGrid, LastFrameSection, LatchingKey, MeasureOptions, PageBody,
  RunControls, Section, SegmentedChoice, SendStopControls, measuresAnything,
  requiredInstruments, type MeasureSelection,
} from '../../ui'
import { BandsModal } from '../lte/BandsModal'
import { useLteBands, useLteChannelUnit, type ChannelUnit } from '../lte/channel'
import { useLteModem, type LiveTest } from '../lte/useLteModem'
import { LteAutomationPanel, type AutomationControls } from './LteAutomationPanel'
import {
  lteCwPageSnapshot, persistLteCwPage, type LteCwPageTab,
} from '../../store/lteCwPageStore'

/**
 * LTE CW transmit — manual and automation.
 *
 * The modem is off at rest and takes ~10 s to boot, so its power is held by
 * the operator rather than bracketed around each command: leave it on and a
 * second send costs one frame instead of eleven seconds. The modem key is the
 * only thing that powers it down — neither Stop nor the end of an automation
 * run does.
 *
 *     Key on     ->  MODEM_ON
 *     Send       ->  (MODEM_ON if off) -> (ABORT_TEST if one is running)
 *                    -> TEST_RF_CW(START_TX_TEST)
 *     Stop       ->  TEST_RF_CW(ABORT_TEST)
 *     Key off    ->  MODEM_OFF
 *     Run        ->  MODEM_OFF -> MODEM_ON, then per point
 *                    START_TX_TEST -> settle -> measure -> ABORT_TEST
 *
 * A run power-cycles rather than reusing a modem that looks up: it is the one
 * place that can afford the ~10 s, and starting a sweep from a known modem is
 * worth more than starting it ten seconds sooner.
 *
 * Modem power and the live test are held by `useLteModem` at page level rather
 * than in either tab, because they describe one piece of hardware that both
 * tabs drive. A panel with its own copy would send a MODEM_ON the other tab
 * had already sent, and the modem refuses that.
 */

/** What the manual tab reads back by default: everything, as it always did.
 *  The operator can drop either, or both — see `MeasureOptions`. The
 *  automation tab is unaffected; a sweep with nothing to record is not a
 *  sweep, so it still requires both. */
const DEFAULT_MEASURE: MeasureSelection = { power: true, current: true }

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const MAX_POWER_DBM = 23

/** Defaults are the values from the captured frames, so the page opens on
 *  something known to be well-formed rather than on zeros. `earfcn` and `mhz`
 *  are the same channel either way round, so switching units on a fresh page
 *  does not change what it is pointed at. */
const DEFAULTS = {
  earfcn: '18900', mhz: '1880', seconds: '200', power: '23', offset: '0',
}

/** Nested snapshot for the manual tab — auto-created on first write, so the
 *  page-level store stays one object. Mirrors `snap()` in the automation
 *  panel. */
function man(): NonNullable<typeof lteCwPageSnapshot.manual> {
  if (!lteCwPageSnapshot.manual) lteCwPageSnapshot.manual = {}
  return lteCwPageSnapshot.manual
}

export function LteCwPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  /**
   * Whether channel inputs are read as EARFCNs or as MHz, and which bands a
   * MHz value is allowed to mean. Both are rig-wide rather than per-page — see
   * `tests/lte/channel`.
   */
  const [unit, setUnit] = useLteChannelUnit()
  const [bands, setBands] = useLteBands()
  // Read once, for the initialisers below: the field defaults depend on which
  // unit the page is coming back in, and a channel default of 18900 makes no
  // sense to a page that reopens in MHz.
  const [initialUnit] = useState<ChannelUnit>(unit)
  const [earfcn, setEarfcn] = useState(
    () => man().channel ?? (initialUnit === 'mhz' ? DEFAULTS.mhz : DEFAULTS.earfcn),
  )
  const [seconds, setSeconds] = useState(() => man().seconds ?? DEFAULTS.seconds)
  const [power, setPower] = useState(() => man().power ?? DEFAULTS.power)
  const [offset, setOffset] = useState(() => man().offset ?? DEFAULTS.offset)
  useEffect(() => { man().channel = earfcn; persistLteCwPage() }, [earfcn])
  useEffect(() => { man().seconds = seconds; persistLteCwPage() }, [seconds])
  useEffect(() => { man().power = power; persistLteCwPage() }, [power])
  useEffect(() => { man().offset = offset; persistLteCwPage() }, [offset])
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [measure, setMeasure] = useState<MeasureSelection>(
    () => lteCwPageSnapshot.manualMeasure ?? DEFAULT_MEASURE,
  )
  useEffect(() => { lteCwPageSnapshot.manualMeasure = measure; persistLteCwPage() }, [measure])
  const willMeasure = measuresAnything(measure)
  const preflight = useInstrumentPreflight(requiredInstruments(measure), { verb: 'send' })

  const [tab, setTab] = useState<LteCwPageTab>(() => lteCwPageSnapshot.tab ?? 'manual')
  useEffect(() => { lteCwPageSnapshot.tab = tab; persistLteCwPage() }, [tab])

  const [bandsOpen, setBandsOpen] = useState(false)
  // The automation tab owns its run; it publishes just enough for the header
  // to render the buttons in the same slot the manual tab uses.
  const [autoCtl, setAutoCtl] = useState<AutomationControls | null>(null)

  const modem = useLteModem({ onFrame: setLast })

  const focusBind = (key: string) => ({
    onFocus: () => setFocusKey(key),
    onBlur: () => setFocusKey((k) => (k === key ? null : k)),
  })

  // Kept as strings so clearing a field shows empty rather than snapping to 0.
  const asNum = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const isU32Int = (s: string) => {
    const v = asNum(s)
    return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF
  }
  const isI32Int = (s: string) => {
    const v = asNum(s)
    return Number.isInteger(v) && v >= -0x80000000 && v <= 0x7FFFFFFF
  }
  // Seconds on screen, milliseconds on the wire, so the limit is the uint32
  // ceiling divided by 1000 rather than the raw field width.
  const isSeconds = (s: string) => {
    const v = asNum(s)
    return Number.isFinite(v) && v >= 0 && Math.round(v * 1000) <= 0xFFFFFFFF
  }
  const isPower = (s: string) => {
    const v = asNum(s)
    return Number.isFinite(v) && v >= 0 && v <= MAX_POWER_DBM
  }

  const secondsValid = isSeconds(seconds)
  const offsetValid = isI32Int(offset)
  const powerValid = isPower(power)

  /**
   * The channel the field names, in whichever unit is selected.
   *
   * Both directions end at the same place — an EARFCN to transmit on and the
   * frequency to measure at — but they fail differently. An EARFCN can be in
   * no band we know; a frequency can be in no *selected* band, or in more than
   * one, and 'ambiguous' is its own answer because picking a band for the
   * operator would put the DUT on a channel they never asked for.
   */
  const resolveChannel = (text: string): UplinkMatch | 'ambiguous' | null => {
    const v = asNum(text)
    if (!Number.isFinite(v)) return null
    if (unit === 'earfcn') {
      if (!isU32Int(text)) return null
      const ch = uplinkFromEarfcn(v)
      return ch ? { ...ch, earfcn: v } : null
    }
    const hits = uplinkFromMhz(v, bands)
    if (hits.length === 0) return null
    return hits.length > 1 ? 'ambiguous' : hits[0]
  }

  const resolved = resolveChannel(earfcn)
  const channel = resolved && resolved !== 'ambiguous' ? resolved : null
  const channelValid = channel != null
  const canSend = channelValid && secondsValid && offsetValid && powerValid

  /** Shows the *other* unit, so the field always states what it resolved to. */
  const channelHint = (): string => {
    if (resolved === 'ambiguous') return 'in several selected bands'
    if (!channel) return unit === 'earfcn' ? 'EARFCN' : 'MHz'
    return unit === 'earfcn'
      ? `${(channel.freqHz / 1e6).toFixed(1)} MHz · Band ${channel.band}`
      : `EARFCN ${channel.earfcn} · Band ${channel.band}`
  }

  // Kept short: the message renders in a bubble that cannot escape the panel
  // it sits in, so a long one wraps into a block that covers the field above.
  const channelError = (): string => {
    if (earfcn.trim() === '') return 'Enter a value'
    if (resolved === 'ambiguous') return 'In more than one selected band'
    return unit === 'earfcn'
      ? 'Outside the known bands'
      : 'Not in the selected bands'
  }

  /**
   * Switch units, carrying the channel across.
   *
   * The manual field holds one value, so it can be converted exactly. The
   * automation rows hold range specs, and the panel rewrites those itself on
   * the same edge.
   */
  const switchUnit = (next: ChannelUnit) => {
    if (channel) {
      setEarfcn(next === 'mhz' ? String(channel.freqHz / 1e6) : String(channel.earfcn))
    }
    setUnit(next)
  }

  const req = (): LteCwRequest => ({
    earfcn: channel?.earfcn ?? NaN,
    time_ms: Math.round(asNum(seconds) * 1000),
    tx_power_dbm: asNum(power),
    offset_hz: asNum(offset),
  })

  /** How to stop a CW test once it has been started. */
  const cwTest = (params: LteCwRequest): LiveTest => ({
    label: 'CW',
    abort: () => device.lteCw({ ...params, start: false }),
  })

  const send = useMutation({
    mutationFn: async () => {
      // Connect before keying the PA — see PowerPage.send. Skipped outright
      // when nothing is being measured: preflight with an empty list still
      // puts a dialog in front of a transmit that needs no instruments.
      if (willMeasure && !(await preflight.run())) {
        log('DUT', 'Send cancelled — instruments not ready', 'warn')
        return null
      }
      // Powers the modem up if it is down, and aborts whatever is already
      // running on it — the modem takes one test at a time and silently drops
      // a START that arrives while another is live.
      await modem.prepare()
      const params = req()
      const started = await device.lteCw({ ...params, start: true })
      return { started, params }
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r.started)
      log('DUT', `LTE CW start: ok=${r.started.ok} status=${r.started.status}`)
      if (!r.started.ok) return
      // Remembered so the next Send knows to abort, and so Stop aborts what is
      // actually running even if the form has been edited since.
      modem.setRunning(cwTest(r.params))
      if (willMeasure) setMeasureTrigger((n) => n + 1)
    },
    // No power-down here. The modem may well be up with the command having
    // failed; it stays up so the operator can fix the parameters and retry
    // without waiting for another boot.
    onError: (e: Error) => log('DUT', `LTE CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    // Falls back to the form when nothing is known to be running — Stop is a
    // safety control, so it stays useful even if our idea of the state is off.
    mutationFn: () => (modem.getRunning() ?? cwTest(req())).abort(),
    onSuccess: (r) => {
      setLast(r)
      modem.setRunning(null)
      log('DUT', `LTE CW abort: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log('DUT', `LTE stop failed: ${e.message}`, 'error'),
  })

  const busy = send.isPending || stop.isPending || modem.busy
  const autoRunning = autoCtl?.running ?? false

  // `msg` is the whole message, blank case included — the channel field's
  // reason for being invalid depends on which unit it is in.
  const validation = (value: string, valid: boolean, msg: string, key: string) => ({
    error: !valid,
    ...focusBind(key),
    InputProps: {
      endAdornment: (
        <ValidationAdornment
          show={shouldShowValidation(value, valid, focusKey === key)}
          message={msg}
        />
      ),
    },
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="CW"
        actions={
          <Stack direction="row" spacing={2} alignItems="center">
            {/* Modem power sits outside the tabs: it is one piece of hardware
                both tabs need, so it stays put when they switch. Locked during
                a run — pulling power mid-sweep would fail every point after. */}
            <LatchingKey
              value={modem.on}
              disabled={busy || autoRunning}
              offLabel="Modem off"
              onLabel="Modem on"
              onChange={modem.toggle}
            />
            {/* Both tabs put their primary action in the same place, so
                switching tabs does not move Run/Send across the screen. */}
            {tab === 'manual' ? (
              <SendStopControls
                busy={busy}
                sending={send.isPending}
                stopping={stop.isPending}
                canSend={canSend}
                // A powered-down modem cannot be running a test, so aborting is
                // meaningless. Cutting transmission still has a route: the
                // modem key, which is the harder stop anyway.
                canStop={modem.on}
                onSend={() => send.mutate()}
                onStop={() => stop.mutate()}
              />
            ) : autoCtl ? (
              <RunControls
                running={autoCtl.running}
                canRun={autoCtl.canRun}
                progress={autoCtl.progress}
                onRun={autoCtl.onRun}
                onStop={autoCtl.onStop}
              />
            ) : null}
          </Stack>
        }
      />

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          minHeight: 36, mt: -0.5,
          borderBottom: 1, borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 36, py: 0.25, fontSize: 13 },
        }}
      >
        <Tab value="manual" label="Manual" />
        <Tab value="automation" label="Automation" />
      </Tabs>

      {/* Both panels stay mounted; toggle via display so switching is instant
          and a run keeps going while the manual tab is on screen. */}
      <Box sx={{ display: tab === 'manual' ? 'block' : 'none' }}>
        <PageBody width="fluid">
          <Section
            title="Transmit"
            panel
            action={
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <SegmentedChoice
                  value={unit}
                  options={[
                    { value: 'earfcn', label: 'EARFCN' },
                    { value: 'mhz', label: 'MHz' },
                  ]}
                  onChange={switchUnit}
                />
                <Tooltip title="Bands in use">
                  <IconButton size="small" onClick={() => setBandsOpen(true)}>
                    <TuneIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          >
            <FieldGrid>
              <LabeledField
                label={unit === 'earfcn' ? 'EARFCN' : 'Frequency'}
                hint={channelHint()} type="number" value={earfcn}
                {...validation(earfcn, channelValid, channelError(), 'earfcn')}
                onChange={(e) => setEarfcn(e.target.value)}
              />
              <LabeledField
                label="Tx Power" hint="dBm" type="number" value={power}
                inputProps={{ step: 0.01, min: 0, max: MAX_POWER_DBM }}
                {...validation(power, powerValid, power.trim() === '' ? 'Enter a value' : `Allowed range: 0–${MAX_POWER_DBM} dBm`, 'power')}
                onChange={(e) => setPower(e.target.value)}
              />
              <LabeledField
                label="Time" hint="s" type="number" value={seconds}
                inputProps={{ step: 0.1, min: 0 }}
                {...validation(seconds, secondsValid, seconds.trim() === '' ? 'Enter a value' : 'Seconds, 0–4294967', 'seconds')}
                onChange={(e) => setSeconds(e.target.value)}
              />
              <LabeledField
                label="Offset from centre" hint="Hz" type="number" value={offset}
                {...validation(offset, offsetValid, offset.trim() === '' ? 'Enter a value' : 'Whole number, ±2147483647', 'offset')}
                onChange={(e) => setOffset(e.target.value)}
              />
            </FieldGrid>
          </Section>

          {/* What to read back after the send. Above the result rather than
              beside it, because it decides whether there is one. */}
          <Section title="Measure" panel>
            <MeasureOptions value={measure} onChange={setMeasure} disabled={busy} />
          </Section>

          {/* Hidden when nothing is being measured; an empty strip of dashes
              reads as a failed read rather than one never asked for. */}
          {willMeasure && (
            <MeasurementCard
              freqHz={channel?.freqHz}
              triggerId={measureTrigger}
              targetDbm={powerValid ? asNum(power) : null}
              wants={measure}
            />
          )}

          <LastFrameSection result={last} />
        </PageBody>
      </Box>

      <Box
        sx={{
          mt: 2, flexGrow: 1, minHeight: 0, flexDirection: 'column',
          display: tab === 'automation' ? 'flex' : 'none',
        }}
      >
        <LteAutomationPanel
          modem={modem}
          unit={unit}
          bands={bands}
          // switchUnit, not setUnit: whichever toggle is used, both the
          // manual field and the automation rows carry their channels across.
          onUnitChange={switchUnit}
          onEditBands={() => setBandsOpen(true)}
          onControlsChange={setAutoCtl}
        />
      </Box>

      {modem.dialog}

      <BandsModal
        open={bandsOpen}
        onClose={() => setBandsOpen(false)}
        bands={bands}
        onSave={setBands}
      />

      {preflight.dialog}
    </Box>
  )
}
