import { useCallback, useEffect, useRef, useState } from 'react'
import { freqAccuracy, type FreqAccuracyStart, type FreqAccuracyStatus } from '../../api/freqAccuracy'
import { useLog } from '../../context/LogContext'
import { formatErrorHz, mhzToHz } from './stages'

export type RunOrigin = 'manual' | 'automation'

const POLL_MS = 400

/**
 * One frequency accuracy run at a time, shared by both tabs: the backend has a
 * single run, so whichever tab started it owns the status, and Stop in the
 * header ends it from either.
 */
export function useFreqRun(onFinished?: (st: FreqAccuracyStatus, origin: RunOrigin) => void) {
  const { log } = useLog()
  const [status, setStatus] = useState<FreqAccuracyStatus | null>(null)
  const [origin, setOrigin] = useState<RunOrigin | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const running = status?.state === 'running'

  // Read by the poll, which outlives the render that started it.
  const finished = useRef(onFinished)
  const originRef = useRef(origin)
  useEffect(() => {
    finished.current = onFinished
    originRef.current = origin
  })

  // Each point is logged once, when it lands.
  const logged = useRef(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      freqAccuracy.status().then((st) => {
        setStatus(st)
        const landed = st.points.filter((p) => p.state === 'done' || p.state === 'error')
        for (const p of landed.slice(logged.current)) {
          const f = (p.freq_hz / 1e6).toFixed(4)
          if (p.result) {
            log('Spectrum', `${f} MHz: measured ${mhzToHz(p.result.measured_hz)} MHz, error ${formatErrorHz(p.result.error_hz)} Hz (${p.result.error_ppm.toFixed(3)} ppm)`)
          } else {
            log('Spectrum', `${f} MHz: ${p.error ?? 'failed'}`, 'error')
          }
          for (const w of p.warnings) log('Spectrum', `${f} MHz: ${w}`, 'warn')
        }
        logged.current = landed.length
        if (st.state !== 'running') {
          setStopping(false)
          for (const w of st.warnings) log('Spectrum', w, 'warn')
          if (st.state === 'cancelled') log('Spectrum', 'Frequency accuracy stopped', 'warn')
          if (originRef.current) finished.current?.(st, originRef.current)
        }
      }).catch(() => { /* a missed poll is retried by the next one */ })
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [running, log])

  const start = useCallback(async (req: FreqAccuracyStart, from: RunOrigin) => {
    setStartError(null)
    setStarting(true)
    try {
      logged.current = 0
      const st = await freqAccuracy.start(req)
      setOrigin(from)
      setStatus(st)
      const n = req.points.length
      log('Spectrum', n === 1
        ? `Frequency accuracy started at ${(req.points[0].freq_hz / 1e6).toFixed(4)} MHz, ${req.stages.length} stages`
        : `Frequency accuracy started: ${n} points, ${req.stages.length} stages each`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStartError(msg)
      setOrigin(from)
      log('Spectrum', `Frequency accuracy did not start: ${msg}`, 'error')
    } finally {
      setStarting(false)
    }
  }, [log])

  const stop = useCallback(() => {
    setStopping(true)
    freqAccuracy.cancel().catch((e: Error) => {
      setStopping(false)
      log('Spectrum', `Stop failed: ${e.message}`, 'error')
    })
  }, [log])

  return { status, origin, running, starting, stopping, startError, start, stop }
}
