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
import { fmt, fmtHz, fmtMhz } from '../../lib/format'
import {
  ACTION_W, Card, ConnectButton, CONTROL_H, Eyebrow, MONO, MonoText, PageBody,
  Section, StatusChip, TEXT,
} from '../../ui'
import type { TestPageProps } from '../types'
import { useActionReporter } from '../engine/useRunReporter'

const MHZ = 1e6

/** Frequency fields are retyped rather than edited, so focus selects the value. */
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
  e.target.select()

export function NetworkAnalyzerPage({ protocol, group }: TestPageProps) {
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
    refetchInterval: (q) => (q.state.data?.connected ? 5000 : false),
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

  const statusText = connected ? `Connected · ${cfg?.idn ?? ''}` : 'Disconnected'

  const addMarker = () => {
    if (markersMHz.length >= 9) return
    setMarkersMHz((arr) => [...arr, ''])
  }
  const removeMarker = (i: number) => {
    setMarkersMHz((arr) => arr.filter((_, j) => j !== i))
  }
  const updateMarker = (i: number, v: string) => {
    setMarkersMHz((arr) => arr.map((x, j) => (j === i ? v : x)))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Network Analyzer"
        actions={
          <ConnectButton
            connected={connected}
            pending={connectM.isPending || disconnectM.isPending}
            disabled={busy || (!connected && !resource)}
            onConnect={() => connectM.mutate()}
            onDisconnect={() => disconnectM.mutate()}
          />
        }
      />

      <PageBody width="panel">
        <Section
          title="Instrument"
          action={<MonoText>Agilent E5061B · USBTMC / VISA</MonoText>}
        >
          <Card>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Eyebrow>Status</Eyebrow>
                <Typography sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {statusText}
                </Typography>
              </Box>
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
                  sx={{ width: 320 }}
                  renderInput={(p) => <TextField {...p} label="VISA resource" placeholder="USB0::0x0957::…" />}
                />
              )}
              <StatusChip
                label={connected ? 'Online' : 'Offline'}
                tone={connected ? 'ok' : 'off'}
              />
            </Stack>
          </Card>
        </Section>

        <Section title="Sweep range">
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <TextField
              size="small"
              label="Start (MHz)"
              type="number"
              value={startMHz}
              onChange={(e) => setStartMHz(e.target.value)}
              {...freqFocusBind('start')}
              inputProps={{ step: 1, min: 0 }}
              sx={{ width: 160 }}
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
              sx={{ width: 160 }}
              disabled={!connected || busy}
              error={stopMHz.trim() !== '' && !freqValid}
              InputProps={{ endAdornment: <ValidationAdornment show={shouldShowValidation(stopMHz, freqValid, freqFocus === 'stop')} message={stopMHz.trim() === '' ? 'Enter a value' : 'Stop must be greater than Start, both > 0'} /> }}
            />
            <Button
              variant="contained"
              onClick={() => setFreqM.mutate()}
              disabled={!connected || busy || !freqValid}
              sx={{ minWidth: ACTION_W.default, height: CONTROL_H.lg }}
            >
              Apply
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ pt: 0.5 }}>
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                instrument: {fmtHz(cfg?.start_hz)} → {fmtHz(cfg?.stop_hz)}
              </Typography>
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary' }}>
                {cfg?.points ?? '—'} points · IFBW {cfg?.if_bandwidth_hz ? `${fmt(cfg.if_bandwidth_hz / 1e3, 1)} kHz` : '—'}
              </Typography>
            </Box>
          </Stack>
        </Section>

        <Section
          title="Markers (MHz)"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={addMarker}
                disabled={markersMHz.length >= 9 || busy}
              >
                Add
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setMarkersM.mutate()}
                disabled={!connected || busy}
              >
                Apply markers
              </Button>
            </Stack>
          }
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {markersMHz.map((v, i) => (
              <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                <TextField
                  size="small"
                  type="number"
                  label={`M${i + 1}`}
                  value={v}
                  onChange={(e) => updateMarker(i, e.target.value)}
                  onFocus={selectOnFocus}
                  inputProps={{ step: 1, min: 0 }}
                  sx={{ width: 130 }}
                  disabled={busy}
                />
                <IconButton size="small" onClick={() => removeMarker(i)} disabled={busy}>
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        </Section>

        <Section
          title="Measurement (S11)"
          action={
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => measureM.mutate()}
              disabled={!connected || busy || markerHzList.length === 0}
              sx={{ minWidth: ACTION_W.wide, height: CONTROL_H.md }}
            >
              {measureM.isPending ? 'Sweeping…' : 'Sweep + Read'}
            </Button>
          }
        >
          {!lastMeas && (
            <Typography sx={{ ...TEXT.hint, color: 'text.secondary' }}>
              No measurement yet. Apply markers and click Sweep + Read.
            </Typography>
          )}

          {lastMeas && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Mk</TableCell>
                    <TableCell>Freq (MHz)</TableCell>
                    <TableCell align="right">R (Ω)</TableCell>
                    <TableCell align="right">jX (Ω)</TableCell>
                    <TableCell align="right">S11 real</TableCell>
                    <TableCell align="right">S11 imag</TableCell>
                    <TableCell align="right">|S11| (dB)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lastMeas.markers.map((m) => (
                    <TableRow key={m.index}>
                      <TableCell>M{m.index}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }}>{fmtMhz(m.freq_hz)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.r_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.x_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.s11_real, 4)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.s11_imag, 4)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>{fmt(m.s11_mag_db, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography sx={{ ...TEXT.micro, color: 'text.secondary', mt: 1 }}>
                sweep {fmtHz(lastMeas.start_hz)} → {fmtHz(lastMeas.stop_hz)} · {lastMeas.points} pts
              </Typography>
            </Box>
          )}
        </Section>
      </PageBody>
    </Box>
  )
}
