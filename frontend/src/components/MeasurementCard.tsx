import { useCallback, useEffect, useRef } from 'react'
import { Box, Button, CircularProgress, Stack, Tooltip, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import CableIcon from '@mui/icons-material/Cable'
import { useMutation } from '@tanstack/react-query'
import { instrumentsApi, type MeasureResponse } from '../api/instruments'
import { useInstruments } from '../context/InstrumentsContext'
import { usePathLoss } from '../context/PathLossContext'
import { StatRow, StatTile } from '../ui'

interface Props {
  /** Hz, used to set sensor calibration freq before reading. */
  freqHz?: number
  /** Bumped by parent to trigger an auto-measure (after Send succeeds). */
  triggerId?: number
  /** Delay before auto-measure fires, lets DUT settle. */
  settleMs?: number
  onResult?: (r: MeasureResponse) => void
  /**
   * The power we asked the DUT for, in dBm. When given, the strip adds the
   * error against it — the number a TX power test actually exists to produce.
   * Without it the operator has to subtract two readings in their head.
   */
  targetDbm?: number | null
  /** |error| at or under this is on-spec; up to twice this is marginal. */
  toleranceDb?: number
  /** When set, render these values instead of fetching. Hides controls. */
  staticData?: {
    power_dbm?: number | null
    current_a?: number | null
    voltage_v?: number | null
    label?: string
    subLabel?: string
  } | null
}

/** Numeric part only — the unit rides in the tile's `unit` slot. */
function num(v: number | null | undefined, digits: number): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function MeasurementCard({
  freqHz, triggerId, settleMs = 250, onResult, staticData,
  targetDbm, toleranceDb = 1,
}: Props) {
  const { instruments, setOpen: openInstruments } = useInstruments()
  const { pathLossDb } = usePathLoss()
  const isStatic = staticData !== undefined
  const ps = isStatic
    ? staticData?.power_dbm != null
    : instruments['power-sensor'].status === 'connected'
  const dc = isStatic
    ? (staticData?.current_a != null || staticData?.voltage_v != null)
    : instruments['dc-analyzer'].status === 'connected'
  const anyConnected = ps || dc

  const measure = useMutation({
    mutationFn: () => instrumentsApi.measure(freqHz),
    onSuccess: (r) => onResult?.(r),
  })

  const lastTrigger = useRef<number | undefined>(undefined)
  const fire = useCallback(() => { measure.mutate() }, [measure])

  useEffect(() => {
    if (isStatic) return
    if (!anyConnected) return
    if (triggerId === undefined || triggerId === lastTrigger.current) return
    lastTrigger.current = triggerId
    const id = window.setTimeout(fire, settleMs)
    return () => window.clearTimeout(id)
  }, [triggerId, anyConnected, settleMs, fire, isStatic])

  const data = measure.data
  // Path loss is applied to the *raw* sensor reading this card fetches itself.
  // `staticData` is supplied by a caller that has already corrected it — the
  // Mode Sweep row comes from the backend, which adds path loss server-side —
  // so correcting again here counted it twice.
  const live = data?.power_dbm
  const power = isStatic
    ? staticData?.power_dbm
    : live != null && Number.isFinite(live) ? live + pathLossDb : live
  const cur = isStatic ? staticData?.current_a : data?.current_a
  const volt = isStatic ? staticData?.voltage_v : data?.voltage_v
  const power_mW = power != null && Number.isFinite(power) ? Math.pow(10, power / 10) : null
  const cur_mA = cur != null ? cur * 1000 : null

  // Show the voltage tile whenever there's a DC channel in play (live or
  // static). Power-only static rows (e.g. a mode-sweep point) stay two-up.
  const showVolt = isStatic ? staticData?.voltage_v != null : dc

  // Error against the requested power. Only meaningful once we actually have a
  // reading — before that the tile shows the target alone rather than a
  // fabricated "0.00" that reads like a passing result.
  const hasTarget = targetDbm != null && Number.isFinite(targetDbm)
  const measured = ps && power != null && Number.isFinite(power) ? power : null
  const errDb = hasTarget && measured != null ? measured - targetDbm : null
  const errTone: 'ok' | 'warn' | 'bad' | undefined =
    errDb == null
      ? undefined
      : Math.abs(errDb) <= toleranceDb
        ? 'ok'
        : Math.abs(errDb) <= toleranceDb * 2
          ? 'warn'
          : 'bad'

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
          {staticData?.label ?? 'Measurement'}
        </Typography>
        {/* State where the number came from: a corrected reading that doesn't
            say so looks like the sensor disagrees with the DUT. */}
        {!isStatic && pathLossDb !== 0 && (
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
            incl. {pathLossDb > 0 ? '+' : ''}{pathLossDb} dB path loss
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {staticData?.subLabel && (
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{staticData.subLabel}</Typography>
        )}
        {!isStatic && data?.t_ms != null && (
          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{data.t_ms} ms</Typography>
        )}
        {!isStatic && (
          <>
            <Tooltip title={anyConnected ? 'Re-measure' : 'No instruments connected'}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={fire}
                  disabled={measure.isPending || !anyConnected}
                  startIcon={measure.isPending ? <CircularProgress size={12} color="inherit" /> : <RefreshIcon sx={{ fontSize: 16 }} />}
                  sx={{ minWidth: 0, height: 26, fontSize: 12, px: 1.25 }}
                >
                  {measure.isPending ? 'Reading' : 'Read'}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Connect instruments">
              <Button
                size="small"
                variant="outlined"
                onClick={() => openInstruments(true)}
                startIcon={<CableIcon sx={{ fontSize: 16 }} />}
                sx={{ minWidth: 0, height: 26, fontSize: 12, px: 1.25 }}
              >
                Connect
              </Button>
            </Tooltip>
          </>
        )}
      </Stack>

      <StatRow>
        {hasTarget && (
          <StatTile
            label="Target"
            value={num(targetDbm, 2)}
            unit="dBm"
            sub="requested"
          />
        )}
        <StatTile
          label={hasTarget ? 'Measured' : 'TX Power'}
          value={ps ? num(power, 2) : '—'}
          unit={ps && power != null ? 'dBm' : undefined}
          sub={
            !ps
              ? 'sensor off'
              : power_mW != null
                ? `${power_mW.toFixed(2)} mW`
                : isStatic ? undefined : 'not read yet'
          }
          off={!ps}
        />
        {hasTarget && (
          <StatTile
            label="Error"
            value={errDb == null ? '—' : `${errDb >= 0 ? '+' : '−'}${Math.abs(errDb).toFixed(2)}`}
            unit={errDb == null ? undefined : 'dB'}
            sub={
              errDb == null
                ? 'no reading'
                : errTone === 'ok'
                  ? `within ±${toleranceDb} dB`
                  : `outside ±${toleranceDb} dB`
            }
            tone={errTone}
            off={errDb == null}
          />
        )}
        {/* Supply voltage rides along as the current's context rather than its
            own tile: it is the condition the current was drawn under, and a
            fifth tile pushed the strip into a ragged second row. */}
        <StatTile
          label="Current"
          value={dc ? num(cur_mA, 1) : '—'}
          unit={dc && cur_mA != null ? 'mA' : undefined}
          sub={dc ? (showVolt && volt != null ? `at ${volt.toFixed(3)} V` : undefined) : 'DC off'}
          off={!dc}
        />
      </StatRow>

      {!isStatic && data?.error && (
        <Typography sx={{ fontSize: 11, color: 'error.main', mt: 1 }}>{data.error}</Typography>
      )}
      {!isStatic && measure.error && (
        <Typography sx={{ fontSize: 11, color: 'error.main', mt: 1 }}>
          {(measure.error as Error).message}
        </Typography>
      )}
    </Box>
  )
}
