import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ble, scanStream } from '../api/ble'
import { useConnection } from './ConnectionContext'
import { useLog } from './LogContext'
import { STORAGE_KEYS, usePersistedState } from '../store'
import type { ScannedDevice } from '../types/models'
import { DutLinkCtx, type DutLink } from './dutLink'

/** Owns the one DUT scan and link; see `DutLink` for why it lives up here. */
export function DutLinkProvider({ children }: { children: ReactNode }) {
  const { status, selectedAddr, setSelectedAddr } = useConnection()
  const { log } = useLog()
  const qc = useQueryClient()
  const [duration, setDuration] = useState(5)
  // Persisted: the rig is wired for one device type at a time, so resetting to
  // the default on every reload just meant re-picking it before every scan.
  const [nameFilter, setNameFilter] = usePersistedState(STORAGE_KEYS.deviceType, 'Sonata2IL')
  const [devices, setDevices] = useState<ScannedDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const stopScanRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopScanRef.current?.(), [])

  const toggleScan = useCallback(() => {
    if (stopScanRef.current || scanning) {
      stopScanRef.current?.()
      stopScanRef.current = null
      setScanning(false)
      return
    }
    setDevices([])
    setScanning(true)
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
  }, [scanning, duration, log])

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
  const { mutate: connectMutate } = connect
  const { mutate: disconnectMutate } = disconnect
  const toggleConnect = useCallback(() => {
    if (isConnected) disconnectMutate()
    else if (selectedAddr) {
      if (stopScanRef.current) {
        stopScanRef.current()
        stopScanRef.current = null
        setScanning(false)
      }
      connectMutate(selectedAddr)
    }
  }, [isConnected, selectedAddr, connectMutate, disconnectMutate])

  const value = useMemo<DutLink>(() => ({
    duration, setDuration, nameFilter, setNameFilter, devices, filteredDevices,
    scanning, toggleScan, isConnected, busy, isKnownDevice, canConnect, toggleConnect,
  }), [
    duration, nameFilter, setNameFilter, devices, filteredDevices, scanning, toggleScan,
    isConnected, busy, isKnownDevice, canConnect, toggleConnect,
  ])

  return <DutLinkCtx.Provider value={value}>{children}</DutLinkCtx.Provider>
}
