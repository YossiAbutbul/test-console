import { useEffect, useState } from 'react'
import { Box, MenuItem, Stack, Tab, Tabs } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import { uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch } from '../../lib/earfcn'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { CommandResponse, LteModulatedRequest } from '../../types/models'
import type { TestPageProps } from '../types'
import TuneIcon from '@mui/icons-material/Tune'
import { IconButton, Tooltip } from '@mui/material'
import {
  FieldGrid, LastFrameSection, LatchingKey, PageBody, RunControls, Section,
  SegmentedChoice, SendStopControls,
} from '../../ui'
import { BandsModal } from '../lte/BandsModal'
import { useLteBands, useLteChannelUnit, type ChannelUnit } from '../lte/channel'
import { useLteModem, type LiveTest } from '../lte/useLteModem'
import {
  BW_DEFAULT, BW_OPTIONS, MCS_DEFAULT, MCS_MAX, MCS_MIN, RB_DEFAULT,
  bandwidthLabel, rbForBandwidth,
} from './signal'
import { AutomationPanel, type AutomationControls } from './AutomationPanel'
import {
  lteModulatedPageSnapshot, persistLteModulatedPage, type LteModulatedPageTab,
} from '../../store/lteModulatedPageStore'

/**
 * LTE modulated transmit — manual and automation.
 *
 * The same shape as the CW page, and for the same reasons: the modem is off at
 * rest and takes ~10 s to boot, so its power is held by the operator rather
 * than bracketed around each command, and the modem key is the only thing that
 * powers it down.
 *
 *     Key on     ->  MODEM_ON
 *     Send       ->  (MODEM_ON if off) -> (ABORT_TEST if one is running)
 *                    -> TEST_RF_MODULATED(START_TX_TEST)
 *     Stop       ->  TEST_RF_MODULATED(ABORT_TEST)
 *     Key off    ->  MODEM_OFF
 *     Run        ->  MODEM_OFF -> MODEM_ON, then per point
 *                    START_TX_TEST -> settle -> measure -> ABORT_TEST
 *
 * What differs from CW is only the waveform: instead of an offset from the
 * channel centre, the frame carries a bandwidth, an MCS and a resource-block
 * allocation. The modem is the same one, and `useLteModem` is shared with the
 * CW page — two copies of the power state would each send a MODEM_ON the other
 * had already sent, and the modem refuses that.
 */

/** Both tabs measure what they transmit, so both need these up. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const MAX_POWER_DBM = 23

/** Defaults are the values from the captured frames, so the page opens on
 *  something known to be well-formed rather than on zeros. `earfcn` and `mhz`
 *  are the same channel either way round, so switching units on a fresh page
 *  does not change what it is pointed at. */
const DEFAULTS = { earfcn: '18900', mhz: '1880', seconds: '200', power: '23' }

/** Nested snapshot for the manual tab — auto-created on first write, so the
 *  page-level store stays one object. Mirrors `snap()` in the automation
 *  panel. */
function man(): NonNullable<typeof lteModulatedPageSnapshot.manual> {
  if (!lteModulatedPageSnapshot.manual) lteModulatedPageSnapshot.manual = {}
  return lteModulatedPageSnapshot.manual
}

