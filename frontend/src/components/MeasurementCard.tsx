import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Tooltip, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import { useMutation } from '@tanstack/react-query'
import { instrumentsApi, type MeasureResponse } from '../api/instruments'
import { useInstruments } from '../context/InstrumentsContext'
import { usePathLoss } from '../context/PathLossContext'
import { describeMeasureError } from '../lib/instrumentError'
import { useAppPalette } from '../context/ThemeModeContext'
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
  const { instruments, connect } = useInstruments()
  const { pathLossDb } = usePathLoss()
  const p = useAppPalette()
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
  const [connecting, setConnecting] = useState(false)

  /**
   * Read, bringing the instruments up first if nothing is connected.
   *
   * Read used to sit disabled behind a separate Connect button, which made
   * the operator perform a step the app can do itself. `connect` is a no-op
   * for anything already up, so the common case costs nothing.
   */
  const fire = useCallback(async () => {
    if (!anyConnected) {
      setConnecting(true)
      try {
        // Sequential: these are USB/VISA sessions and the vendor layers do
        // not reliably tolerate concurrent opens.
        await connect('power-sensor')
        await connect('dc-analyzer')
      } finally {
        setConnecting(false)
      }
    }
    measure.mutate()
  }, [anyConnected, connect, measure])

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
  const busy = connecting || measure.isPending
  // A failed request and a request that returned an error field are the same
  // event to the operator; only the transport differs.
  const rawError = measure.error
    ? (measure.error as Error).message
    : data?.error ?? null
  const failure = rawError ? describeMeasureError(rawError) : null

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
          <Tooltip
            title={anyConnected ? 'Re-measure' : 'Connect the instruments and read'}
          >
            <span>
              <Button
                size="small"
                variant="outlined"
                onClick={fire}
                disabled={busy}
                startIcon={
                  busy
                    ? <CircularProgress size={12} color="inherit" />
                    : <RefreshIcon sx={{ fontSize: 16 }} />
                }
                sx={{ minWidth: 84, height: 26, fontSize: 12, px: 1.25 }}
              >
                {connecting ? 'Connecting' : measure.isPending ? 'Reading' : 'Read'}
              </Button>
            </span>
          </Tooltip>
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
                // "not read yet" after a failed read is a lie — the read
                // happened, it just did not produce a number.
                : isStatic ? undefined : failure ? 'read failed' : 'not read yet'
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

      {!isStatic && failure && (
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            mt: 1, px: 1.25, py: 0.75,
            borderRadius: 1,
            bgcolor: p.data.highlight,
            border: 1,
            borderColor: 'divider',
            alignItems: 'flex-start',
          }}
        >
          <ErrorOutlineRoundedIcon
            sx={{ fontSize: 15, color: p.data.warn, mt: '1px', flexShrink: 0 }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary', lineHeight: 1.35 }}>
              {failure.title}
            </Typography>
            {failure.hint && (
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.35 }}>
                {failure.hint}
              </Typography>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  )
}
