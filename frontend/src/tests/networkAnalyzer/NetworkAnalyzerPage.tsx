import { useEffect, useMemo, useState } from 'react'
import {
  Autocomplete, Box, Button, Chip, IconButton, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import PowerIcon from '@mui/icons-material/Power'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { vna, type VnaMeasureResponse } from '../../api/networkAnalyzer'
import { useLog } from '../../context/LogContext'
import type { TestPageProps } from '../types'

const MHZ = 1e6

const fmtHz = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v / MHZ).toFixed(3)} MHz`
}
const fmtNum = (v: number, digits = 3): string => {
  if (!Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function NetworkAnalyzerPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const qc = useQueryClient()

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

  const measureM = useMutation({
    mutationFn: () => vna.measure(markerHzList),
    onSuccess: (r) => {
      setLastMeas(r)
      log('VNA', `measure ok (${r.markers.length} markers)`)
      refresh()
    },
    onError: onErr('measure'),
  })

  const busy =
    connectM.isPending || disconnectM.isPending || setFreqM.isPending ||
    setMarkersM.isPending || measureM.isPending

  const statusColor = connected ? 'success.main' : 'text.disabled'
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
          <Button
            variant={connected ? 'outlined' : 'contained'}
            startIcon={<PowerIcon sx={{ fontSize: 16 }} />}
            onClick={() => (connected ? disconnectM.mutate() : connectM.mutate())}
            disabled={busy || (!connected && !resource)}
            sx={{ height: 36, minWidth: 120 }}
          >
            {connectM.isPending || disconnectM.isPending ? '…' : connected ? 'Disconnect' : 'Connect'}
          </Button>
        }
      />

      <Stack spacing={2} sx={{ mt: 1, maxWidth: 900 }}>
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Instrument
            <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>
              Agilent E5061B · USBTMC / VISA
            </Typography>
          </Typography>
          <Box sx={{ p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
                  Status
                </Typography>
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
              <Chip
                size="small"
                icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor, ml: 0.75 }} />}
                label={connected ? 'Online' : 'Offline'}
                sx={{ fontSize: 11.5, fontWeight: 600, color: statusColor }}
              />
            </Stack>
          </Box>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            Sweep range
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <TextField
              size="small"
              label="Start (MHz)"
              type="number"
              value={startMHz}
              onChange={(e) => setStartMHz(e.target.value)}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              inputProps={{ step: 1, min: 0 }}
              sx={{ width: 160 }}
              disabled={!connected || busy}
            />
            <TextField
              size="small"
              label="Stop (MHz)"
              type="number"
              value={stopMHz}
              onChange={(e) => setStopMHz(e.target.value)}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              inputProps={{ step: 1, min: 0 }}
              sx={{ width: 160 }}
              disabled={!connected || busy}
            />
            <Button
              variant="contained"
              onClick={() => setFreqM.mutate()}
              disabled={!connected || busy || !freqValid}
              sx={{ minWidth: 120, height: 40 }}
            >
              Apply
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ pt: 0.5 }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                instrument: {fmtHz(cfg?.start_hz)} → {fmtHz(cfg?.stop_hz)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                {cfg?.points ?? '—'} points · IFBW {cfg?.if_bandwidth_hz ? `${(cfg.if_bandwidth_hz / 1e3).toFixed(1)} kHz` : '—'}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Box>
          <Stack direction="row" alignItems="center" sx={{ mb: 1, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', flexGrow: 1 }}>
              Markers (MHz)
            </Typography>
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
              sx={{ ml: 1 }}
            >
              Apply markers
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {markersMHz.map((v, i) => (
              <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                <TextField
                  size="small"
                  type="number"
                  label={`M${i + 1}`}
                  value={v}
                  onChange={(e) => updateMarker(i, e.target.value)}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
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
        </Box>

        <Box>
          <Stack direction="row" alignItems="center" sx={{ mb: 2, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', flexGrow: 1 }}>
              Measurement (S11)
            </Typography>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => measureM.mutate()}
              disabled={!connected || busy || markerHzList.length === 0}
            >
              {measureM.isPending ? 'Sweeping…' : 'Sweep + Read'}
            </Button>
          </Stack>

          {!lastMeas && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              No measurement yet. Apply markers and click Sweep + Read.
            </Typography>
          )}

          {lastMeas && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Mk</TableCell>
                    <TableCell>Freq</TableCell>
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
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtHz(m.freq_hz)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtNum(m.r_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtNum(m.x_ohm, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtNum(m.s11_real, 4)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtNum(m.s11_imag, 4)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace' }}>{fmtNum(m.s11_mag_db, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1 }}>
                sweep {fmtHz(lastMeas.start_hz)} → {fmtHz(lastMeas.stop_hz)} · {lastMeas.points} pts
              </Typography>
            </Box>
          )}
        </Box>
      </Stack>
    </Box>
  )
}
