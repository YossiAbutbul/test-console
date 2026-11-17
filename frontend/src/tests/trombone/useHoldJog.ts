/**
 * Press-and-hold continuous jog for the Trombone page, the same feel as Load
 * Pull's. Not Load Pull's useTromboneJog: that hook also pushes the captured
 * zero/end to the motor as soft limits (and clears them while either is
 * unset), which on this page would wipe limits set elsewhere.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLog } from '../../context/LogContext'
import { startJogSession, type JogSession } from '../../lib/jogSession'

interface HoldJogArgs {
  /** False blocks starting a jog (disconnected, a move in flight). */
  enabled: boolean
  /** Pulses/s. */
  speed: number
  onStopped: () => void
}

export function useHoldJog({ enabled, speed, onStopped }: HoldJogArgs) {
  const { log } = useLog()
  // A ref tracks the active direction so key-repeat / duplicate keydown
  // doesn't restart it, and so we only stop the jog we started.
  // Each hold is a session (lib/jogSession.ts): its stop waits for its start,
  // and it keeps the backend's deadman fed while held.
  const dirRef = useRef<number>(0)
  const sessionRef = useRef<JogSession | null>(null)
  const lastStopRef = useRef<Promise<void>>(Promise.resolve())
  const [dir, setDir] = useState<number>(0)
  const [focused, setFocused] = useState(false)

  const start = (positive: boolean) => {
    if (!enabled) return
    const d = positive ? 1 : -1
    if (dirRef.current === d) return
    if (sessionRef.current) lastStopRef.current = sessionRef.current.stop().catch(() => {})
    dirRef.current = d
    setDir(d)
    const session = startJogSession(positive, speed, (e) => {
      if (sessionRef.current !== session) return
      sessionRef.current = null
      dirRef.current = 0
      setDir(0)
      log('Motor', `jog ${positive ? '+' : '−'} failed: ${e.message}`, 'error')
    }, lastStopRef.current)
    sessionRef.current = session
  }
  const stop = () => {
    const session = sessionRef.current
    sessionRef.current = null
    dirRef.current = 0
    setDir(0)
    if (!session) return
    lastStopRef.current = session.stop()
      .then(() => onStopped())
      .catch((e: Error) => log('Motor', `jog stop failed: ${e.message}`, 'error'))
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    if (e.repeat) return
    start(e.key === 'ArrowRight')
  }
  const onKeyUp = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      stop()
    }
  }

  // Safety: stop any running jog when the page unmounts.
  useEffect(() => () => { void sessionRef.current?.stop().catch(() => {}) }, [])

  return { dir, focused, setFocused, start, stop, onKeyDown, onKeyUp }
}
