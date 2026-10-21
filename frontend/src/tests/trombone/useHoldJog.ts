/**
 * Press-and-hold continuous jog for the Trombone page, the same feel as Load
 * Pull's. Not Load Pull's useTromboneJog: that hook also pushes the captured
 * zero/end to the motor as soft limits (and clears them while either is
 * unset), which on this page would wipe limits set elsewhere.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motor } from '../../api/motor'
import { useLog } from '../../context/LogContext'

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
  const dirRef = useRef<number>(0)
  const [dir, setDir] = useState<number>(0)
  const [focused, setFocused] = useState(false)

  const start = (positive: boolean) => {
    if (!enabled) return
    const d = positive ? 1 : -1
    if (dirRef.current === d) return
    dirRef.current = d
    setDir(d)
    motor.jogStart(positive, speed).catch((e: Error) => {
      dirRef.current = 0
      setDir(0)
      log('Motor', `jog ${positive ? '+' : '−'} failed: ${e.message}`, 'error')
    })
  }
  const stop = () => {
    if (dirRef.current === 0) return
    dirRef.current = 0
    setDir(0)
    motor.jogStop()
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
  useEffect(() => () => { if (dirRef.current !== 0) void motor.jogStop().catch(() => {}) }, [])

  return { dir, focused, setFocused, start, stop, onKeyDown, onKeyUp }
}
