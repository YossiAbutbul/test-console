import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, CircularProgress, Dialog, DialogContent, Stack, Tab, Tabs, Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import {
  DEFAULT_BANDS, uplinkFromEarfcn, uplinkFromMhz, type UplinkMatch,
} from '../../lib/earfcn'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { CommandResponse, LteCwRequest } from '../../types/models'
import type { TestPageProps } from '../types'
import TuneIcon from '@mui/icons-material/Tune'
import { IconButton, Tooltip } from '@mui/material'
import {
  FieldGrid, LastFrameSection, LatchingKey, PageBody, RunControls, Section,
  SegmentedChoice, SendStopControls,
} from '../../ui'
import { BandsModal } from './BandsModal'
import { STORAGE_KEYS } from '../../store/keys'
import { usePersistedState } from '../../store/persistent'
import {
  LteAutomationPanel, type AutomationControls, type ModemControl,
} from './LteAutomationPanel'
import {
  lteCwPageSnapshot, persistLteCwPage, type ChannelUnit, type LteCwPageTab,
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
 * The abort in the middle of Send is not optional: the modem takes one test at
 * a time and drops a START that arrives while another is running, which looks
 * like a command that succeeded but changed nothing.
 *
 * Modem power and the live test are held here rather than in either tab,
 * because they describe one piece of hardware that both tabs drive. A panel
 * with its own copy would send a MODEM_ON the other tab had already sent, and
 * the modem refuses that.
 */

/** Both tabs measure what they transmit, so both need these up. */
const REQUIRED_INSTRUMENTS: InstrumentId[] = ['power-sensor', 'dc-analyzer']

/** The modem's ceiling; mirrors MAX_TX_POWER_DBM on the backend. */
const MAX_POWER_DBM = 23

/** Defaults are the values from the captured frames, so the page opens on
 *  something known to be well-formed rather than on zeros. */
const DEFAULTS = { earfcn: '18900', seconds: '200', power: '23', offset: '0' }

export function LteCwPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const [earfcn, setEarfcn] = useState(DEFAULTS.earfcn)
  const [seconds, setSeconds] = useState(DEFAULTS.seconds)
  const [power, setPower] = useState(DEFAULTS.power)
  const [offset, setOffset] = useState(DEFAULTS.offset)
  const [last, setLast] = useState<CommandResponse | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const preflight = useInstrumentPreflight(REQUIRED_INSTRUMENTS, { verb: 'send' })

  const [tab, setTab] = useState<LteCwPageTab>(() => lteCwPageSnapshot.tab ?? 'manual')
  useEffect(() => { lteCwPageSnapshot.tab = tab; persistLteCwPage() }, [tab])

  /**
   * Whether channel inputs are read as EARFCNs or as MHz, and which bands a
   * MHz value is allowed to mean.
   *
   * The bands setting is what makes the MHz direction possible at all: uplink
   * bands overlap, so 1880 MHz is a channel in bands 2, 25 and 39 with a
   * different EARFCN in each. Narrowing to the bands this rig tests leaves one
   * answer. Both tabs share it — it describes the lab, not a tab.
   */
  const [unit, setUnit] = useState<ChannelUnit>(() => lteCwPageSnapshot.channelUnit ?? 'earfcn')
  useEffect(() => { lteCwPageSnapshot.channelUnit = unit; persistLteCwPage() }, [unit])
  const [bands, setBands] = usePersistedState<number[]>(STORAGE_KEYS.lteBands, DEFAULT_BANDS)
  const [bandsOpen, setBandsOpen] = useState(false)
  // The automation tab owns its run; it publishes just enough for the header
  // to render the buttons in the same slot the manual tab uses.
  const [autoCtl, setAutoCtl] = useState<AutomationControls | null>(null)

  /**
   * What we believe the modem's power state to be.
   *
   * Only ever a belief: the DUT will not report it, and this resets on every
   * page load while the hardware keeps running, so drift is routine rather
   * than exceptional. A redundant MODEM_ON is *not* free — the modem refuses
   * it — so when a power command fails the belief moves to `true`, which is
   * the state the operator can act on: the key then offers MODEM_OFF, and off
   * then on is a way back to somewhere known.
   *
   * Mirrored into a ref because an automation run spans many renders and reads
   * it long after the one it started in.
   */
  const [modemOn, setModemOnState] = useState(false)
  const modemOnRef = useRef(false)
  const setModemOn = useCallback((v: boolean) => {
    modemOnRef.current = v
    setModemOnState(v)
  }, [])

  /**
   * Parameters of the test currently running, or null if none is.
   *
   * A ref, not state: nothing renders from it, and a run reads it across many
   * renders. Holding the parameters rather than a bare flag means an abort can
   * name the test it is stopping, even if the form has been edited since.
   */
  const runningRef = useRef<LteCwRequest | null>(null)

  /**
   * True only while a MODEM_ON frame is actually in flight.
   *
   * Set explicitly rather than derived from the mutations' pending flags:
   * those are also true while Send is still in its instrument preflight, and
   * `!modemOn` is briefly true midway through a power-*off* — either would put
   * "Turning on modem" on screen when nothing is being turned on.
   */
  const [startingModem, setStartingModem] = useState(false)

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
   * automation rows hold range specs and are deliberately left alone — a MHz
   * range stepping by 1 is not the same set of channels as an EARFCN range
   * stepping by 1, so "converting" one would quietly change the sweep.
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

  /** Power the modem up and record it. Shared by the key, Send and a run. */
  const startModem = useCallback(async () => {
    setStartingModem(true)
    try {
      const on = await device.lteModemOn()
      setLast(on)
      log('DUT', `LTE modem on: ok=${on.ok} status=${on.status} · rx ${on.rx_hex}`)
      // Held on even when it refuses.
      //
      // We cannot read the modem's power state back from the DUT, and a
      // refusal tells us nothing about which state it is in — the likeliest
      // reasons are that it is already up, or busy with a test that outlived
      // the page. Recording it as off would leave the key offering the one
      // command that just failed, with no way to send MODEM_OFF and get back
      // to a known state. On is the state the operator can act on.
      setModemOn(true)
      runningRef.current = null
      if (!on.ok) {
        throw new Error(
          `modem on rejected (status ${on.status}). `
          + 'It may already be on, or still running a test — power it off and on again.',
        )
      }
    } finally {
      setStartingModem(false)
    }
  }, [log, setModemOn])

  /**
   * Power-cycle the modem, for the start of an automation run.
   *
   * Down first and unconditionally, rather than skipping the boot when we
   * think it is already up. Our idea of the power state is only a belief — it
   * resets on every page load while the hardware keeps running — and a test
   * left over from the manual tab or an earlier session would otherwise
   * survive into the run and swallow the first point's START. A ~10 s boot
   * once per run is a cheap price for starting from a known modem.
   */
  const cycleModem = useCallback(async () => {
    try {
      const off = await device.lteModemOff()
      log('DUT', `LTE modem off (run start): ok=${off.ok} status=${off.status}`)
    } catch (e) {
      // Ignored on purpose: the likeliest reason it refused is that the modem
      // was already down, which is where this was trying to get to.
      log('DUT', `LTE modem off (run start) failed: ${(e as Error).message}`, 'warn')
    }
    setModemOn(false)
    runningRef.current = null
    await startModem()
  }, [log, setModemOn, startModem])

  const modem: ModemControl = useMemo(() => ({
    on: modemOn,
    cycle: cycleModem,
    getRunning: () => runningRef.current,
    setRunning: (r: LteCwRequest | null) => { runningRef.current = r },
  }), [modemOn, cycleModem])

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) return startModem()
      const off = await device.lteModemOff()
      setLast(off)
      log('DUT', `LTE modem off: ok=${off.ok} status=${off.status} · rx ${off.rx_hex}`)
      // Recorded as off even on a non-zero status: the frame went out, and
      // claiming it is still on would make the next Send skip a MODEM_ON it
      // may well need.
      setModemOn(false)
      runningRef.current = null
    },
    onError: (e: Error) => log('DUT', `LTE modem toggle failed: ${e.message}`, 'error'),
  })

  const send = useMutation({
    mutationFn: async () => {
      // Connect before keying the PA — see PowerPage.send.
      if (!(await preflight.run())) {
        log('DUT', 'Send cancelled — instruments not ready', 'warn')
        return null
      }
      // Sending with the modem down is a normal way to work, not a mistake, so
      // bring it up rather than refusing. The dialog covers the ~10 s wait.
      if (!modemOnRef.current) await startModem()
      // The modem takes one test at a time: a START arriving while another is
      // running is ignored, and the symptom is a command that reports fine
      // while the radio stays on the old parameters. So retune by aborting
      // first. Aborted with the *running* test's parameters rather than
      // whatever is in the form now, since those are what it was started with.
      const live = runningRef.current
      if (live) {
        const prev = await device.lteCw({ ...live, start: false })
        log('DUT', `LTE CW abort (previous test): ok=${prev.ok} status=${prev.status}`)
        runningRef.current = null
      }
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
      runningRef.current = r.params
      setMeasureTrigger((n) => n + 1)
    },
    // No power-down here. The modem may well be up with the command having
    // failed; it stays up so the operator can fix the parameters and retry
    // without waiting for another boot.
    onError: (e: Error) => log('DUT', `LTE CW failed: ${e.message}`, 'error'),
  })

  const stop = useMutation({
    // Falls back to the form when nothing is known to be running — Stop is a
    // safety control, so it stays useful even if our idea of the state is off.
    mutationFn: () => device.lteCw({ ...(runningRef.current ?? req()), start: false }),
    onSuccess: (r) => {
      setLast(r)
      runningRef.current = null
      log('DUT', `LTE CW abort: ok=${r.ok} status=${r.status}`)
    },
    onError: (e: Error) => log('DUT', `LTE stop failed: ${e.message}`, 'error'),
  })

  const busy = send.isPending || stop.isPending || toggle.isPending
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
              value={modemOn}
              disabled={busy || autoRunning}
              offLabel="Modem off"
              onLabel="Modem on"
              onChange={(next) => toggle.mutate(next)}
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
                canStop={modemOn}
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

      <Dialog open={startingModem} maxWidth="xs">
        <DialogContent>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={22} />
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                Turning on modem
              </Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                A radio boot takes a few seconds.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

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
