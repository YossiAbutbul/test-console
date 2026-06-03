import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Box, Button, Chip, IconButton, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import FirstPageIcon from '@mui/icons-material/FirstPage'
import LastPageIcon from '@mui/icons-material/LastPage'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DownloadIcon from '@mui/icons-material/Download'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '../../components/PageHeader'
import { LabeledField } from '../../components/LabeledField'
import { motor } from '../../api/motor'
import { servo } from '../../api/servo'
import { vna } from '../../api/networkAnalyzer'
import { device } from '../../api/device'
import { instrumentsApi } from '../../api/instruments'
import { useInstrumentValue } from '../../context/InstrumentsContext'
import { useConnection } from '../../context/ConnectionContext'
import { usePathLoss } from '../../context/PathLossContext'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import type { TestPageProps } from '../types'
import {
  loadPullPageSnapshot, persistLoadPullPage, type LoadPullResultRow,
} from '../../store/loadPullPageStore'
import { SmithChartModal } from './SmithChartModal'

const PULSES_PER_MM = 400
const POLL_MS = 500
const MOTOR_WAIT_TIMEOUT_MS = 60_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mm = (p: number) => p / PULSES_PER_MM
const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(d)

type StatusChipProps = { label: string; ok: boolean; detail?: string }
function StatusChip({ label, ok, detail }: StatusChipProps) {
  return (
    <Chip
      size="small"
      icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ok ? 'success.main' : 'text.disabled', ml: 0.75 }} />}
      label={detail ? `${label} · ${detail}` : label}
      sx={{ fontSize: 11.5, fontWeight: 600, color: ok ? 'success.main' : 'text.disabled' }}
    />
  )
}