export function LteModulatedPage({ protocol, group }: TestPageProps) {
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
  const [bandwidth, setBandwidth] = useState(() => man().bandwidth ?? BW_DEFAULT)
  const [mcs, setMcs] = useState(() => man().mcs ?? MCS_DEFAULT)
  const [rbCount, setRbCount] = useState(() => man().rbCount ?? RB_DEFAULT)
  const [rbStart, setRbStart] = useState(() => man().rbStart ?? 0)
  useEffect(() => { man().channel = earfcn; persistLteModulatedPage() }, [earfcn])
  useEffect(() => { man().seconds = seconds; persistLteModulatedPage() }, [seconds])
  useEffect(() => { man().power = power; persistLteModulatedPage() }, [power])
  useEffect(() => { man().bandwidth = bandwidth; persistLteModulatedPage() }, [bandwidth])
  useEffect(() => { man().mcs = mcs; persistLteModulatedPage() }, [mcs])
  useEffect(() => { man().rbCount = rbCount; persistLteModulatedPage() }, [rbCount])
  useEffect(() => { man().rbStart = rbStart; persistLteModulatedPage() }, [rbStart])
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS, { verb: 'send' })

  const [tab, setTab] = useState<LteModulatedPageTab>(
    () => lteModulatedPageSnapshot.tab ?? 'manual',
  )
  useEffect(() => { lteModulatedPageSnapshot.tab = tab; persistLteModulatedPage() }, [tab])

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
  const powerValid = isPower(power)
  const maxRb = rbForBandwidth(bandwidth)
  const mcsValid = Number.isInteger(mcs) && mcs >= MCS_MIN && mcs <= MCS_MAX
  const rbValid = Number.isInteger(rbCount) && rbCount >= 1 && rbCount <= maxRb
  // An allocation that runs past the end of the channel is not something the
  // modem can transmit; the backend refuses it, so it is caught here first.
  const rbStartValid = Number.isInteger(rbStart) && rbStart >= 0
    && rbStart + rbCount <= maxRb

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
  const canSend = channelValid && secondsValid && powerValid
    && mcsValid && rbValid && rbStartValid

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

  /** Keep the allocation inside the channel when the bandwidth narrows: 25 RB
   *  is a full 5 MHz channel and more than a 1.4 MHz one has to give. */
  const switchBandwidth = (next: number) => {
    const room = rbForBandwidth(next)
    setBandwidth(next)
    setRbCount((n) => Math.min(n, room))
    setRbStart((s) => Math.min(s, Math.max(0, room - Math.min(rbCount, room))))
  }

  const req = (): LteModulatedRequest => ({
    earfcn: channel?.earfcn ?? NaN,
    time_ms: Math.round(asNum(seconds) * 1000),
    tx_power_dbm: asNum(power),
    bandwidth,
    mcs,
    rb_count: rbCount,
    rb_start: rbStart,
    // Not exposed: both captures carry 0, and the byte order of this and
    // rb_start is the one part of the frame they do not pin — so there is
    // nothing to check a non-zero value against.
    nb_index: 0,
  })

  /** How to stop a modulated test once it has been started. */
  const modulatedTest = (params: LteModulatedRequest): LiveTest => ({
    label: 'modulated',
    abort: () => device.lteModulated({ ...params, start: false }),
  })

  const send = useMutation({
    mutationFn: async () => {
      // Connect before keying the PA — see PowerPage.send.
      if (!(await preflight.run())) {
        log('DUT', 'Send cancelled — instruments not ready', 'warn')
        return null
      }
      // Powers the modem up if it is down, and aborts whatever is already
      // running on it — the modem takes one test at a time and silently drops
      // a START that arrives while another is live.
      await modem.prepare()
      const params = req()
      const started = await device.lteModulated({ ...params, start: true })
      return { started, params }
    },
    onSuccess: (r) => {
      if (!r) return
      setLast(r.started)
      log('DUT', `LTE modulated start: ok=${r.started.ok} status=${r.started.status}`)
      if (!r.started.ok) return
      // Remembered so the next Send knows to abort, and so Stop aborts what is
      // actually running even if the form has been edited since.
      modem.setRunning(modulatedTest(r.params))
      setMeasureTrigger((n) => n + 1)
    },
    // No power-down here. The modem may well be up with the command having
    // failed; it stays up so the operator can fix the parameters and retry
    // without waiting for another boot.
    onError: (e: Error) => log('DUT', `LTE modulated failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    // Falls back to the form when nothing is known to be running — Stop is a
    // safety control, so it stays useful even if our idea of the state is off.
    mutationFn: () => (modem.getRunning() ?? modulatedTest(req())).abort(),
    onSuccess: (r) => {
      setLast(r)
      modem.setRunning(null)
      log('DUT', `LTE modulated abort: ok=${r.ok} status=${r.status}`)
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
        label="Modulated"
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
                label="Bandwidth" select value={bandwidth}
                onChange={(e) => switchBandwidth(Number(e.target.value))}
              >
                {BW_OPTIONS.map((bw) => (
                  <MenuItem key={bw.code} value={bw.code}>{bw.label}</MenuItem>
                ))}
              </LabeledField>
              <LabeledField
                label="MCS" hint={`0–${MCS_MAX}`} type="number" value={mcs}
                inputProps={{ min: MCS_MIN, max: MCS_MAX, step: 1 }}
                {...validation(String(mcs), mcsValid, `A whole number, ${MCS_MIN}–${MCS_MAX}`, 'mcs')}
                onChange={(e) => setMcs(Number(e.target.value))}
              />
              <LabeledField
                label="Resource blocks" hint={`1–${maxRb}`} type="number" value={rbCount}
                inputProps={{ min: 1, max: maxRb, step: 1 }}
                {...validation(String(rbCount), rbValid, `1–${maxRb} in a ${bandwidthLabel(bandwidth)} channel`, 'rb')}
                onChange={(e) => setRbCount(Number(e.target.value))}
              />
              {/* Exposed here and nowhere else. The byte order of this field
                  and nb_index is the one part of the frame the captures do not
                  pin — both carry 0 — so anything other than 0 is unverified
                  against hardware, and an unattended sweep is the wrong place
                  to find that out. */}
              <LabeledField
                label="First block" hint={`0–${Math.max(0, maxRb - rbCount)}`}
                type="number" value={rbStart}
                inputProps={{ min: 0, max: Math.max(0, maxRb - rbCount), step: 1 }}
                {...validation(String(rbStart), rbStartValid, `${rbCount} blocks from here runs past the ${maxRb} in the channel`, 'rbStart')}
                onChange={(e) => setRbStart(Number(e.target.value))}
              />
            </FieldGrid>
          </Section>

          <MeasurementCard
            freqHz={channel?.freqHz}
            triggerId={measureTrigger}
            targetDbm={powerValid ? asNum(power) : null}
          />

          <LastFrameSection result={last} />
        </PageBody>
      </Box>

      <Box
        sx={{
          mt: 2, flexGrow: 1, minHeight: 0, flexDirection: 'column',
          display: tab === 'automation' ? 'flex' : 'none',
        }}
      >
        <AutomationPanel
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
