/**
 * Instrument preflight.
 *
 * Tests used to start regardless of what was connected: the DUT would
 * transmit, `/instruments/measure` would return nulls, and the run finished
 * with a table of blanks and no indication why. This connects everything a
 * test needs before the first point, shows what it is doing, and — if
 * something is still missing — makes the operator decide explicitly rather
 * than discovering it in the results.
 *
 * Usage:
 *
 *   const preflight = useInstrumentPreflight(['power-sensor', 'dc-analyzer'])
 *   ...
 *   if (!(await preflight.run())) return    // operator cancelled
 *   ...
 *   {preflight.dialog}
 */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  PreflightDialog, type PreflightStep,
} from '../../components/PreflightDialog'
import {
  CONNECT_TIMEOUT_MS, useInstrumentsActions, useInstrumentsState,
  type InstrumentId,
} from '../../context/InstrumentsContext'

export interface Preflight {
  /**
   * Connect everything the test needs. Resolves `true` when the test should
   * start — either every instrument came up, or the operator chose to run
   * without the ones that didn't.
   */
  run: () => Promise<boolean>
  /** Render this somewhere in the page. */
  dialog: ReactNode
}

export function useInstrumentPreflight(
  required: InstrumentId[],
  timeoutMs = CONNECT_TIMEOUT_MS,
): Preflight {
  const { instruments } = useInstrumentsState()
  const { connect, setOpen } = useInstrumentsActions()

  const [open, setOpenDialog] = useState(false)
  const [steps, setSteps] = useState<PreflightStep[]>([])
  const [busy, setBusy] = useState(false)
  // Fraction of the current instrument's timeout consumed, so a slow connect
  // reads as progressing rather than hung.
  const [elapsed, setElapsed] = useState(0)
  // Resolves the promise `run()` handed to the caller, once the operator picks.
  const decide = useRef<((proceed: boolean) => void) | null>(null)

  // `required` is written as a literal at every call site, so a new array
  // arrives each render; key on contents to keep `run` stable.
  const requiredKey = required.join(',')

  const settle = useCallback((proceed: boolean) => {
    setOpenDialog(false)
    decide.current?.(proceed)
    decide.current = null
  }, [])

  const run = useCallback(async (): Promise<boolean> => {
    const ids = requiredKey ? (requiredKey.split(',') as InstrumentId[]) : []
    if (ids.length === 0) return true
    // Everything is already up — don't flash a dialog at the operator.
    if (ids.every((id) => instruments[id].status === 'connected')) return true

    setSteps(ids.map((id) => ({
      id,
      label: instruments[id].label,
      state: instruments[id].status === 'connected' ? 'ok' : 'pending',
    })))
    setBusy(true)
    setOpenDialog(true)

    const mark = (id: InstrumentId, patch: Partial<PreflightStep>) =>
      setSteps((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)))

    // Sequential, not parallel: these are USB/VISA/serial sessions and the
    // vendor layers do not reliably tolerate concurrent opens.
    let failures = 0
    for (const id of ids) {
      if (instruments[id].status === 'connected') continue

      mark(id, { state: 'connecting', failure: undefined })
      setElapsed(0)
      const startedAt = Date.now()
      const ticker = window.setInterval(
        () => setElapsed(Math.min(1, (Date.now() - startedAt) / timeoutMs)),
        100,
      )
      try {
        const outcome = await connect(id, timeoutMs)
        if (!outcome.ok) failures += 1
        mark(id, {
          state: outcome.ok ? 'ok' : 'failed',
          failure: outcome.failure,
        })
      } finally {
        window.clearInterval(ticker)
        setElapsed(0)
      }
    }

    setBusy(false)

    if (failures === 0) {
      setOpenDialog(false)
      return true
    }
    // Hand the decision to the operator; `settle` resolves this.
    return new Promise<boolean>((resolve) => { decide.current = resolve })
  }, [requiredKey, instruments, connect, timeoutMs])

  const dialog = (
    <PreflightDialog
      open={open}
      steps={steps}
      busy={busy}
      elapsed={elapsed}
      timeoutMs={timeoutMs}
      onRunAnyway={() => settle(true)}
      onCancel={() => settle(false)}
      onOpenInstruments={() => { settle(false); setOpen(true) }}
    />
  )

  return { run, dialog }
}
