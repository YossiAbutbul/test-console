import { useEffect, useMemo, useState } from 'react'
import {
  Autocomplete, Box, Button, IconButton, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { ValidationAdornment, shouldShowValidation } from '../../components/ValidationAdornment'
import { vna, type VnaMeasureResponse } from '../../api/networkAnalyzer'
import { useLog } from '../../context/LogContext'
import { DASH, fmt, fmtHz, fmtMhz } from '../../lib/format'
import {
  ACTION_W, ConnectButton, CONTROL_H, MONO, MonoText, PageBody, Section,
  StatRow, StatTile, StatusChip, TEXT, TwoCol,
} from '../../ui'
import type { TestPageProps } from '../types'
import { useActionReporter } from '../engine/useRunReporter'

const MHZ = 1e6

const MAX_MARKERS = 9

/** Frequency fields are retyped rather than edited, so focus selects the value. */
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
  e.target.select()

export function NetworkAnalyzerPage({ group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()
  const reporter = useActionReporter('VNA sweep', 'VNA')

  const [resource, setResource] = useState<string>('')
  const [resources, setResources] = useState<string[]>([])
  const [startMHz, setStartMHz] = useState<string>('800')
  const [stopMHz, setStopMHz] = useState<string>('1000')
  const [markersMHz, setMarkersMHz] = useState<string[]>(['915'])
  const [lastMeas, setLastMeas] = useState<VnaMeasureResponse | null>(null)

  const configQ = useQuery({
    queryKey: ['vna', 'config'],
    queryFn: vna.config,
    // Slower while disconnected, but never off: a connection made from the
    // Instruments modal has to reach this page without a second Connect.
    refetchInterval: (q) => (q.state.data?.connected ? 5000 : 2000),
    refetchOnWindowFocus: false,
  })

  const cfg = configQ.data
  const connected = !!cfg?.connected

  // Hydrate form from backend on first connected fetch.
  useEffect(() => {
    if (!cfg?.connected) return
    if (cfg.start_hz != null) setStartMHz(String(cfg.start_hz / MHZ))
    if (cfg.stop_hz != null) setStopMHz(String(cfg.stop_hz / MHZ))
    if (cfg.markers?.length) setMarkersMHz(cfg.markers.map((h) => String(h / MHZ)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.connected])

  const refresh = () => qc.invalidateQueries({ queryKey: ['vna', 'config'] })
  const onErr = (label: string) => (e: Error) => log('VNA', `${label} failed: ${e.message}`, 'error')

  const discoverM = useMutation({
    mutationFn: vna.discover,
    onSuccess: (r) => {
      setResources(r.candidates)
      if (!resource && r.candidates.length > 0) setResource(r.candidates[0])
    },
    onError: onErr('discover'),
  })
  useEffect(() => { discoverM.mutate() }, [])

  const connectM = useMutation({
    mutationFn: () => vna.connect(resource),
    onSuccess: () => { log('VNA', 'connect ok'); refresh() },
    onError: onErr('connect'),
  })
  const disconnectM = useMutation({
    mutationFn: vna.disconnect,
    onSuccess: () => { log('VNA', 'disconnect ok'); refresh() },
    onError: onErr('disconnect'),
  })

  const startHz = Number(startMHz) * MHZ
  const stopHz = Number(stopMHz) * MHZ
  const freqValid = Number.isFinite(startHz) && Number.isFinite(stopHz) && stopHz > startHz && startHz > 0
  const [freqFocus, setFreqFocus] = useState<string | null>(null)
  const freqFocusBind = (key: string) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { selectOnFocus(e); setFreqFocus(key) },
    onBlur: () => setFreqFocus((k) => (k === key ? null : k)),
  })

  const setFreqM = useMutation({
    mutationFn: () => vna.setFreq(startHz, stopHz),
    onSuccess: () => { log('VNA', `set freq ${fmtHz(startHz)} → ${fmtHz(stopHz)}`); refresh() },
    onError: onErr('set freq'),
  })

  const markerHzList = useMemo(() => {
    return markersMHz
      .map((s) => Number(s) * MHZ)
      .filter((v) => Number.isFinite(v) && v > 0)
  }, [markersMHz])

  const setMarkersM = useMutation({
    mutationFn: () => vna.setMarkers(markerHzList),
    onSuccess: () => { log('VNA', `markers set (${markerHzList.length})`); refresh() },
    onError: onErr('set markers'),
  })

  // The sweep is this page's test run, so it reports start/finish like the
  // other test pages rather than writing a bare log line.
  const measureM = useMutation({
    mutationFn: () => vna.measure(markerHzList),
    onMutate: () => reporter.started(),
    onSuccess: (r) => {
      setLastMeas(r)
      reporter.succeeded(`${r.markers.length} markers read`)
      refresh()
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  const busy =
    connectM.isPending || disconnectM.isPending || setFreqM.isPending ||
    setMarkersM.isPending || measureM.isPending

  const addMarker = () => {
    if (markersMHz.length >= MAX_MARKERS) return
    setMarkersMHz((arr) => [...arr, ''])
  }
  const removeMarker = (i: number) => {
    setMarkersMHz((arr) => arr.filter((_, j) => j !== i))
  }
  const updateMarker = (i: number, v: string) => {
    setMarkersMHz((arr) => arr.map((x, j) => (j === i ? v : x)))
  }

  // The form holds what you have typed; the strip shows what the instrument is
  // actually set to. They differ until Apply, which is worth saying — a sweep
  // reads at the instrument's range, not the one on screen.
  //
  // Compared with a tolerance rather than exactly, because the instrument gets
  // the last word: the E5061B snaps a requested edge to its own frequency
  // resolution, so what it reports back is not always the number sent. On `!==`
  // a range would read as unapplied forever after applying it.
  const differs = (a: number | null | undefined, b: number) =>
    a == null || Math.abs(a - b) > 1
  const pendingFreq = connected && freqValid
    && (differs(cfg?.start_hz, startHz) || differs(cfg?.stop_hz, stopHz))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        group={group}
        label="Network Analyzer"
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => measureM.mutate()}
              disabled={!connected || busy || markerHzList.length === 0}
              sx={{ minWidth: ACTION_W.wide, height: CONTROL_H.md }}
            >
              {measureM.isPending ? 'Sweeping…' : 'Sweep + Read'}
            </Button>
            <ConnectButton
              connected={connected}
              pending={connectM.isPending || disconnectM.isPending}
              disabled={busy || (!connected && !resource)}
              onConnect={() => connectM.mutate()}
              onDisconnect={() => disconnectM.mutate()}
            />
          </Stack>
        }
      />

      <PageBody width="fluid">
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
              Instrument
            </Typography>
            <MonoText sx={{ fontSize: 11 }}>
              {connected ? (cfg?.idn ?? 'E5061B') : 'Agilent E5061B · USBTMC / VISA'}
            </MonoText>
            <Box sx={{ flexGrow: 1 }} />
            {!connected && (
              <Autocomplete
                size="small"
                freeSolo
                options={resources}
                value={resource}
                onChange={(_e, v) => setResource(typeof v === 'string' ? v : (v ?? ''))}
                onInputChange={(_e, v) => setResource(v ?? '')}
                onOpen={() => discoverM.mutate()}
                loading={discoverM.isPending}
                sx={{ width: 300 }}
                renderInput={(p) => <TextField {...p} label="VISA resource" placeholder="USB0::0x0957::…" />}
              />
            )}
            <StatusChip
              label={connected ? 'Online' : 'Offline'}
              tone={connected ? 'ok' : 'off'}
            />
          </Stack>

          {/* Read back from the instrument, not echoed from the form. */}
          <StatRow>
            <StatTile
              label="Start"
              value={cfg?.start_hz == null ? DASH : fmtMhz(cfg.start_hz, 3)}
              unit={cfg?.start_hz == null ? undefined : 'MHz'}
              off={!connected}
            />
            <StatTile
              label="Stop"
              value={cfg?.stop_hz == null ? DASH : fmtMhz(cfg.stop_hz, 3)}
              unit={cfg?.stop_hz == null ? undefined : 'MHz'}
              off={!connected}
            />
            <StatTile
              label="Points"
              value={cfg?.points == null ? DASH : String(cfg.points)}
              sub={cfg?.source_power_dbm == null
                ? undefined
                : `source ${fmt(cfg.source_power_dbm, 1)} dBm`}
              off={!connected}
            />
            <StatTile
              label="IF bandwidth"
              value={cfg?.if_bandwidth_hz == null ? DASH : fmt(cfg.if_bandwidth_hz / 1e3, 1)}
              unit={cfg?.if_bandwidth_hz == null ? undefined : 'kHz'}
              off={!connected}
            />
          </StatRow>
        </Box>

        <TwoCol stretch>
          <Section
            title="Sweep range"
            panel
            // Says which of the two ranges a sweep would actually use.
            hint={pendingFreq ? 'Not applied — the instrument still has the range above.' : undefined}
          >
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                size="small"
                label="Start (MHz)"
                type="number"
                value={startMHz}
                onChange={(e) => setStartMHz(e.target.value)}
                {...freqFocusBind('start')}
                inputProps={{ step: 1, min: 0 }}
                sx={{ flexGrow: 1, minWidth: 0 }}
                disabled={!connected || busy}
                error={startMHz.trim() !== '' && !freqValid}
                InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(startMHz, freqValid, freqFocus === 'start')} message={startMHz.trim() === '' ? 'Enter a value' : 'Stop must be greater than Start, both > 0'} /> }}
              />
              <TextField
                size="small"
                label="Stop (MHz)"
                type="number"
                value={stopMHz}
                onChange={(e) => setStopMHz(e.target.value)}
                {...freqFocusBind('stop')}
                inputProps={{ step: 1, min: 0 }}
                sx={{ flexGrow: 1, minWidth: 0 }}
                disabled={!connected || busy}
                error={stopMHz.trim() !== '' && !freqValid}
                InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(stopMHz, freqValid, freqFocus === 'stop')} message={stopMHz.trim() === '' ? 'Enter a value' : 'Stop must be greater than Start, both > 0'} /> }}
              />
              <Button
                variant={pendingFreq ? 'contained' : 'outlined'}
                onClick={() => setFreqM.mutate()}
                disabled={!connected || busy || !freqValid}
                sx={{ minWidth: ACTION_W.compact, height: CONTROL_H.md, flexShrink: 0 }}
              >
                Apply
              </Button>
            </Stack>
          </Section>

          <Section
            title="Markers"
            panel
            hint={`Up to ${MAX_MARKERS}, in MHz. Read on the next sweep.`}
            action={
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mr: 0.5 }}>
                  {markerHzList.length}/{MAX_MARKERS}
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<AddIcon sx={{ fontSize: 15 }} />}
                  onClick={addMarker}
                  disabled={markersMHz.length >= MAX_MARKERS || busy}
                  sx={{ minWidth: 0, height: 24, fontSize: 12, px: 1 }}
                >
                  Add
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setMarkersM.mutate()}
                  disabled={!connected || busy}
                  sx={{ minWidth: 0, height: 24, fontSize: 12, px: 1 }}
                >
                  Apply
                </Button>
              </Stack>
            }
          >
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {markersMHz.map((v, i) => (
                <Stack key={i} direction="row" alignItems="center">
                  <TextField
                    size="small"
                    type="number"
                    label={`M${i + 1}`}
                    value={v}
                    onChange={(e) => updateMarker(i, e.target.value)}
                    onFocus={selectOnFocus}
                    inputProps={{ step: 1, min: 0 }}
                    sx={{ width: 108, '& input': { fontFamily: MONO } }}
                    disabled={busy}
                  />
                  <IconButton
                    size="small"
                    onClick={() => removeMarker(i)}
                    disabled={busy}
                    aria-label={`remove marker ${i + 1}`}
                  >
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </Section>
        </TwoCol>

        <Section
          title="S11 at markers"
          panel
          action={
            lastMeas ? (
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                {fmtHz(lastMeas.start_hz)} → {fmtHz(lastMeas.stop_hz)} · {lastMeas.points} pts
              </Typography>
            ) : null
          }
        >
          {!lastMeas ? (
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              No measurement yet. Set markers, then Sweep + Read.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ width: '100%' }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Mk</TableCell>
                    <TableCell>Freq (MHz)</TableCell>
                    <TableCell align="right">R (Ω)</TableCell>
                    <TableCell align="right">jX (Ω)</TableCell>
                    <TableCell align="right">|S11| (dB)</TableCell>
                    <TableCell align="right">S11 real</TableCell>
                    <TableCell align="right">S11 imag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lastMeas.markers.map((m) => (
                    <TableRow key={m.index}>
                      <TableCell>M{m.index}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmtMhz(m.freq_hz)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.r_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.x_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO, fontWeight: 700 }}>{fmt(m.s11_mag_db, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO, color: 'text.secondary' }}>{fmt(m.s11_real, 4)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO, color: 'text.secondary' }}>{fmt(m.s11_imag, 4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>
      </PageBody>
    </Box>
  )
}
