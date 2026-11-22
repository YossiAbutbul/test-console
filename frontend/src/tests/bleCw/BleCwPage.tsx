import { PowerSourceFields } from '../../components/PowerSourceFields'
import {
  powerSourceOf, powerSourceValid, type PowerSourceState,
} from '../../lib/powerSource'
import { useEffect, useRef, useState } from 'react'
import { Box, Stack, Tab } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { MeasurementCard } from '../../components/MeasurementCard'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { useLog } from '../../context/LogContext'
import { useDutToast } from '../../context/dutToast'
import { sleep } from '../../lib/async'
import { DEFAULT_SETTLE_MS } from '../../lib/settle'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { BleWrite } from '../../types/models'
import type { TestPageProps } from '../types'
import { useChatSource } from '../../context/ChatContext'
import { mA, statusOf } from '../../lib/chatRows'
import {
  FieldGrid, LastFrameSection, MeasureOptions, PageBody, RunControls, Section,
  SegmentedChoice, SendStopControls, measuresAnything, requiredInstruments,
  type MeasureSelection, DenseTabs,
} from '../../ui'
import { BleLinkStatus } from '../ble/BleLinkStatus'
import { asFrame } from '../ble/frame'
import {
  CHANNEL_MAX, DURATION_MAX_S, DURATION_MIN_S, POWER_PARAM_MAX, POWER_PARAM_MIN,
  channelFromMhz, channelMhz, isChannel, isDuration, isPowerParam, offAirReason,
} from '../ble/radio'
import { useBleLink } from '../ble/useBleLink'
import type { MeasureResponse } from '../../api/instruments'
import { BleAutomationPanel, type AutomationControls } from './BleAutomationPanel'
import { convertChannelSpec, minToneSeconds } from './plan'
import {
  bleCwPageSnapshot, persistBleCwPage, type BleChannelUnit, type BleCwPageTab,
} from '../../store/bleCwPageStore'

/**
 * BLE CW transmit -- manual and automation.
 *
 * The radio under test is the one our commands arrive on, so both of its test
 * commands take the DUT off the link (see `tests/ble/useBleLink`):
 *
 *     Send   ->  (TX_POWER_GET; differs?  TX_POWER_SET -> SAVE_AND_RESET
 *                 -> relink -> TX_POWER_GET to confirm)
 *                -> TEST_TONE_START -> settle -> measure
 *                -> wait out the duration -> relink
 *     Run    ->  per power:    TX_POWER_SET -> SAVE_AND_RESET -> relink
 *                              -> TX_POWER_GET to confirm
 *                per channel:  TEST_TONE_START -> settle -> measure
 *                              -> wait out the duration -> relink
 *
 * There is no Stop for a tone: there is no link to send one over, and the DUT
 * will not take a connection while it transmits. The Stop key is kept, greyed,
 * so the header has the same shape as every other TX page; the status beside
 * it says what is happening and how long is left.
 *
 * The power is the firmware's own parameter (6-31), never dBm, here and in the
 * exports -- there is no conversion to get wrong.
 */

/** What the manual tab reads back by default; see the LTE CW page. */
const DEFAULT_MEASURE: MeasureSelection = { power: true, current: true }

/** The values of the first supplied frame -- known to be well-formed. */
const DEFAULTS = { channel: '22', power: '31', seconds: '10', offset: '0' }

/** Milliseconds from now until `t`, never negative; 0 for no time. */
const msUntil = (t: number | null): number => (t == null ? 0 : Math.max(0, t - Date.now()))
/** The wall clock, out of line so it is read when called, not in render. */
const epochNow = (): number => Date.now()

function man(): NonNullable<typeof bleCwPageSnapshot.manual> {
  if (!bleCwPageSnapshot.manual) bleCwPageSnapshot.manual = {}
  return bleCwPageSnapshot.manual
}

