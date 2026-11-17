/**
 * Trombone motor control for the Load Pull page: live status polling,
 * press-and-hold continuous jog, soft-limit sync from the captured range, and
 * a wait-for-idle helper for the sweep loop.
 *
 * Kept out of the page component so LoadPullPage stays layout-focused.
 */
import {
  useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { sleep } from '../../lib/async'
import { startJogSession, type JogSession } from '../../lib/jogSession'

const POLL_MS = 500
const MOTOR_WAIT_TIMEOUT_MS = 60_000

export interface TromboneJogArgs {
  running: boolean
  /** This page is the one on screen. */
  active: boolean
  /** A Load Pull run is going, this page's or the other radio's. */
  anyRunning: boolean
  /** The travel limits, in pulses: the extent of every captured range end.
   *  Null for either leaves the jog free on that side. */
  limitLo: number | null
  limitHi: number | null
  jogSpeed: number
  /** Holds the current run's controller; Stop aborts it. */
  abortRef: RefObject<AbortController>
}

export function useTromboneJog({
  running, active, anyRunning, limitLo, limitHi, jogSpeed, abortRef,
}: TromboneJogArgs) {
  const { log } = useLog()
  const notify = useNotify()
  const qc = useQueryClient()

  // Poll continuously (not gated on connected) so the page picks up a trombone
  // connected later via the Instruments modal — otherwise an early
  // connected:false would latch polling off and the jog controls stay disabled.
  const statusQ = useQuery({
    queryKey: ['motor', 'status'],
    queryFn: motor.status,
    // On screen, or mid-run (the page may be watched again at any moment).
    // Two Load Pull pages and the Trombone page share this query; hidden,
    // they kept /motor/status going twice a second on the motor's bus and
    // re-rendered three pages at every step of the trombone.
    refetchInterval: active || running ? POLL_MS : false,
    refetchOnWindowFocus: false,
  })
  const motorS = statusQ.data
  const motorConnected = !!motorS?.connected
  const motorMoving = !!motorS?.moving
  const motorPos = motorS?.position ?? null

  const refreshMotor = () => qc.invalidateQueries({ queryKey: ['motor', 'status'] })

  // Continuous jog: press-and-hold a direction → motor runs at a reduced speed
  // until released. A ref tracks the active direction so key-repeat / duplicate
  // keydown doesn't restart it, and so we only stop the jog we started.
  //
  // Each hold is a session (lib/jogSession.ts): its stop waits for its start,
  // and it keeps the backend's deadman fed while held.
  const jogDirRef = useRef<number>(0)
  const sessionRef = useRef<JogSession | null>(null)
  const lastStopRef = useRef<Promise<void>>(Promise.resolve())
  const [jogDir, setJogDir] = useState<number>(0)
  const startJog = (positive: boolean) => {
    if (!motorConnected || running) return
    const dir = positive ? 1 : -1
    if (jogDirRef.current === dir) return
    // Reversed mid-hold: the old session stops before the new one starts.
    if (sessionRef.current) lastStopRef.current = sessionRef.current.stop().catch(() => {})
    jogDirRef.current = dir
    setJogDir(dir)
    const session = startJogSession(positive, jogSpeed, (e) => {
      if (sessionRef.current !== session) return
      sessionRef.current = null
      jogDirRef.current = 0
      setJogDir(0)
      log('Motor', `jog ${positive ? '+' : '−'} failed: ${e.message}`, 'error')
      if (!/limit/i.test(e.message)) notify.error(e.message, { title: 'Trombone jog' })
    }, lastStopRef.current)
    sessionRef.current = session
  }
  const stopJog = () => {
    const session = sessionRef.current
    sessionRef.current = null
    jogDirRef.current = 0
    setJogDir(0)
    if (!session) return
    lastStopRef.current = session.stop()
      .then(() => { void refreshMotor() })
      .catch((e: Error) => log('Motor', `jog stop failed: ${e.message}`, 'error'))
  }

  // The captured range ends define the travel range — push their extent to
  // the backend as soft limits. While none is captured (or the range dialog is
  // open, see the page), limits are cleared so the user can jog freely to
  // find the ends.
  //
  // The limits are the motor's, one pair, but the ends are per page: LoRa and
  // LTE Load Pull are mounted together, and each used to push its own on any
  // change, so whichever ran last won. After a backend restart that was the
  // LoRa page's, and an LTE run's last two positions were refused as outside
  // them in every cycle. So only the page on screen pushes, and no page does
  // while a run is going: the run sets them from its own plan, and the page on
  // screen takes them back when it ends.
  useEffect(() => {
    if (!active || anyRunning) return
    const apply = limitLo != null && limitHi != null
      ? motor.setLimits(limitLo, limitHi)
      : motor.setLimits(null, null)
    void apply.then(() => refreshMotor()).catch(() => { /* ignore */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitLo, limitHi, active, anyRunning])

  // Keyboard jog: hold ← / → while the jog pad is focused; release/blur stops.
  const [jogFocused, setJogFocused] = useState(false)
  const onJogKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    if (e.repeat) return
    if (!motorConnected || running) return
    startJog(e.key === 'ArrowRight')
  }
  const onJogKeyUp = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      stopJog()
    }
  }

  // Safety: stop any running jog when the component unmounts.
  useEffect(() => () => { void sessionRef.current?.stop().catch(() => {}) }, [])

  // Used by the sweep loop: block until the motor reports idle (or abort).
  const waitForMotorIdle = async (): Promise<void> => {
    const { signal } = abortRef.current
    const t0 = Date.now()
    await sleep(120, signal)
    while (Date.now() - t0 < MOTOR_WAIT_TIMEOUT_MS) {
      if (signal.aborted) return
      const s = await motor.status()
      if (!s.moving) return
      await sleep(150, signal)
    }
    throw new Error('motor move timed out')
  }

  return {
    motorConnected, motorMoving, motorPos,
    refreshMotor,
    jogDir, jogFocused, setJogFocused,
    startJog, stopJog, onJogKeyDown, onJogKeyUp,
    waitForMotorIdle,
  }
}
