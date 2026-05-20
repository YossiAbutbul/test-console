import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, CircularProgress, FormControl, MenuItem, Select, Stack,
  TextField, Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ble, scanStream } from '../api/ble'
import { useConnection } from '../context/ConnectionContext'
import { useLog } from '../context/LogContext'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import type { ScannedDevice } from '../types/models'

function actionSx(c: { bg: string; bgHover: string; fg: string }) {
  return {
    bgcolor: c.bg,
    color: c.fg,
    border: `1px solid ${c.bg}`,
    '&:hover': { bgcolor: c.bgHover, borderColor: c.bgHover },
    '&.Mui-disabled': {
      bgcolor: c.bg,
      color: c.fg,
      opacity: 0.5,
      pointerEvents: 'none',
      '&:hover': { bgcolor: c.bg, borderColor: c.bg },
    },
  } as const
}


const NAME_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CATM2', label: 'CAT-M 2' },
  { value: 'Sonata2IL', label: 'Sonata 2 IL' },
  { value: 'int2g', label: 'Interpreter G2' },
]

export function ConnectionPanel() {
  const { status, selectedAddr, setSelectedAddr } = useConnection()
  const { log } = useLog()
  const { mode } = useThemeMode()
  const a = getAppPalette(mode).actions
  const qc = useQueryClient()
  const [duration, setDuration] = useState(5)
  const [nameFilter, setNameFilter] = useState('CATM2')
  const [devices, setDevices] = useState<ScannedDevice[]>([])
  const [acOpen, setAcOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const acInputRef = useRef<HTMLInputElement>(null)
  const stopScanRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopScanRef.current?.(), [])

  const startScan = () => {
    if (scanning) {
      stopScanRef.current?.()
      stopScanRef.current = null
      setScanning(false)
      return
    }
    setDevices([])
    setScanning(true)
    setAcOpen(true)
    acInputRef.current?.focus()
    log(`Scan started (${duration}s)`)
    stopScanRef.current = scanStream(duration, {
      onDevice: (d) => {
        setDevices((prev) => {
          const idx = prev.findIndex((p) => p.address === d.address)
          const next = idx >= 0 ? [...prev.slice(0, idx), d, ...prev.slice(idx + 1)] : [...prev, d]
          next.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
          return next
        })
      },
      onDone: (count) => {
        setScanning(false)
        stopScanRef.current = null
        log(`Scan done: ${count} advertisement(s)`)
      },
      onError: (msg) => {
        setScanning(false)
        stopScanRef.current = null
        log(`Scan failed: ${msg}`, 'error')
      },
    })
  }

  const connect = useMutation({
    mutationFn: (addr: string) => ble.connect(addr),
    onSuccess: (s) => {
      log(`Connected: ${s.name ?? s.address}`)
      qc.invalidateQueries({ queryKey: ['ble-status'] })
    },
    onError: (e: Error) => log(`Connect failed: ${e.message}`, 'error'),
  })

  const disconnect = useMutation({
    mutationFn: () => ble.disconnect(),
    onSuccess: () => {
      log('Disconnected')
      setSelectedAddr(null)
      qc.invalidateQueries({ queryKey: ['ble-status'] })
    },
    onError: (e: Error) => log(`Disconnect failed: ${e.message}`, 'error'),
  })

  const filteredDevices = useMemo(() => {
    if (!nameFilter) return devices
    const q = nameFilter.toLowerCase()
    return devices.filter((d) => (d.name ?? '').toLowerCase().includes(q))
  }, [devices, nameFilter])

  const isConnected = !!status?.connected
  const busy = connect.isPending || disconnect.isPending
  const isKnownDevice = !!selectedAddr && devices.some((d) => d.address === selectedAddr)
  const canConnect = isKnownDevice && !busy
  const toggle = () => {
    if (isConnected) disconnect.mutate()
    else if (selectedAddr) {
      if (scanning) {
        stopScanRef.current?.()
        stopScanRef.current = null
        setScanning(false)
      }
      connect.mutate(selectedAddr)
    }
  }

  const fieldLabel = (text: string) => (
    <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>{text}</Typography>
  )

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        <Box sx={{ width: 110 }}>
          {fieldLabel('Duration (sec)')}
          <TextField
            type="number"
            size="small"
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            inputProps={{ min: 1, max: 30 }}
            fullWidth
            disabled={isConnected || scanning}
          />
        </Box>

        <Box sx={{ minWidth: 170 }}>
          {fieldLabel('Device type')}
          <FormControl size="small" fullWidth disabled={isConnected || scanning}>
            <Select
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              displayEmpty
              renderValue={(v) =>
                NAME_FILTERS.find((o) => o.value === v)?.label ?? 'All'
              }
            >
              {NAME_FILTERS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ minWidth: 340, flex: 1 }}>
          {fieldLabel('MAC Address')}
          <Autocomplete
          size="small"
          freeSolo
          disabled={isConnected}
          open={acOpen}
          onOpen={() => setAcOpen(true)}
          onClose={() => setAcOpen(false)}
          options={filteredDevices}
          getOptionLabel={(opt) =>
            typeof opt === 'string' ? opt : opt.address
          }
          value={selectedAddr ?? ''}
          onChange={(_, v) => {
            if (!v) setSelectedAddr(null)
            else if (typeof v === 'string') setSelectedAddr(v)
            else setSelectedAddr(v.address)
          }}
          onInputChange={(_, v, reason) => {
            if (reason === 'input') setSelectedAddr(v || null)
          }}
          filterOptions={(opts, state) => {
            const q = state.inputValue.toLowerCase()
            if (!q) return opts
            return opts.filter(
              (o) =>
                o.address.toLowerCase().includes(q) ||
                (o.name ?? '').toLowerCase().includes(q),
            )
          }}
          renderOption={(props, opt) => (
            <Box component="li" {...props} key={opt.address} sx={{ py: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ fontWeight: 500, fontSize: 13 }}>{opt.name ?? '(unnamed)'}</Box>
                  <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'text.secondary' }}>
                    {opt.address}
                  </Box>
                </Box>
                <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {opt.rssi ?? '—'} dBm
                </Box>
              </Box>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Pick from scan or type MAC"
              inputRef={acInputRef}
              InputProps={{
                ...params.InputProps,
                sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
              }}
            />
          )}
          fullWidth
        />
        </Box>

        <Button
          variant="contained"
          onClick={startScan}
          disabled={isConnected}
          sx={{ minWidth: 110, height: 36, ...actionSx(scanning ? a.danger : a.scan) }}
        >
          {scanning ? 'Stop' : 'Scan'}
        </Button>

        <Button
          variant="contained"
          disabled={isConnected ? busy : !canConnect}
          onClick={toggle}
          endIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{ minWidth: 130, height: 36, ...actionSx(isConnected ? a.disconnect : a.connect) }}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </Button>
      </Stack>
    </Box>
  )
}
