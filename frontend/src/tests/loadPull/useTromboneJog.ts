/**
 * Trombone motor control for the Load Pull page: live status polling,
 * press-and-hold continuous jog, soft-limit sync from the captured zero/end,
 * Go-Zero / Go-End moves, and a wait-for-idle helper for the sweep loop.
 *
 * Kept out of the page component so LoadPullPage stays layout-focused.
 */
import {
  useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'
import { useNotify } from '../../context/NotifyContext'
import { sleep } from '../../lib/async'

const POLL_MS = 500
const MOTOR_WAIT_TIMEOUT_MS = 60_000

export interface TromboneJogArgs {
  running: boolean
  /** This page is the one on screen. */
  active: boolean
  /** A Load Pull run is going, this page's or the other radio's. */
  anyRunning: boolean
  zeroPulses: number | null
  endPulses: number | null
  jogSpeed: number
  /** Holds the current run's controller; Stop aborts it. */
  abortRef: RefObject<AbortController>
}

export function useTromboneJog({
  running, active, anyRunning, zeroPulses, endPulses, jogSpeed, abortRef,
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
  const onMotorOk = (label: string) => () => { log('Motor', `${label} ok`); refreshMotor() }
  const onMotorErr = (label: string) => (e: Error) => {
    log('Motor', `${label} failed: ${e.message}`, 'error')
    notify.error(e.message, { title: `Trombone ${label}` })
  }

  // Continuous jog: press-and-hold a direction → motor runs at a reduced speed
  // until released. A ref tracks the active direction so key-repeat / duplicate
  // keydown doesn't restart it, and so we only stop the jog we started.
  const jogDirRef = useRef<number>(0)
  const [jogDir, setJogDir] = useState<number>(0)
  const startJog = (positive: boolean) => {
    if (!motorConnected || running) return
    const dir = positive ? 1 : -1
    if (jogDirRef.current === dir) return
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

  // Min/Max jump to the user-captured zero/end (local state). Each enabled
  // independently as soon as its own point is captured.
  const travelMin = zeroPulses
  const travelMax = endPulses
  const goMinM = useMutation({ mutationFn: () => motor.move(travelMin ?? 0, true), onSuccess: onMotorOk('go zero'), onError: onMotorErr('go zero') })
  const goMaxM = useMutation({ mutationFn: () => motor.move(travelMax ?? 0, true), onSuccess: onMotorOk('go end'), onError: onMotorErr('go end') })
  const motorJogBusy = goMinM.isPending || goMaxM.isPending

  // The captured zero & end define the travel range — push them to the backend
  // as soft limits. While either is unset, limits are cleared so the user can
  // jog freely to find the ends.
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
    const apply = zeroPulses != null && endPulses != null
      ? motor.setLimits(Math.min(zeroPulses, endPulses), Math.max(zeroPulses, endPulses))
      : motor.setLimits(null, null)
    void apply.then(() => refreshMotor()).catch(() => { /* ignore */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeroPulses, endPulses, active, anyRunning])

  // Keyboard jog: hold ← / → while the jog pad is focused; release/blur stops.
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
    goMinM, goMaxM, motorJogBusy,
    travelMin, travelMax,
    waitForMotorIdle,
  }
}