function downloadCsv(rows: LoadPullResultRow[], meta: {
  freqMhz: number; powerDbm: number; pathLossDb: number; mac: string | null
}): void {
  const n = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? '' : String(parseFloat(v.toFixed(3)))
  const head = ['#', 'pos_mm', 'pos_pulses', 'power_dbm', 'cc_ma', 'r_ohm', 'x_ohm', 's11_db', 'error']
  const lines = [
    `# freq_mhz=${meta.freqMhz} power_dbm=${meta.powerDbm} path_loss_db=${meta.pathLossDb}`,
    head.join(','),
  ]
  rows.forEach((r, i) => {
    const cols = [
      i + 1, n(r.pos_mm), r.pos_pulses, n(r.power_dbm),
      r.current_a == null ? '' : n(r.current_a * 1000),
      n(r.r_ohm), n(r.x_ohm), n(r.s11_db), r.error ?? '',
    ]
    lines.push(cols.map((v) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(','))
  })
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const macSlug = (meta.mac ?? '').replace(/:/g, '').toUpperCase()
  const base = macSlug ? `${macSlug}-load-pull` : 'load-pull'
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}-${ts}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function LoadPullPage({ protocol, group }: TestPageProps) {
  const { log } = useLog()
  const notify = useNotify()
  const { pathLossDb } = usePathLoss()
  const { status: bleStatus } = useConnection()
  const hasBackend = protocol === 'LoRa'

  const qc = useQueryClient()
  // Poll continuously (not gated on connected) so the page picks up a trombone
  // that gets connected later via the Instruments modal — otherwise an early
  // connected:false would latch polling off and the jog controls stay disabled.
  const motorStatusQ = useQuery({
    queryKey: ['motor', 'status'],
    queryFn: motor.status,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  })
  const motorS = motorStatusQ.data
  const motorConnected = !!motorS?.connected
  const motorMoving = !!motorS?.moving
  const motorPos = motorS?.position ?? null

  const ps = useInstrumentValue('power-sensor')
  const dc = useInstrumentValue('dc-analyzer')
  const na = useInstrumentValue('network-analyzer')
  const sw = useInstrumentValue('rf-switch')
  const tr = useInstrumentValue('rf-trombone')
  const dutConnected = !!bleStatus?.connected

  const allReady =
    ps.status === 'connected' && dc.status === 'connected' && na.status === 'connected' &&
    sw.status === 'connected' && tr.status === 'connected' && dutConnected

  const [freqMhz, setFreqMhz] = useState<number>(() => loadPullPageSnapshot.freqMhz ?? 902.3)
  const [powerDbm, setPowerDbm] = useState<number>(() => loadPullPageSnapshot.powerDbm ?? 14)
  const [paMode, setPaMode] = useState<number>(() => loadPullPageSnapshot.paMode ?? 2)
  const [settleMs, setSettleMs] = useState<number>(() => loadPullPageSnapshot.settleMs ?? 500)
  const [deltaXmm, setDeltaXmm] = useState<number>(() => loadPullPageSnapshot.deltaXmm ?? 1)
  const [jogSpeed, setJogSpeed] = useState<number>(() => loadPullPageSnapshot.jogSpeed ?? 800)
  const [zeroPulses, setZeroPulses] = useState<number | null>(() => loadPullPageSnapshot.zeroPulses ?? null)
  const [endPulses, setEndPulses] = useState<number | null>(() => loadPullPageSnapshot.endPulses ?? null)
  const [pathAck, setPathAck] = useState<boolean>(() => !!loadPullPageSnapshot.pathAck)
  const [results, setResults] = useState<LoadPullResultRow[]>(() => loadPullPageSnapshot.results ?? [])
  const [smithOpen, setSmithOpen] = useState(false)

  useEffect(() => { loadPullPageSnapshot.freqMhz = freqMhz; persistLoadPullPage() }, [freqMhz])
  useEffect(() => { loadPullPageSnapshot.powerDbm = powerDbm; persistLoadPullPage() }, [powerDbm])
  useEffect(() => { loadPullPageSnapshot.paMode = paMode; persistLoadPullPage() }, [paMode])
  useEffect(() => { loadPullPageSnapshot.settleMs = settleMs; persistLoadPullPage() }, [settleMs])
  useEffect(() => { loadPullPageSnapshot.deltaXmm = deltaXmm; persistLoadPullPage() }, [deltaXmm])
  useEffect(() => { loadPullPageSnapshot.jogSpeed = jogSpeed; persistLoadPullPage() }, [jogSpeed])
  useEffect(() => { loadPullPageSnapshot.zeroPulses = zeroPulses; persistLoadPullPage() }, [zeroPulses])
  useEffect(() => { loadPullPageSnapshot.endPulses = endPulses; persistLoadPullPage() }, [endPulses])
  useEffect(() => { loadPullPageSnapshot.pathAck = pathAck; persistLoadPullPage() }, [pathAck])
  useEffect(() => { loadPullPageSnapshot.results = results; persistLoadPullPage() }, [results])

  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const abortRef = useState<{ stop: boolean }>({ stop: false })[0]
  const resultsScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = resultsScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [results.length])

  // Manual trombone jog
  const refreshMotor = () => qc.invalidateQueries({ queryKey: ['motor', 'status'] })
  const onMotorOk = (label: string) => () => { log('Motor', `${label} ok`); refreshMotor() }
  const onMotorErr = (label: string) => (e: Error) => {
    log('Motor', `${label} failed: ${e.message}`, 'error')
    notify.error(e.message, { title: `Trombone ${label}` })
  }

  // Continuous jog: press-and-hold a direction → motor runs at a reduced speed
  // until released. The backend gates the motion at the soft limits. A ref
  // tracks the active direction so a key-repeat / duplicate keydown doesn't
  // restart it, and so we only stop the jog we actually started.
  const jogDirRef = useRef<number>(0)
  const [jogDir, setJogDir] = useState<number>(0)
  const startJog = (positive: boolean) => {
    if (!motorConnected || running) return
    const dir = positive ? 1 : -1
    if (jogDirRef.current === dir) return // already jogging this way
    jogDirRef.current = dir
    setJogDir(dir)
    motor.jogStart(positive, jogSpeed).catch((e: Error) => {
      jogDirRef.current = 0
      setJogDir(0)
      log('Motor', `jog ${positive ? '+' : '−'} failed: ${e.message}`, 'error')
      if (!/limit/i.test(e.message)) notify.error(e.message, { title: 'Trombone jog' })
    })
  }
  const stopJog = () => {
    if (jogDirRef.current === 0) return
    jogDirRef.current = 0
    setJogDir(0)
    motor.jogStop()
      .then(() => refreshMotor())
      .catch((e: Error) => log('Motor', `jog stop failed: ${e.message}`, 'error'))
  }
  // Min/Max jump to the user-captured zero/end positions (local state). Each is
  // enabled independently as soon as its own point is captured — Min needs only
  // zero, Max needs only end. Don't wait on the backend soft-limit echo.
  const travelMin = zeroPulses
  const travelMax = endPulses
  const goMinM = useMutation({ mutationFn: () => motor.move(travelMin ?? 0, true), onSuccess: onMotorOk('go zero'), onError: onMotorErr('go zero') })
  const goMaxM = useMutation({ mutationFn: () => motor.move(travelMax ?? 0, true), onSuccess: onMotorOk('go end'), onError: onMotorErr('go end') })

  // Manual RF switch routing — same servo presets the run loop uses.
  const swConnected = sw.status === 'connected'
  const switchM = useMutation({
    mutationFn: (t: 'VNA' | 'PCB') => servo.goto(t),
    onSuccess: (_d, t) => { log('Switch', `→ ${t} ok`) },
    onError: (e: Error, t) => {
      log('Switch', `→ ${t} failed: ${e.message}`, 'error')
      notify.error(e.message, { title: `Switch → ${t}` })
    },
  })

  // Plan: list of trombone positions in pulses from zero -> end stepping by delta
  const deltaPulses = Math.max(1, Math.round(deltaXmm * PULSES_PER_MM))
  const positions: number[] = (() => {
    if (zeroPulses == null || endPulses == null || deltaXmm <= 0) return []
    const a = zeroPulses, b = endPulses
    const out: number[] = []
    if (a === b) return [a]
    const step = a < b ? deltaPulses : -deltaPulses
    // a..b are the user-captured travel ends, so no extra clamping needed.
    for (let p = a; (step > 0 ? p <= b + 1e-9 : p >= b - 1e-9); p += step) {
      out.push(Math.round(p))
      if (out.length > 5000) break // safety
    }
    return out
  })()
  const totalPoints = positions.length

  // The captured zero & end define the travel range, so push them to the
  // backend as the soft limits. While either is unset, limits are cleared so
  // the user can jog freely to find the ends.
  useEffect(() => {
    const apply = zeroPulses != null && endPulses != null
      ? motor.setLimits(Math.min(zeroPulses, endPulses), Math.max(zeroPulses, endPulses))
      : motor.setLimits(null, null)
    void apply.then(() => refreshMotor()).catch(() => { /* ignore */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeroPulses, endPulses])

  const canRun = hasBackend && allReady && pathAck && totalPoints > 0 && !running

  const waitForMotorIdle = async (): Promise<void> => {
    const t0 = Date.now()
    // give the move command a beat to register before we start polling
    await sleep(120)
    while (Date.now() - t0 < MOTOR_WAIT_TIMEOUT_MS) {
      if (abortRef.stop) return
      const s = await motor.status()
      if (!s.moving) return
      await sleep(150)
    }
    throw new Error('motor move timed out')
  }

  const runM = useMutation({
    mutationFn: async () => {
      abortRef.stop = false
      setRunning(true)
      setResults([])
      setProgressIdx(0)
      const freqHz = Math.round(freqMhz * 1_000_000)
      try {
        try { await vna.setMarkers([freqHz]) }
        catch (e) { log('LoadPull', `setMarkers failed: ${(e as Error).message}`, 'warn') }

        const collected: LoadPullResultRow[] = []
        for (let i = 0; i < positions.length; i++) {
          if (abortRef.stop) { log('LoadPull', 'stopped by user', 'warn'); break }
          setProgressIdx(i + 1)
          const pos = positions[i]
          const row: LoadPullResultRow = {
            pos_pulses: pos, pos_mm: mm(pos),
            power_dbm: null, current_a: null,
            r_ohm: null, x_ohm: null, s11_db: null,
            error: null,
          }
          try {
            // 1. trombone -> position
            await motor.move(pos, true)
            await waitForMotorIdle()
            if (abortRef.stop) break

            // 2. switch -> VNA, measure marker
            await servo.goto('VNA')
            await sleep(settleMs)
            const m = await vna.measure([freqHz])
            const mk = m.markers?.[0]
            if (mk) {
              row.r_ohm = mk.r_ohm
              row.x_ohm = mk.x_ohm
              row.s11_db = mk.s11_mag_db
            } else if (m.error) {
              row.error = `vna: ${m.error}`
            }

            // 3. switch -> PCB
            await servo.goto('PCB')
            await sleep(settleMs)

            // 4. TX on
            const tx = await device.loraPower({
              freq_hz: freqHz, power_dbm: powerDbm, pa_mode: paMode,
            })
            if (!tx.ok) {
              row.error = (row.error ? row.error + '; ' : '') + `tx status=${tx.status}`
            } else {
              await sleep(settleMs)
              // 5. measure power + CC; apply path loss correction
              const meas = await instrumentsApi.measure(freqHz)
              row.power_dbm = meas.power_dbm == null ? null : meas.power_dbm + pathLossDb
              row.current_a = meas.current_a
              if (meas.error) row.error = (row.error ? row.error + '; ' : '') + meas.error
            }
            // 6. TX off
            try { await device.stop() } catch { /* ignore */ }
          } catch (e) {
            row.error = (e as Error).message
            try { await device.stop() } catch { /* ignore */ }
          }
          collected.push(row)
          setResults([...collected])
        }

        if (abortRef.stop) {
          notify.complete({
            severity: 'warning',
            title: 'Load Pull cancelled',
            message: `Stopped at ${collected.length}/${positions.length} points`,
          })
        } else {
          const errCount = collected.filter((r) => r.error).length
          if (errCount > 0) {
            notify.complete({
              severity: 'warning',
              title: 'Load Pull done',
              message: `Finished with ${errCount} error${errCount === 1 ? '' : 's'} (${collected.length} points)`,
            })
          } else {
            notify.complete({ severity: 'success', title: 'Load Pull done', message: `${collected.length} points measured` })
          }
        }
      } finally {
        setRunning(false)
      }
    },
    onError: (e: Error) => {
      log('LoadPull', `failed: ${e.message}`, 'error')
      notify.error(e.message, { title: 'Load Pull failed' })
    },
  })

  const onStop = () => {
    abortRef.stop = true
    void device.stop().catch(() => { /* ignore */ })
    void motor.stop().catch(() => { /* ignore */ })
  }

  const motorJogBusy = goMinM.isPending || goMaxM.isPending

  // Keyboard jog: hold ← / → to run the motor while the jog pad is focused;
  // release (or blur) stops it. Key auto-repeat is ignored so the jog isn't
  // restarted on every repeat tick.
  const [jogFocused, setJogFocused] = useState(false)
  const onJogKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    if (e.repeat) return
    if (!motorConnected || running || motorJogBusy) return
    startJog(e.key === 'ArrowRight')
  }
  const onJogKeyUp = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      stopJog()
    }
  }

  // Safety: stop any running jog when the component unmounts.
  useEffect(() => () => { if (jogDirRef.current !== 0) void motor.jogStop().catch(() => {}) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <PageHeader
        protocol={protocol}
        group={group}
        label="Load Pull Test"
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => runM.mutate()}
              disabled={!canRun}
              sx={{ minWidth: 140, height: 36 }}
            >
              {running ? `Running ${progressIdx}/${totalPoints}` : 'Run'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<StopIcon />}
              onClick={onStop}
              disabled={!running}
              sx={{ height: 36 }}
            >
              Stop
            </Button>
          </Stack>
        }
      />

      <Stack spacing={2} sx={{ mt: 1, flexGrow: 1, minHeight: 0, overflowY: 'auto', pr: 1, pb: 2 }}>
        {/* ── 1. Instruments ─────────────────────────────── */}
        <Box>
          <Typography sx={sectionTitleSx}>
            1. Instruments
            <Typography component="span" sx={{ fontSize: 12, ml: 1, color: allReady ? 'success.main' : 'text.secondary', fontWeight: 600 }}>
              {allReady ? 'all ready' : 'connect missing instruments in the Instruments modal'}
            </Typography>
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <StatusChip label="Power sensor" ok={ps.status === 'connected'} />
            <StatusChip label="DC analyzer" ok={dc.status === 'connected'} />
            <StatusChip label="VNA" ok={na.status === 'connected'} />
            <StatusChip label="Switch" ok={sw.status === 'connected'} />
            <StatusChip
              label="Trombone"
              ok={tr.status === 'connected'}
              detail={motorPos == null ? undefined : `pos ${motorPos.toLocaleString()}`}
            />
            <StatusChip
              label="BLE DUT"
              ok={dutConnected}
              detail={bleStatus?.address ?? undefined}
            />
          </Stack>
        </Box>

        {/* ── 2. Path Loss ───────────────────────────────── */}
        <Box>
          <Typography sx={sectionTitleSx}>2. Path loss</Typography>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              size="small"
              label={`Path loss: ${pathLossDb} dB`}
              sx={{ fontWeight: 600, fontSize: 12 }}
            />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              set globally in Connection panel · sensor reading + path loss = DUT power
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              size="small"
              variant={pathAck ? 'contained' : 'outlined'}
              color={pathAck ? 'success' : 'primary'}
              onClick={() => setPathAck(!pathAck)}
            >
              {pathAck ? '✓ RF path verified' : 'Confirm RF path'}
            </Button>
          </Stack>
          {!pathAck && (
            <Typography sx={{ fontSize: 12, color: 'warning.main', mt: 1 }}>
              Verify cabling: <b>DUT → switch → coupler → power sensor</b>. Click to confirm.
            </Typography>
          )}
        </Box>

        {/* ── RF switch routing ──────────────────────────── */}
        <Box>
          <Typography sx={sectionTitleSx}>RF switch</Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant="outlined"
              onClick={() => switchM.mutate('PCB')}
              disabled={!swConnected || switchM.isPending || running}
              sx={{ minWidth: 130, height: 40 }}
            >
              Go PCB
            </Button>
            <Button
              variant="outlined"
              onClick={() => switchM.mutate('VNA')}
              disabled={!swConnected || switchM.isPending || running}
              sx={{ minWidth: 130, height: 40 }}
            >
              Go VNA
            </Button>
            {!swConnected && (
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                connect the switch in the Instruments modal
              </Typography>
            )}
          </Stack>
        </Box>

        {/* ── 3. Test point ──────────────────────────────── */}
        <Box>
          <Typography sx={sectionTitleSx}>3. Test point</Typography>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <LabeledField
              label="Frequency" hint="MHz" type="number" value={freqMhz}
              historyKey="loadPull.freqMhz"
              onChange={(e) => setFreqMhz(Number(e.target.value))}
              inputProps={{ step: 0.1 }}
              sx={{ width: 180 }}
            />
            <LabeledField
              label="DUT Power" hint="dBm" type="number" value={powerDbm}
              historyKey="loadPull.powerDbm"
              onChange={(e) => setPowerDbm(Number(e.target.value))}
              sx={{ width: 160 }}
            />
            <LabeledField
              label="PA Mode" select value={paMode}
              onChange={(e) => setPaMode(Number(e.target.value))}
              sx={{ width: 140 }}
            >
              <MenuItem value={2}>Auto</MenuItem>
              <MenuItem value={1}>On</MenuItem>
              <MenuItem value={0}>Off</MenuItem>
            </LabeledField>
            <LabeledField
              label="Settle" hint="ms" type="number" value={settleMs}
              historyKey="loadPull.settleMs"
              onChange={(e) => setSettleMs(Math.max(0, Number(e.target.value) || 0))}
              sx={{ width: 140 }}
            />
          </Stack>
        </Box>

        {/* ── 4. Trombone calibration ────────────────────── */}
        <Box>
          <Typography sx={sectionTitleSx}>
            4. Trombone calibration
            <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary' }}>
              {PULSES_PER_MM} pulses/mm
            </Typography>
          </Typography>
          <Box>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
                  Live position
                </Typography>
                <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 600 }}>
                  {motorPos == null ? 'NA' : `${mm(motorPos).toFixed(2)} mm`}
                  <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.75 }}>
                    {motorPos == null ? '' : `(${motorPos.toLocaleString()} pulses)`}
                  </Typography>
                </Typography>
              </Box>
              <Chip
                size="small"
                label={motorConnected ? (motorMoving ? 'Moving' : 'Idle') : 'Disconnected'}
                sx={{ fontSize: 11.5, fontWeight: 600, color: motorConnected ? (motorMoving ? 'warning.main' : 'success.main') : 'text.disabled' }}
              />
            </Stack>

            <Stack direction="row" spacing={1.5} alignItems="flex-end" justifyContent="flex-start" useFlexGap flexWrap="nowrap" sx={{ mb: 2, overflowX: 'auto' }}>
              <Button
                variant="outlined" startIcon={<FirstPageIcon />}
                onClick={() => goMinM.mutate()}
                disabled={!motorConnected || motorJogBusy || running || travelMin == null}
                title={travelMin == null ? 'Capture zero first' : undefined}
                sx={{ minWidth: 96, height: 40 }}
              >
                Min
              </Button>

              {/* Press-and-hold jog pad — focus it, then hold ← / → to run the
                  motor; release to stop. Mouse press-hold works too. */}
              <Box
                tabIndex={motorConnected && !running ? 0 : -1}
                onKeyDown={onJogKeyDown}
                onKeyUp={onJogKeyUp}
                onFocus={() => setJogFocused(true)}
                onBlur={() => { setJogFocused(false); stopJog() }}
                sx={{
                  height: 40, px: 1,
                  display: 'flex', alignItems: 'center', gap: 0.5,
                  border: 1, borderColor: jogFocused ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  outline: 'none',
                  bgcolor: jogFocused ? 'action.hover' : 'transparent',
                  opacity: motorConnected && !running ? 1 : 0.5,
                  userSelect: 'none',
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                <IconButton
                  size="small"
                  disabled={!motorConnected || running}
                  onMouseDown={() => startJog(false)}
                  onMouseUp={stopJog}
                  onMouseLeave={stopJog}
                  sx={{ color: jogDir < 0 ? 'primary.main' : 'text.secondary' }}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: jogDir !== 0 ? 'warning.main' : (jogFocused ? 'primary.main' : 'text.secondary'), whiteSpace: 'nowrap', minWidth: 78, textAlign: 'center' }}>
                  {jogDir !== 0 ? 'jogging…' : jogFocused ? 'hold ← →' : 'click + hold'}
                </Typography>
                <IconButton
                  size="small"
                  disabled={!motorConnected || running}
                  onMouseDown={() => startJog(true)}
                  onMouseUp={stopJog}
                  onMouseLeave={stopJog}
                  sx={{ color: jogDir > 0 ? 'primary.main' : 'text.secondary' }}
                >
                  <ArrowForwardIcon />
                </IconButton>
              </Box>

              <Button
                variant="outlined" endIcon={<LastPageIcon />}
                onClick={() => goMaxM.mutate()}
                disabled={!motorConnected || motorJogBusy || running || travelMax == null}
                title={travelMax == null ? 'Capture end first' : undefined}
                sx={{ minWidth: 96, height: 40 }}
              >
                Max
              </Button>

              <LabeledField
                label="Jog speed" select value={jogSpeed}
                width={130}
                onChange={(e) => setJogSpeed(Number(e.target.value))}
              >
                <MenuItem value={400}>Slow</MenuItem>
                <MenuItem value={800}>Medium</MenuItem>
                <MenuItem value={1500}>Fast</MenuItem>
              </LabeledField>
            </Stack>

            <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
                  Zero reference (Smith chart starting point)
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => setZeroPulses(motorPos)}
                    disabled={motorPos == null || running}
                  >
                    Capture zero
                  </Button>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                    {zeroPulses == null ? '—' : `${mm(zeroPulses).toFixed(2)} mm  (${zeroPulses.toLocaleString()})`}
                  </Typography>
                  {zeroPulses != null && (
                    <Button size="small" onClick={() => setZeroPulses(null)} disabled={running}>clear</Button>
                  )}
                </Stack>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
                  End position (full Smith chart cycle)
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => setEndPulses(motorPos)}
                    disabled={motorPos == null || running}
                  >
                    Capture end
                  </Button>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                    {endPulses == null ? '—' : `${mm(endPulses).toFixed(2)} mm  (${endPulses.toLocaleString()})`}
                  </Typography>
                  {endPulses != null && (
                    <Button size="small" onClick={() => setEndPulses(null)} disabled={running}>clear</Button>
                  )}
                </Stack>
              </Box>
              <LabeledField
                label="Delta X" hint="mm"
                type="number" value={deltaXmm}
                historyKey="loadPull.deltaXmm"
                onChange={(e) => setDeltaXmm(Math.max(0, Number(e.target.value) || 0))}
                inputProps={{ step: 0.1, min: 0 }}
                sx={{ width: 140 }}
              />
            </Stack>

            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
              {totalPoints > 0
                ? <>Plan: <b>{totalPoints}</b> points · {fmt(zeroPulses == null ? null : mm(zeroPulses))} → {fmt(endPulses == null ? null : mm(endPulses))} mm · step {deltaXmm} mm ({deltaPulses} pulses)</>
                : <>Capture zero + end positions and set Delta X to build the sweep plan.</>}
            </Typography>
          </Box>
        </Box>

        {/* ── 5. Results ────────────────────────────────── */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 1, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700, flexGrow: 1 }}>
              5. Results
              <Typography component="span" sx={{ fontSize: 12, ml: 1, color: 'text.secondary' }}>
                power = sensor + path-loss ({pathLossDb} dB)
              </Typography>
            </Typography>
            <Button
              size="small" variant="outlined" color="inherit"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setResults([])}
              disabled={results.length === 0 || running}
              sx={{ mr: 1 }}
            >
              Clear
            </Button>
            <Button
              size="small" variant="outlined"
              startIcon={<ScatterPlotIcon />}
              onClick={() => setSmithOpen(true)}
              disabled={results.length === 0}
              sx={{ mr: 1 }}
            >
              Smith chart
            </Button>
            <Button
              size="small" variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => downloadCsv(results, {
                freqMhz, powerDbm, pathLossDb, mac: bleStatus?.address ?? null,
              })}
              disabled={results.length === 0}
            >
              Export
            </Button>
          </Stack>

          {results.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              No data yet. Press Run.
            </Typography>
          ) : (
            <Box ref={resultsScrollRef} sx={{ maxHeight: 360, overflowY: 'auto' }}>
              <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '16%' }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Pos (mm)</TableCell>
                    <TableCell>Power (dBm)</TableCell>
                    <TableCell>CC (mA)</TableCell>
                    <TableCell>R (Ω)</TableCell>
                    <TableCell>J (Ω)</TableCell>
                    <TableCell>S11 (dB)</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell sx={monoSx}>{r.pos_mm.toFixed(2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.power_dbm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.current_a == null ? null : r.current_a * 1000, 1)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.r_ohm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.x_ohm, 2)}</TableCell>
                      <TableCell sx={monoSx}>{fmt(r.s11_db, 2)}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>
                        {r.error
                          ? <Box component="span" sx={{ color: 'error.main' }}>{r.error}</Box>
                          : <Box component="span" sx={{ color: 'success.main' }}>ok</Box>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Box>
      </Stack>

      <SmithChartModal
        open={smithOpen}
        onClose={() => setSmithOpen(false)}
        results={results}
        freqMhz={freqMhz}
      />
    </Box>
  )
}

const sectionTitleSx = {
  fontSize: 17, fontWeight: 700, color: 'text.primary',
  mb: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' as const,
}

const monoSx = { fontFamily: 'ui-monospace, monospace' as const }
