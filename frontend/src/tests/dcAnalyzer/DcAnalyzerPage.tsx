import { useCallback, useEffect, useState } from 'react'
import { Box, Button, MenuItem, Select, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import {
  dcAnalyzerApi, MAX_CURRENT_LIMIT_A, MAX_VOLTAGE_V,
  type DcAnalyzerSettings, type DcAnalyzerState,
} from '../../api/dcAnalyzer'
import type { DiscoverCandidate } from '../../api/instruments'
import {
  pickCandidate, useInstrumentValue, useInstrumentsActions,
} from '../../context/InstrumentsContext'
import { filterCandidates } from '../../lib/instrumentCandidates'
import { useLog } from '../../context/LogContext'
import { DASH, fmt } from '../../lib/format'
import {
  FieldGrid, InstrumentBar, MONO, PageBody, Section, StatRow, StatTile, TEXT,
} from '../../ui'
import type { TestPageProps } from '../types'
import { dcAnalyzerPageSnapshot, persistDcAnalyzerPage } from '../../store/dcAnalyzerPageStore'

/**
 * How often the panel re-reads the analyzer while it is on screen.
 *
 * Brisker than the signal generator's: this page is also where the operator
 * watches the DUT's current, and a reading a few seconds stale hides exactly
 * the step they are looking for. Nine short queries over USB are ~0.3 s, so a
 * second leaves the bus idle most of the time.
 */
const POLL_MS = 1000

const CHANNELS = [1, 2, 3, 4]

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * The Keysight N6705B DC power analyzer, as a supply and meter for the DUT.
 *
 * One channel — the one it was connected with, which every test also measures
 * on — so what is set here is what the tests see. Everything under
 * "Instrument" is read back from the analyzer rather than remembered from the
 * last write, because it has a front panel and the Settings menu can switch
 * the same output.
 *
 * The Output button is the control that changes the world: it powers the DUT.
 * Switching on carries the typed voltage and limit in the same request, which
 * the backend orders so both land before the output does — pressing it can
 * then never power up at the previous setting.
 */
export function DcAnalyzerPage({ group, active }: TestPageProps) {
  const { log } = useLog()
  const dc = useInstrumentValue('dc-analyzer')
  const { connect, disconnect, setAddress, setChannel, discover } = useInstrumentsActions()

  const [resources, setResources] = useState<DiscoverCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [st, setSt] = useState<DcAnalyzerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  const [voltage, setVoltage] = useState(() => dcAnalyzerPageSnapshot.voltageV ?? '3.6')
  const [limit, setLimit] = useState(() => dcAnalyzerPageSnapshot.currentLimitA ?? '')
  useEffect(() => {
    dcAnalyzerPageSnapshot.voltageV = voltage
    dcAnalyzerPageSnapshot.currentLimitA = limit
    persistDcAnalyzerPage()
  }, [voltage, limit])

  const connected = dc.status === 'connected'
  const channel = dc.channel ?? 3

  /**
   * List the VISA resources that could be this analyzer — the VNA shares the
   * bus and would otherwise be offered too — and preselect the N6705 when no
   * address is chosen yet, the same way the Instruments panel does.
   */
  const address = dc.address
  const offer = useCallback((raw: DiscoverCandidate[]) => {
    const found = filterCandidates('dc-analyzer', raw)
    setResources(found)
    if (!address) {
      const pick = pickCandidate('dc-analyzer', found)
      if (pick) setAddress('dc-analyzer', pick.resource)
    }
  }, [address, setAddress])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      offer(await discover('dc-analyzer'))
    } catch (e) {
      setFault((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [discover, offer])

  // List the analyzers when the page comes forward and nothing is connected.
  // Discovery opens each VISA resource for *IDN?, so it is skipped while
  // connected: there is nothing to choose then, and no reason to probe.
  useEffect(() => {
    if (!active || connected) return
    let cancelled = false
    discover('dc-analyzer')
      .then((found) => { if (!cancelled) offer(found) })
      .catch(() => { /* the Scan button is where a scan reports failure */ })
    return () => { cancelled = true }
    // Once per visit; `offer` changes identity whenever the address does, and
    // re-probing the bus on every pick would be a scan nobody asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connected, discover])

  const refresh = useCallback(async () => {
    try {
      setSt(await dcAnalyzerApi.state())
      setFault(null)
    } catch (e) {
      setFault((e as Error).message)
    }
  }, [])

  // Gated on `active`: every page stays mounted, and an ungated poll would
  // queue on the analyzer's bus from a screen nobody is looking at — in front
  // of the reads a running test is waiting on.
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
    const r = await connect('dc-analyzer')
    if (r.ok) {
      log('DC Analyzer', `Connected on channel ${channel}`)
      await refresh()
    } else {
      log('DC Analyzer', `Connect failed: ${r.failure?.raw ?? r.failure?.title ?? 'unknown'}`, 'error')
    }
  }

  const onDisconnect = async () => {
    await disconnect('dc-analyzer')
    setSt(null)
  }

  /** Send `settings`, then show whatever the analyzer reports back. */
  const send = async (settings: DcAnalyzerSettings, what: string) => {
    setBusy(true)
    setFault(null)
    try {
      const s = await dcAnalyzerApi.apply(settings)
      setSt(s)
      // The analyzer's own error queue outranks a clean HTTP response: the
      // command reached the instrument and the instrument refused it.
      if (s.error) log('DC Analyzer', `${what} — instrument says ${s.error}`, 'error')
      else log('DC Analyzer', what)
    } catch (e) {
      const msg = (e as Error).message
      setFault(msg)
      log('DC Analyzer', `${what} failed: ${msg}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const typedV = numOrNull(voltage)
  const typedI = numOrNull(limit)
  const vBad = typedV != null && (typedV < 0 || typedV > MAX_VOLTAGE_V)
  const iBad = typedI != null && (typedI < 0 || typedI > MAX_CURRENT_LIMIT_A)
  /** What the fields hold, as a settings payload. */
  const typed: DcAnalyzerSettings = {
    ...(typedV != null && !vBad ? { voltage_v: typedV } : {}),
    ...(typedI != null && !iBad ? { current_limit_a: typedI } : {}),
  }

  // Compared loosely: the analyzer answers its own rounding, so an exact match
  // would mark every applied setting as still pending.
  const vPending = typed.voltage_v != null && st?.voltage_set_v != null
    && Math.abs(typed.voltage_v - st.voltage_set_v) > 1e-3
  const iPending = typed.current_limit_a != null && st?.current_limit_a != null
    && Math.abs(typed.current_limit_a - st.current_limit_a) > 1e-4
  const pending = vPending || iPending

  // The address in use stays selectable even when it was not in the last scan
  // -- nothing is scanned while connected, and a blank field there would read
  // as "not configured" on a session that is open.
  const options: DiscoverCandidate[] = address && !resources.some((r) => r.resource === address)
    ? [{ resource: address, idn: dc.idn ?? null }, ...resources]
    : resources

  const outputOn = st?.output_on === true
  const canSend = connected && !busy

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="DC Analyzer"
        actions={
          <Button
            variant={outputOn ? 'outlined' : 'contained'}
            color={outputOn ? 'error' : 'primary'}
            disabled={!canSend || (!outputOn && (vBad || iBad))}
            startIcon={<PowerSettingsNewIcon sx={{ fontSize: 16 }} />}
            // Switching on carries the typed settings so they land first; the
            // backend switches the output on last. Switching off carries
            // nothing — the only thing wanted then is for the output to stop.
            onClick={() => void send(
              outputOn ? { output_on: false } : { ...typed, output_on: true },
              outputOn ? 'Output off' : 'Output on',
            )}
            sx={{ minWidth: 140, height: 36 }}
          >
            {outputOn ? 'Output Off' : 'Output On'}
          </Button>
        }
      />

      <PageBody width="fluid">
        <InstrumentBar
          name="DC analyzer"
          model="Keysight N6705B"
          status={dc.status}
          detail={dc.idn ? `${dc.idn} · ch ${channel}` : `ch ${channel}`}
          summary={address ? `${address} · ch ${channel}` : null}
          configReady={!!address}
          onConnect={() => void onConnect()}
          onDisconnect={() => void onDisconnect()}
          config={
            <>
              <Box>
                <Typography sx={{ ...TEXT.dense, color: 'text.secondary', mb: 0.75 }}>VISA resource</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Select
                    size="small"
                    fullWidth
                    value={options.some((r) => r.resource === address) ? address : ''}
                    displayEmpty
                    disabled={connected}
                    onChange={(e) => setAddress('dc-analyzer', String(e.target.value))}
                    renderValue={(v) => v || (scanning ? 'Scanning…' : 'Select an analyzer')}
                    sx={{ '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12 } }}
                  >
                    {options.map((r) => (
                      <MenuItem key={r.resource} value={r.resource} sx={{ display: 'block' }}>
                        <Typography sx={{ fontFamily: MONO, fontSize: 12 }}>{r.resource}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {r.idn ?? r.detail ?? 'no IDN response'}
                        </Typography>
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
                <Typography sx={{ ...TEXT.dense, color: 'text.secondary', mb: 0.75 }}>Channel</Typography>
                <Select
                  size="small"
                  value={channel}
                  disabled={connected}
                  onChange={(e) => setChannel('dc-analyzer', Number(e.target.value))}
                  sx={{ width: 96, '& .MuiSelect-select': { fontFamily: MONO, fontSize: 12.5 } }}
                >
                  {CHANNELS.map((c) => (
                    <MenuItem key={c} value={c} sx={{ fontFamily: MONO, fontSize: 12.5 }}>{c}</MenuItem>
                  ))}
                </Select>
                <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 0.75 }}>
                  Every test supplies and measures the DUT on this channel too.
                </Typography>
              </Box>
            </>
          }
        />

        <Box>
          <Section title="Output" panel>
            <FieldGrid columns={2}>
              <LabeledField
                label="Voltage" hint="V" type="number"
                value={voltage}
                onChange={(e) => setVoltage(e.target.value)}
                error={vBad}
                helperText={vBad ? `0–${MAX_VOLTAGE_V} V` : undefined}
                inputProps={{ step: 0.01, min: 0, max: MAX_VOLTAGE_V }}
                sx={{ '& input': { fontFamily: MONO } }}
              />
              <LabeledField
                label="Current limit" hint="A" type="number"
                value={limit}
                placeholder="leave as is"
                onChange={(e) => setLimit(e.target.value)}
                error={iBad}
                helperText={iBad ? `0–${MAX_CURRENT_LIMIT_A} A` : undefined}
                inputProps={{ step: 0.001, min: 0, max: MAX_CURRENT_LIMIT_A }}
                sx={{ '& input': { fontFamily: MONO } }}
              />
            </FieldGrid>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
              <Button
                variant={pending ? 'contained' : 'outlined'}
                disabled={!canSend || vBad || iBad
                  || (typed.voltage_v == null && typed.current_limit_a == null)}
                onClick={() => void send(typed, 'Applied voltage and current limit')}
                sx={{ minWidth: 120, height: 34 }}
              >
                Apply
              </Button>
              {/* Named rather than implied: the fields hold what was typed, and
                  the analyzer holds what was sent. Without this the two look
                  like one value that has quietly failed to take. */}
              {pending && (
                <Typography sx={{ ...TEXT.micro, color: 'warning.main', fontWeight: 600 }}>
                  not sent yet
                </Typography>
              )}
            </Stack>
          </Section>
        </Box>


        <Box sx={{ mt: 2 }}>
          <Section title="Instrument" panel>
            <StatRow>
              <StatTile
                label="Output"
                value={st?.output_on == null ? DASH : outputOn ? 'ON' : 'OFF'}
                tone={outputOn ? 'bad' : undefined}
                sub={st?.module ? `ch ${st.channel} · ${st.module}` : undefined}
                off={!connected}
              />
              <StatTile
                label="Set voltage"
                value={fmt(st?.voltage_set_v ?? null, 3)}
                unit="V"
                off={!connected}
              />
              <StatTile
                label="Current limit"
                value={st?.current_limit_a == null ? DASH : fmt(st.current_limit_a * 1000, 1)}
                unit="mA"
                off={!connected}
              />
            </StatRow>
            {/* Settings above, measurements below: two rows with a gap, not
                one grid, so the seam between them reads as a grouping. */}
            <Box sx={{ mt: 1.5 }} />
            <StatRow>
              <StatTile
                label="Voltage"
                value={fmt(st?.voltage_v ?? null, 3)}
                unit="V"
                sub="measured"
                off={!connected}
              />
              <StatTile
                label="Current"
                value={st?.current_a == null ? DASH : fmt(st.current_a * 1000, 3)}
                unit="mA"
                sub="measured"
                off={!connected}
              />
              <StatTile
                label="Power"
                value={st?.power_w == null ? DASH : fmt(st.power_w * 1000, 2)}
                unit="mW"
                sub="measured"
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
