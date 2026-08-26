import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Box, CircularProgress, Dialog, DialogContent, Stack, Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { device } from '../../api/device'
import { useLog } from '../../context/LogContext'
import type { CommandResponse } from '../../types/models'

/**
 * The LTE modem, as both LTE pages drive it.
 *
 * Shared rather than copied because it is one piece of hardware with one power
 * state, and the rules around it are subtle enough that two copies would
 * drift: a redundant MODEM_ON is refused, the DUT never reports its power
 * state back, and the modem runs one test at a time.
 *
 * Power is held by the operator rather than bracketed around each command —
 * the boot is ~10 s, so leaving it up makes a second send cost one frame
 * instead of eleven seconds. Nothing here powers it down except `toggle(false)`
 * and the down-leg of `cycle`.
 */

/**
 * A test believed to be running on the modem, and how to stop it.
 *
 * An abort closure rather than the request itself, so this stays protocol-
 * agnostic: CW and modulated abort with different frames, but the page that
 * started one already knows which. Holding it also means an abort uses the
 * parameters the test was *started* with, even if the form has been edited
 * since.
 */
export interface LiveTest {
  /** For the log line — "CW" or "modulated". */
  label: string
  abort: () => Promise<CommandResponse>
}

export interface LteModem {
  /**
   * What we believe the modem's power state to be.
   *
   * Only ever a belief: the DUT will not report it, and this resets on every
   * page load while the hardware keeps running, so drift is routine rather
   * than exceptional. A redundant MODEM_ON is *not* free — the modem refuses
   * it — so when a power command fails the belief moves to `true`, which is
   * the state the operator can act on: the key then offers MODEM_OFF, and off
   * then on is a way back to somewhere known.
   */
  on: boolean
  /** A power command is in flight. */
  busy: boolean
  toggle: (next: boolean) => void
  /**
   * Power down and back up, so a run starts from a known modem rather than
   * from what the page believes. Throws if it will not come up.
   */
  cycle: () => Promise<void>
  /**
   * Get the modem ready to be handed a new test: power it up if it is down,
   * and abort whatever is running on it.
   *
   * The abort is not optional. The modem takes one test at a time and drops a
   * START that arrives while another is running — which looks like a command
   * that succeeded but changed nothing, with the radio still on the old
   * parameters.
   */
  prepare: () => Promise<void>
  getRunning: () => LiveTest | null
  setRunning: (t: LiveTest | null) => void
  /** "Turning on modem" — rendered by the page, covers the ~10 s boot. */
  dialog: ReactNode
}

interface Options {
  /** Called with each power frame, so the page can show it under Last frame. */
  onFrame?: (r: CommandResponse) => void
}

export function useLteModem({ onFrame }: Options = {}): LteModem {
  const { log } = useLog()

  // Mirrored into a ref because an automation run spans many renders and reads
  // the power state long after the one it started in.
  const [on, setOnState] = useState(false)
  const onRef = useRef(false)
  const setOn = useCallback((v: boolean) => {
    onRef.current = v
    setOnState(v)
  }, [])

  const runningRef = useRef<LiveTest | null>(null)

  /**
   * True only while a MODEM_ON frame is actually in flight.
   *
   * Set explicitly rather than derived from a mutation's pending flag: that is
   * also true while Send is still in its instrument preflight, and `!on` is
   * briefly true midway through a power-*off* — either would put "Turning on
   * modem" on screen when nothing is being turned on.
   */
  const [starting, setStarting] = useState(false)

  const startModem = useCallback(async () => {
    setStarting(true)
    try {
      const r = await device.lteModemOn()
      onFrame?.(r)
      log('DUT', `LTE modem on: ok=${r.ok} status=${r.status} · rx ${r.rx_hex}`)
      // Held on even when it refuses.
      //
      // We cannot read the modem's power state back from the DUT, and a
      // refusal tells us nothing about which state it is in — the likeliest
      // reasons are that it is already up, or busy with a test that outlived
      // the page. Recording it as off would leave the key offering the one
      // command that just failed, with no way to send MODEM_OFF and get back
      // to a known state. On is the state the operator can act on.
      setOn(true)
      runningRef.current = null
      if (!r.ok) {
        throw new Error(
          `modem on rejected (status ${r.status}). `
          + 'It may already be on, or still running a test — power it off and on again.',
        )
      }
    } finally {
      setStarting(false)
    }
  }, [log, onFrame, setOn])

  const cycle = useCallback(async () => {
    // Down first and unconditionally, rather than skipping the boot when we
    // think it is already up. Our idea of the power state is only a belief —
    // it resets on every page load while the hardware keeps running — and a
    // test left over from the manual tab or an earlier session would otherwise
    // survive into the run and swallow the first point's START. A ~10 s boot
    // once per run is a cheap price for starting from a known modem.
    try {
      const off = await device.lteModemOff()
      log('DUT', `LTE modem off (run start): ok=${off.ok} status=${off.status}`)
    } catch (e) {
      // Ignored on purpose: the likeliest reason it refused is that the modem
      // was already down, which is where this was trying to get to.
      log('DUT', `LTE modem off (run start) failed: ${(e as Error).message}`, 'warn')
    }
    setOn(false)
    runningRef.current = null
    await startModem()
  }, [log, setOn, startModem])

  const prepare = useCallback(async () => {
    // Sending with the modem down is a normal way to work, not a mistake, so
    // bring it up rather than refusing.
    if (!onRef.current) await startModem()
    const live = runningRef.current
    if (!live) return
    const prev = await live.abort()
    log('DUT', `LTE abort (previous ${live.label}): ok=${prev.ok} status=${prev.status}`)
    runningRef.current = null
  }, [log, startModem])

  const toggleM = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) return startModem()
      const r = await device.lteModemOff()
      onFrame?.(r)
      log('DUT', `LTE modem off: ok=${r.ok} status=${r.status} · rx ${r.rx_hex}`)
      // Recorded as off even on a non-zero status: the frame went out, and
      // claiming it is still on would make the next Send skip a MODEM_ON it
      // may well need.
      setOn(false)
      runningRef.current = null
    },
    onError: (e: Error) => log('DUT', `LTE modem toggle failed: ${e.message}`, 'error'),
  })

  const toggleMutate = toggleM.mutate
  const toggle = useCallback((next: boolean) => { toggleMutate(next) }, [toggleMutate])
  const busy = toggleM.isPending

  const getRunning = useCallback(() => runningRef.current, [])
  const setRunning = useCallback((t: LiveTest | null) => { runningRef.current = t }, [])

  const dialog = useMemo(() => (
    <Dialog open={starting} maxWidth="xs">
      <DialogContent>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={22} />
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              Turning on modem
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              A radio boot takes a few seconds.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  ), [starting])

  return useMemo(() => ({
    on, busy, toggle, cycle, prepare, getRunning, setRunning, dialog,
  }), [on, busy, toggle, cycle, prepare, getRunning, setRunning, dialog])
}
