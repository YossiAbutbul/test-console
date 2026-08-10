import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, CircularProgress, FormControl, IconButton, MenuItem, Select, Stack,
  TextField, Tooltip, Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useNicknames } from '../context/NicknamesContext'
import { usePathLoss } from '../context/PathLossContext'
import { NicknameModal } from './NicknameModal'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ble, scanStream } from '../api/ble'
import { useConnection } from '../context/ConnectionContext'
import { useLog } from '../context/LogContext'
import { useThemeMode } from '../context/ThemeModeContext'
import { getAppPalette } from '../theme'
import type { ScannedDevice } from '../types/models'
import { STORAGE_KEYS, usePersistedState } from '../store'

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
  const nicknames = useNicknames()
  const { pathLossDb, setPathLossDb } = usePathLoss()
  const [editMac, setEditMac] = useState<string | null>(null)
  const qc = useQueryClient()
  const [duration, setDuration] = useState(5)
  // Persisted: the rig is wired for one device type at a time, so resetting to
  // the default on every reload just meant re-picking it before every scan.
  const [nameFilter, setNameFilter] = usePersistedState(STORAGE_KEYS.deviceType, 'Sonata2IL')
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
    log('DUT', `Scan started (${duration}s)`)
    stopScanRef.current = scanStream(duration, {
      onDevice: (d) => {
        setDevices((prev) => {
          const idx = prev.findIndex((p) => p.address === d.address)
          const next = idx >= 0 ? [...prev.slice(0, idx), d, ...prev.slice(idx + 1)] : [...prev, d]
          next.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
          return next
        })
      },
      onDone: () => {
        setScanning(false)
        stopScanRef.current = null
      },
      onError: (msg) => {
        setScanning(false)
        stopScanRef.current = null
        log('DUT', `Scan failed: ${msg}`, 'error')
      },
    })
  }

  const connect = useMutation({
    mutationFn: (addr: string) => ble.connect(addr),
    onSuccess: (s) => {
      log('DUT', `Connected: ${s.address}`)
      qc.invalidateQueries({ queryKey: ['ble-status'] })
    },
    onError: (e: Error) => log('DUT', `Connect failed: ${e.message}`, 'error'),
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const addr = status?.address ?? selectedAddr ?? ''
      await ble.disconnect()
      return addr
    },
    onSuccess: (addr) => {
      log('DUT', `Disconnected: ${addr || '(unknown)'}`)
      setSelectedAddr(null)
      qc.invalidateQueries({ queryKey: ['ble-status'] })
    },
    onError: (e: Error) => log('DUT', `Disconnect failed: ${e.message}`, 'error'),
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

  const [copied, setCopied] = useState(false)
  const onCopyMac = async () => {
    if (!selectedAddr) return
    try {
      await navigator.clipboard.writeText(selectedAddr.replace(/:/g, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  const fieldLabel = (text: string) => (
    <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 0.5 }}>{text}</Typography>
  )

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        <Box sx={{ width: 110 }}>
          {fieldLabel('Path loss (dB)')}
          <TextField
            type="number"
            size="small"
            value={pathLossDb}
            onChange={(e) => setPathLossDb(Number(e.target.value) || 0)}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            inputProps={{ step: 0.1 }}
            fullWidth
          />
        </Box>

        <Box sx={{ width: 110 }}>
          {fieldLabel('Duration (sec)')}
          <TextField
            type="number"
            size="small"
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
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

        <Box sx={{ minWidth: 340, flex: 1, position: 'relative' }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 0.5, gap: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500 }}>MAC Address</Typography>
            {(() => {
              const nick = selectedAddr ? nicknames.get(selectedAddr) : undefined
              if (!nick || !selectedAddr) return null
              const color = nicknames.colorFor(selectedAddr)
              return (
                <Box
                  component="span"
                  sx={{
                    px: 0.85, py: 0.1, borderRadius: 0.75,
                    fontSize: 11, fontWeight: 600, lineHeight: 1.4,
                    bgcolor: color.bg, color: color.fg,
                  }}
                >
                  {nick}
                </Box>
              )
            })()}
            <Box sx={{ flexGrow: 1 }} />
            {selectedAddr && !isConnected && (
              <Typography
                component="button"
                type="button"
                onClick={() => setSelectedAddr(null)}
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  p: 0,
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
              >
                Clear
              </Typography>
            )}
          </Stack>
          <Autocomplete
          size="small"
          freeSolo
          disableClearable
          disabled={isConnected}
          open={acOpen && filteredDevices.length > 0}
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
            const filtered = !q ? opts : opts.filter(
              (o) =>
                o.address.toLowerCase().includes(q) ||
                (o.name ?? '').toLowerCase().includes(q) ||
                (nicknames.get(o.address) ?? '').toLowerCase().includes(q),
            )
            // Tagged devices first, then by RSSI strength (already sorted in scan)
            return [...filtered].sort((a, b) => {
              const ta = nicknames.get(a.address) ? 1 : 0
              const tb = nicknames.get(b.address) ? 1 : 0
              return tb - ta
            })
          }}
          renderOption={(props, opt) => {
            const nick = nicknames.get(opt.address)
            const color = nicknames.colorFor(opt.address)
            return (
              <Box component="li" {...props} key={opt.address} sx={{ py: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Box sx={{ fontWeight: 500, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {opt.name ?? '(unnamed)'}
                      </Box>
                      {nick && (
                        <Box
                          component="span"
                          sx={{
                            px: 0.85, py: 0.15, borderRadius: 0.75,
                            fontSize: 12, fontWeight: 600, lineHeight: 1.4,
                            bgcolor: color.bg, color: color.fg,
                            flexShrink: 0,
                          }}
                        >
                          {nick}
                        </Box>
                      )}
                    </Box>
                    <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, color: 'text.secondary' }}>
                      {opt.address}
                    </Box>
                  </Box>
                  <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {opt.rssi ?? '—'} dBm
                  </Box>
                </Box>
              </Box>
            )
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Pick from scan or type MAC"
              inputRef={acInputRef}
              InputProps={{
                ...params.InputProps,
                sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
                endAdornment: (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    {selectedAddr && isKnownDevice && (
                      <Tooltip title="Edit nickname" placement="top">
                        <IconButton
                          size="small"
                          onClick={() => setEditMac(selectedAddr)}
                          sx={{ p: 0.5, '&:hover': { bgcolor: 'transparent' } }}
                        >
                          <EditOutlinedIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={!selectedAddr ? '' : copied ? 'Copied!' : 'Copy MAC'} placement="top">
                      <span>
                        <IconButton
                          size="small"
                          onClick={onCopyMac}
                          disabled={!selectedAddr}
                          sx={{
                            p: 0.5,
                            '&:hover': { bgcolor: 'transparent' },
                            '&.Mui-disabled': { opacity: 0.4 },
                          }}
                        >
                          {copied
                            ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
                            : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    {params.InputProps.endAdornment}
                  </Box>
                ),
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
      <NicknameModal mac={editMac} onClose={() => setEditMac(null)} />
    </Box>
  )
}
