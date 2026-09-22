import { useCallback, useEffect, useState } from 'react'
import { Box, Button, MenuItem, Select, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import {
  BAUD_RATES, DEFAULT_BAUD, signalGeneratorApi,
  type SignalGeneratorSettings, type SignalGeneratorState,
} from '../../api/signalGenerator'
import type { DiscoverCandidate } from '../../api/instruments'
import {
  useInstrumentValue, useInstrumentsActions,
} from '../../context/InstrumentsContext'
import { useLog } from '../../context/LogContext'
import { DASH, fmt } from '../../lib/format'
import {
  FieldGrid, InstrumentBar, MONO, PageBody, Section, StatRow, StatTile, TEXT,
} from '../../ui'
import type { TestPageProps } from '../types'
import {
  persistSignalGeneratorPage, signalGeneratorPageSnapshot,
} from '../../store/signalGeneratorPageStore'

/**
 * How often the panel re-reads the instrument while it is on screen.
 *
 * The generator has a front panel and someone standing at it: without a poll
 * the read-back would show what the app last set rather than what the box is
 * doing. Four short queries at 9600 baud cost a few milliseconds, so this can
 * be brisk without loading the port.
 */
const POLL_MS = 2500

/** SML03 data sheet, and the bounds the backend enforces. */
const FREQ_MIN_MHZ = 0.009
const FREQ_MAX_MHZ = 3300
const LEVEL_MIN_DBM = -145
const LEVEL_MAX_DBM = 20

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * The R&S SML03 signal generator.
 *
 * Three settings and a switch — frequency, level, RF on — which is the whole
 * instrument as far as this bench uses it. Everything shown under "Instrument"
 * is read back from the generator rather than remembered from the last write,
 * because it has a front panel and the operator may well have turned a knob.
 *
 * The RF button is the one control here that changes the world: it keys a
 * source into a live bench. Switching on sends the typed frequency and level
 * with it in a single request, which the backend orders so both land before
 * the output does — pressing it can then never key the previous setting.
 */
export function SignalGeneratorPage({ group, active }: TestPageProps) {
  const { log } = useLog()
  const gen = useInstrumentValue('signal-generator')
  const { connect, disconnect, setAddress, setChannel, discover } = useInstrumentsActions()

  const [ports, setPorts] = useState<DiscoverCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [st, setSt] = useState<SignalGeneratorState | null>(null)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  const [freqMhz, setFreqMhz] = useState(
    () => signalGeneratorPageSnapshot.freqMhz ?? '',
  )
  const [levelDbm, setLevelDbm] = useState(
    () => signalGeneratorPageSnapshot.levelDbm ?? '',
  )
  useEffect(() => {
    signalGeneratorPageSnapshot.freqMhz = freqMhz
    signalGeneratorPageSnapshot.levelDbm = levelDbm
    persistSignalGeneratorPage()
  }, [freqMhz, levelDbm])

  const connected = gen.status === 'connected'
  const port = gen.address
  const baud = gen.channel ?? DEFAULT_BAUD

  // The port and rate live in the shared instrument row so the Instruments
  // panel opens the same generator this page does — but they have to survive a
  // reload, which that row does not do.
  useEffect(() => {
    const saved = signalGeneratorPageSnapshot
    if (saved.port && !gen.address) setAddress('signal-generator', saved.port)
    if (saved.baud && gen.channel == null) setChannel('signal-generator', saved.baud)
    // Once, to seed the row — later edits flow the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setPorts(await discover('signal-generator'))
    } catch (e) {
      setFault((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [discover])

  const refresh = useCallback(async () => {
    try {
      const s = await signalGeneratorApi.state()
      setSt(s)
      setFault(null)
    } catch (e) {
      setFault((e as Error).message)
    }
  }, [])

  /**
   * List the ports whenever the page comes forward. Naming a COM port from
   * memory is exactly the mistake this avoids, and a cable plugged in since
   * the last visit should show up without being asked for.
   *
   * Silent, unlike the Scan button: this one is not something the operator
   * started, so a progress state for it would be reporting on itself. Listing
   * ports opens none of them, so it is free to run on every visit.
   */
  useEffect(() => {
    if (!active) return
    let cancelled = false
    discover('signal-generator')
      .then((found) => { if (!cancelled) setPorts(found) })
      .catch(() => { /* the Scan button is where a scan reports failure */ })
    return () => { cancelled = true }
  }, [active, discover])

  /**
   * Keep the read-back honest while the page is watching.
   *
   * Gated on `active`: every page stays mounted, so an ungated poll would hold
   * the serial port open from a screen nobody is looking at, and lose races
   * with whatever the operator moved on to.
   */
  useEffect(() => {
    if (!active || !connected) return
    let cancelled = false
    let timer: number | undefined
    const loop = async () => {
      if (cancelled) return
      await refresh()
      if (cancelled) return
      timer = window.setTimeout(loop, POLL_MS)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active, connected, refresh])

  const onConnect = async () => {
    setFault(null)
    const r = await connect('signal-generator')
    if (r.ok) {
      signalGeneratorPageSnapshot.port = port
      signalGeneratorPageSnapshot.baud = baud
      persistSignalGeneratorPage()
      log('Signal Gen', `Connected on ${port} at ${baud} baud`)
      await refresh()
    } else {
      log('Signal Gen', `Connect failed: ${r.failure?.raw ?? r.failure?.title ?? 'unknown'}`, 'error')
    }
  }

  const onDisconnect = async () => {
    await disconnect('signal-generator')
    setSt(null)
  }

  /** Send `settings`, then show whatever the instrument reports back. */
  const send = async (settings: SignalGeneratorSettings, what: string) => {
    setBusy(true)
    setFault(null)
    try {
      const s = await signalGeneratorApi.apply(settings)
      setSt(s)
      // The instrument's own error queue outranks a clean HTTP response: the
      // command was accepted by the port and refused by the generator.
      if (s.error) log('Signal Gen', `${what} — instrument says ${s.error}`, 'error')
      else log('Signal Gen', what)
    } catch (e) {
      const msg = (e as Error).message
      setFault(msg)
      log('Signal Gen', `${what} failed: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const typedFreq = numOrNull(freqMhz)
  const typedLevel = numOrNull(levelDbm)
  /** What the fields hold, as a settings payload. */
  const typed: SignalGeneratorSettings = {
    ...(typedFreq != null ? { freq_hz: Math.round(typedFreq * 1e6) } : {}),
    ...(typedLevel != null ? { level_dbm: typedLevel } : {}),
  }

  const liveFreqMhz = st?.freq_hz == null ? null : st.freq_hz / 1e6
  // Compared loosely: the instrument answers its own rounding, so an exact
  // match would mark every applied setting as still pending.
  const freqPending = typedFreq != null && liveFreqMhz != null
    && Math.abs(typedFreq - liveFreqMhz) > 1e-6
  const levelPending = typedLevel != null && st?.level_dbm != null
    && Math.abs(typedLevel - st.level_dbm) > 0.01
  const pending = freqPending || levelPending

  // The port in use stays selectable even when the last listing missed it, so
  // the Config dialog never shows a blank port for an open session.
  const portOptions: DiscoverCandidate[] = port && !ports.some((p) => p.resource === port)
    ? [{ resource: port, idn: null }, ...ports]
    : ports

  const rfOn = st?.rf_on === true
  const canSend = connected && !busy

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="Signal Generator"
        actions={
          <Button
            variant={rfOn ? 'outlined' : 'contained'}
            color={rfOn ? 'error' : 'primary'}
            disabled={!canSend}
            startIcon={<PowerSettingsNewIcon sx={{ fontSize: 16 }} />}
            // Switching on carries the typed settings so they land first; the
            // backend keys the output last. Switching off carries nothing —
            // the only thing wanted then is for the output to stop.
            onClick={() => void send(
              rfOn ? { rf_on: false } : { ...typed, rf_on: true },
              rfOn ? 'RF off' : 'RF on',
            )}
            sx={{ minWidth: 130, height: 36 }}
          >
            {rfOn ? 'RF Off' : 'RF On'}
          </Button>
        }
      />

      <PageBody width="fluid">
        <InstrumentBar
          name="Signal generator"
          model="R&S SML03"
          status={gen.status}
          detail={gen.idn}
          summary={port ? `${port} · ${baud} baud` : null}
          configReady={!!port}
          onConnect={() => void onConnect()}
          onDisconnect={() => void onDisconnect()}
          config={
            <>
              <Box>
                <Typography sx={{ ...TEXT.dense, color: 'text.secondary', mb: 0.75 }}>Port</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Select
                    size="small"
                    fullWidth
                    value={portOptions.some((p) => p.resource === port) ? port : ''}
                    displayEmpty
                    disabled={connected}
                    onChange={(e) => setAddress('signal-generator', String(e.target.value))}
                    sx={{ '& .MuiSelect-select': { fontSize: 12.5 } }}
                  >
                    <MenuItem value="" disabled>
                      {scanning ? 'Scanning…' : 'Select a port'}
                    </MenuItem>
                    {portOptions.map((p) => (
                      <MenuItem key={p.resource} value={p.resource} sx={{ fontSize: 12.5 }}>
                        {p.resource}
                        {p.detail && (
                          <Typography component="span" sx={{ ml: 1, fontSize: 11, color: 'text.secondary' }}>
                            {p.detail}
                          </Typography>
                        )}
                      </MenuItem>
                    ))}
                  </Select>
                  <Button
                    size="small"
                    onClick={() => void scan()}
                    disabled={scanning || connected}
                    startIcon={<RefreshIcon sx={{ fontSize: 15 }} />}
                    sx={{ minWidth: 0 }}
                  >
                    Scan
                  </Button>
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ ...TEXT.dense, color: 'text.secondary', mb: 0.75 }}>Baud</Typography>
                <Select
                  size="small"
                  value={baud}
                  disabled={connected}
                  onChange={(e) => setChannel('signal-generator', Number(e.target.value))}
                  sx={{ width: 120, '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5 } }}
                >
                  {BAUD_RATES.map((b) => (
                    <MenuItem key={b} value={b} sx={{ fontFamily: MONO, fontSize: 12.5 }}>{b}</MenuItem>
                  ))}
                </Select>
                <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 0.75 }}>
                  The rate must match Utilities → System → RS232 on the instrument, over a null-modem cable.
                </Typography>
              </Box>
            </>
          }
        />

        <Box>
          <Section title="Output" panel>
            <FieldGrid columns={2}>
              <LabeledField
                label="Frequency" hint="MHz" type="number"
                value={freqMhz}
                onChange={(e) => setFreqMhz(e.target.value)}
                inputProps={{ step: 0.1, min: FREQ_MIN_MHZ, max: FREQ_MAX_MHZ }}
                sx={{ '& input': { fontFamily: MONO } }}
              />
              <LabeledField
                label="Level" hint="dBm" type="number"
                value={levelDbm}
                onChange={(e) => setLevelDbm(e.target.value)}
                inputProps={{ step: 0.5, min: LEVEL_MIN_DBM, max: LEVEL_MAX_DBM }}
                sx={{ '& input': { fontFamily: MONO } }}
              />
            </FieldGrid>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
              <Button
                variant={pending ? 'contained' : 'outlined'}
                disabled={!canSend || (typed.freq_hz == null && typed.level_dbm == null)}
                onClick={() => void send(typed, 'Applied frequency and level')}
                sx={{ minWidth: 120, height: 34 }}
              >
                Apply
              </Button>
              {/* Named rather than implied: the fields hold what was typed, and
                  the instrument holds what was sent. Without this the two look
                  like one value that has quietly failed to take. */}
              {pending && (
                <Typography sx={{ ...TEXT.micro, color: 'warning.main', fontWeight: 600 }}>
                  not sent yet
                </Typography>
              )}
              {rfOn && (
                <Typography sx={{ ...TEXT.micro, color: 'error.main', fontWeight: 600 }}>
                  RF is live
                </Typography>
              )}
            </Stack>
          </Section>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Section title="Instrument" panel flush>
            <StatRow>
              <StatTile
                label="Frequency"
                value={liveFreqMhz == null ? DASH : fmt(liveFreqMhz, 3)}
                unit="MHz"
                off={!connected}
              />
              <StatTile
                label="Level"
                value={fmt(st?.level_dbm ?? null, 2)}
                unit="dBm"
                off={!connected}
              />
              <StatTile
                label="RF output"
                value={st?.rf_on == null ? DASH : rfOn ? 'ON' : 'OFF'}
                tone={rfOn ? 'bad' : undefined}
                off={!connected}
              />
            </StatRow>
            {(st?.error || fault) && (
              <Typography sx={{ ...TEXT.micro, color: 'error.main', mt: 1.5, fontFamily: MONO }}>
                {st?.error ?? fault}
              </Typography>
            )}
          </Section>
        </Box>
      </PageBody>
    </Box>
  )
}