export function BleCwPage({ protocol, group, active }: TestPageProps) {
  const { log } = useLog()
  const dutToast = useDutToast()

  const [unit, setUnit] = useState<BleChannelUnit>(() => bleCwPageSnapshot.unit ?? 'channel')
  useEffect(() => { bleCwPageSnapshot.unit = unit; persistBleCwPage() }, [unit])

  const [channel, setChannel] = useState(() => man().channel ?? (
    unit === 'mhz' ? String(channelMhz(Number(DEFAULTS.channel))) : DEFAULTS.channel
  ))
  const [power, setPower] = useState(() => man().power ?? DEFAULTS.power)
  const [seconds, setSeconds] = useState(() => man().seconds ?? DEFAULTS.seconds)
  const [offset, setOffset] = useState(() => man().offset ?? DEFAULTS.offset)
  useEffect(() => { man().channel = channel; persistBleCwPage() }, [channel])
  useEffect(() => { man().power = power; persistBleCwPage() }, [power])
  useEffect(() => { man().seconds = seconds; persistBleCwPage() }, [seconds])
  useEffect(() => { man().offset = offset; persistBleCwPage() }, [offset])

  // The run lives in BleAutomationPanel; the snapshot is where it mirrors
  // every row, so the assistant reads that rather than the panel's state.
  useChatSource('BLE CW', !!active, () => ({
    title: 'BLE CW automation results',
    rows: (bleCwPageSnapshot.automation?.results ?? []).map((r, i) => ({
      '#': i + 1,
      Channel: r.channel,
      'Freq (MHz)': r.freq_mhz,
      'Power param': r.power_param,
      'Measured (dBm)': r.measured_dbm,
      'CC (mA)': mA(r.current_a),
      'V (V)': r.voltage_v,
      Verdict: r.verdict,
      Status: statusOf(r),
    })),
  }))

  const [last, setLast] = useState<BleWrite | null>(null)
  const [measureTrigger, setMeasureTrigger] = useState(0)
  /** Resolves the Send's wait for the card's reading -- see `send`. */
  const readDone = useRef<(() => void) | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [measure, setMeasure] = useState<MeasureSelection>(
    () => bleCwPageSnapshot.manualMeasure ?? DEFAULT_MEASURE,
  )
  useEffect(() => { bleCwPageSnapshot.manualMeasure = measure; persistBleCwPage() }, [measure])
  const [powerSrc, setPowerSrc] = useState<PowerSourceState>(
    () => powerSourceOf(bleCwPageSnapshot.manualPowerSource),
  )
  useEffect(() => { bleCwPageSnapshot.manualPowerSource = powerSrc; persistBleCwPage() }, [powerSrc])
  const sourceOk = !measure.power || powerSourceValid(powerSrc)
  const willMeasure = measuresAnything(measure)
  const preflight = useInstrumentPreflight(requiredInstruments(measure, powerSrc.source), { verb: 'send' })

  const [tab, setTab] = useState<BleCwPageTab>(() => bleCwPageSnapshot.tab ?? 'manual')
  useEffect(() => { bleCwPageSnapshot.tab = tab; persistBleCwPage() }, [tab])

  const [autoCtl, setAutoCtl] = useState<AutomationControls | null>(null)

  const link = useBleLink({ onFrame: setLast, pageId: 'ble-cw' })

  const asNum = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const resolvedChannel = (() => {
    const v = asNum(channel)
    if (!Number.isFinite(v)) return null
    if (unit === 'channel') return isChannel(v) ? v : null
    return channelFromMhz(v)
  })()
  const channelValid = resolvedChannel != null
  const powerValid = isPowerParam(asNum(power))
  // A tone the reading cannot land inside measures the noise floor and
  // shows it as the DUT's power, so with a measurement asked for the floor is
  // the settle plus the read, not the frame's 1 s.
  const toneMin = willMeasure ? minToneSeconds(DEFAULT_SETTLE_MS) : DURATION_MIN_S
  const secondsValid = isDuration(asNum(seconds)) && asNum(seconds) >= toneMin
  const offsetValid = (() => {
    const v = asNum(offset)
    return Number.isInteger(v) && v >= 0 && v <= 0xFF
  })()
  const canSend = channelValid && powerValid && secondsValid && offsetValid && sourceOk

  /** Shows the *other* unit, so the field always states what it resolved to. */
  const channelHint = (): string => {
    if (resolvedChannel == null) return unit === 'channel' ? `0–${CHANNEL_MAX}` : 'MHz'
    return unit === 'channel' ? `${channelMhz(resolvedChannel)} MHz` : `ch ${resolvedChannel}`
  }

  const switchUnit = (next: BleChannelUnit) => {
    setChannel((c) => convertChannelSpec(c, unit, next))
    setUnit(next)
  }

  const send = useMutation({
    mutationFn: async () => {
      // Connect the instruments before keying the radio -- see PowerPage.send.
      if (willMeasure && !(await preflight.run())) {
        log('DUT', 'Send cancelled — instruments not ready', 'warn')
        return
      }
      const ch = resolvedChannel!
      // Only when the DUT is not on it already: a reset is a reboot and a
      // reconnect, and a Send at the same power should not pay for one.
      await link.ensurePower(asNum(power))
      await link.tone({ channel: ch, duration_s: asNum(seconds), offset: asNum(offset) })
      // On landing rather than at the end: the tone, the reading and the
      // relink take the whole duration, and the operator wants to know the
      // DUT took the command now. A refused tone throws instead.
      dutToast.sent(`BLE CW sent · ch ${ch} · ${channelMhz(ch)} MHz · ${asNum(seconds)} s`)
      if (willMeasure) {
        // The card waits its settle and reads; the reconnect waits for that
        // reading (or for the tone to end, if it fails), so the strip is not
        // left mid-read while the page moves on to the relink.
        const answered = new Promise<void>((resolve) => { readDone.current = resolve })
        setMeasureTrigger((n) => n + 1)
        await Promise.race([answered, sleep(msUntil(link.onAirUntil()))])
        readDone.current = null
      }
      // Held until the DUT is back, so the key cannot start a second tone
      // into a DUT that cannot hear it.
      await link.finishTone()
    },
    onError: (e: Error) => {
      log('DUT', `BLE CW failed: ${e.message}`, 'error')
      dutToast.failed('BLE CW', e)
    },
  })

  /**
   * The card's reading, checked against the tone it was meant to catch. The
   * card shows whatever it read, so a reading that finished after the tone is
   * called out in the log rather than left to pass for the DUT's power.
   */
  const onReading = (r: MeasureResponse) => {
    const offAir = offAirReason(epochNow(), link.onAirUntil(), r.t_ms)
    if (offAir) log('DUT', `BLE CW measurement: ${offAir}`, 'warn')
    readDone.current?.()
  }

  const busy = send.isPending || link.busy
  const autoRunning = autoCtl?.running ?? false

  const focusBind = (key: string) => ({
    onFocus: () => setFocusKey(key),
    onBlur: () => setFocusKey((k) => (k === key ? null : k)),
  })
  const validation = (value: string, valid: boolean, msg: string, key: string) => ({
    error: !valid,
    ...focusBind(key),
    InputProps: {
      endAdornment: (
        <ValidationAdornment
          show={shouldShowValidation(value, valid, focusKey === key)}
          message={value.trim() === '' ? 'Enter a value' : msg}
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
            {/* Outside the tabs: one radio, whichever tab drives it. */}
            <BleLinkStatus phase={link.phase} power={link.power} />
            {tab === 'manual' ? (
              <SendStopControls
                busy={busy || autoRunning}
                sending={send.isPending}
                stopping={false}
                canSend={canSend}
                // A tone cannot be stopped -- see the note at the top.
                canStop={false}
                onSend={() => send.mutate()}
                onStop={() => {}}
              />
            ) : autoCtl ? (
              <RunControls
                running={autoCtl.running}
                canRun={autoCtl.canRun && !send.isPending}
                progress={autoCtl.progress}
                onRun={autoCtl.onRun}
                onStop={autoCtl.onStop}
              />
            ) : null}
          </Stack>
        }
      />

      <DenseTabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="manual" label="Manual" />
        <Tab value="automation" label="Automation" />
      </DenseTabs>

      {/* Both panels stay mounted, so a run keeps going on the other tab. */}
      <Box sx={{ display: tab === 'manual' ? 'block' : 'none' }}>
        <PageBody width="fluid">
          <Section
            title="Transmit"
            panel
            action={
              <SegmentedChoice
                value={unit}
                options={[
                  { value: 'channel', label: 'Channel' },
                  { value: 'mhz', label: 'MHz' },
                ]}
                onChange={switchUnit}
                disabled={busy || autoRunning}
              />
            }
          >
            <FieldGrid columns={4}>
              <LabeledField
                label={unit === 'channel' ? 'Channel' : 'Frequency'}
                hint={channelHint()} type="number" value={channel}
                inputProps={unit === 'channel' ? { min: 0, max: CHANNEL_MAX, step: 1 } : { min: 2402, max: 2480, step: 2 }}
                {...validation(
                  channel, channelValid,
                  unit === 'channel' ? `Channels are 0–${CHANNEL_MAX}` : '2402–2480 MHz, even',
                  'channel',
                )}
                onChange={(e) => setChannel(e.target.value)}
              />
              <LabeledField
                label="Power" hint="param" type="number" value={power}
                inputProps={{ min: POWER_PARAM_MIN, max: POWER_PARAM_MAX, step: 1 }}
                {...validation(power, powerValid, `Whole number, ${POWER_PARAM_MIN}–${POWER_PARAM_MAX}`, 'power')}
                onChange={(e) => setPower(e.target.value)}
              />
              <LabeledField
                label="Duration" hint="s" type="number" value={seconds}
                inputProps={{ min: DURATION_MIN_S, max: DURATION_MAX_S, step: 1 }}
                {...validation(
                  seconds, secondsValid,
                  `Whole seconds, ${toneMin}–${DURATION_MAX_S}${willMeasure ? ': the reading must land inside the tone' : ''}`,
                  'seconds',
                )}
                onChange={(e) => setSeconds(e.target.value)}
              />
              <LabeledField
                label="Offset from centre" hint="raw" type="number" value={offset}
                inputProps={{ min: 0, max: 255, step: 1 }}
                {...validation(offset, offsetValid, 'Whole number, 0–255', 'offset')}
                onChange={(e) => setOffset(e.target.value)}
              />
            </FieldGrid>
          </Section>

          <Section title="Measure" panel>
            <Stack spacing={1.75}>
              <MeasureOptions value={measure} onChange={setMeasure} disabled={busy} />
              <PowerSourceFields value={powerSrc} onChange={setPowerSrc} disabled={busy || !measure.power} />
            </Stack>
          </Section>

          {willMeasure && (
            <MeasurementCard
              freqHz={resolvedChannel == null ? undefined : channelMhz(resolvedChannel) * 1e6}
              triggerId={measureTrigger}
              onResult={onReading}
              // The power is a firmware param, not a level to compare against.
              targetDbm={null}
              wants={measure}
              powerSource={powerSrc}
            />
          )}

          <LastFrameSection
            result={last ? asFrame(last) : null}
            unanswered={last != null && !last.acknowledged}
          />
        </PageBody>
      </Box>

      <Box
        sx={{
          mt: 1, flexGrow: 1, minHeight: 0, flexDirection: 'column',
          display: tab === 'automation' ? 'flex' : 'none',
        }}
      >
        <BleAutomationPanel
          link={link}
          unit={unit}
          onUnitChange={switchUnit}
          blocked={send.isPending}
          onControlsChange={setAutoCtl}
        />
      </Box>

      {preflight.dialog}
    </Box>
  )
}
