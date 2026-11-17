import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ble } from '../../api/ble'
import { device } from '../../api/device'
import { useConnection } from '../../context/ConnectionContext'
import { useLog } from '../../context/LogContext'
import { useLiveOutputActions } from '../../context/liveOutput'
import { sleep } from '../../lib/async'
import type {
  BleToneRequest, BleToneResponse, BleTxPowerResponse, BleWrite,
} from '../../types/models'
import { RELINK_TIMEOUT_S, TONE_END_GRACE_MS, channelMhz } from './radio'

/**
 * The DUT's BLE radio, as the BLE test pages drive it.
 *
 * The radio under test is the one carrying our commands, and both of its test
 * commands take it off the link:
 *
 *     setPower(p)  ->  TX_POWER_SET -> SAVE_AND_RESET   (DUT reboots)
 *                  ->  relink -> TX_POWER_GET             (confirms it took)
 *     ensurePower  ->  TX_POWER_GET, then setPower only if it differs
 *     tone(req)    ->  TEST_TONE_START                  (DUT on air, off link)
 *     finishTone   ->  wait out the duration -> relink
 *
 * A tone cannot be cut short. There is no link to send a stop over, and the
 * DUT will not take a connection while it transmits, so it ends when its
 * duration runs out. Everything here is shaped by that: the page never offers
 * a Stop it cannot honour, and a run that is stopped still waits for the DUT
 * to come back rather than leaving it unreachable.
 *
 * Held at page level, like `useLteModem`, because the two tabs drive one
 * radio: the power the DUT is on and the tone on air are facts about it, not
 * about either tab.
 */

/** What the link is doing, for the header's status readout. */
export type BleLinkPhase =
  | { kind: 'idle' }
  | { kind: 'setting-power'; param: number }
  | { kind: 'rebooting'; param: number }
  | { kind: 'on-air'; channel: number; untilMs: number }
  | { kind: 'relinking' }
  | { kind: 'lost'; message: string }

export interface BleLink {
  phase: BleLinkPhase
  /**
   * The tone power the DUT is on, as last read back or confirmed, or null
   * when unknown.
   *
   * Null on every page load rather than restored: the DUT is asked instead
   * (`ensurePower` reads before it resets). It falls back to null whenever a
   * reset is in flight or a read could not be trusted, so nothing is ever
   * measured at a power that is only assumed.
   */
  power: number | null
  /** Ask the DUT which power it is on. Null when the answer cannot be
   *  trusted; never throws for what the DUT said. */
  readPower: (signal?: AbortSignal) => Promise<number | null>
  /** Set the power and wait for the DUT to come back on it. Throws if it is
   *  refused or the DUT does not return. */
  setPower: (param: number, signal?: AbortSignal) => Promise<BleTxPowerResponse>
  /** `setPower` unless the DUT is on `param` already -- by the last known
   *  power, or by reading it when that is unknown. Resolves true when it
   *  reset the DUT. */
  ensurePower: (param: number, signal?: AbortSignal) => Promise<boolean>
  /** Start a tone. The link is down from here until `finishTone`. Throws when
   *  the DUT answered with a refusal; an unanswered start is expected. */
  tone: (req: BleToneRequest, signal?: AbortSignal) => Promise<BleToneResponse>
  /**
   * Wait for the tone on air to end, then relink. A no-op with none on air.
   *
   * `signal` only stops the *waiting*: the DUT keeps transmitting either way,
   * and the tone is still recorded as on air, so a later call picks up where
   * this one left off.
   */
  finishTone: (signal?: AbortSignal) => Promise<void>
  /** Epoch ms the tone on air ends at, or null. Read from a ref, so a run can
   *  ask long after the render it started in. */
  onAirUntil: () => number | null
  /** Something here is in flight -- the tabs hold their sends meanwhile. */
  busy: boolean
}

interface Options {
  /** Called with each frame, so the page can show it under Last frame. */
  onFrame?: (w: BleWrite) => void
  /** Registry id of the page, for the top bar's BLE TX pill. */
  pageId?: string
}

const describe = (w: BleWrite): string =>
  w.acknowledged ? `ok=${w.ok} status=${w.status}` : `no reply (${w.error ?? 'link went'})`

export function useBleLink({ onFrame, pageId }: Options = {}): BleLink {
  const { log } = useLog()
  const { publish } = useLiveOutputActions()
  const { refetch: refetchConnection } = useConnection()

  const [phase, setPhase] = useState<BleLinkPhase>({ kind: 'idle' })
  const [power, setPowerState] = useState<number | null>(null)
  const powerRef = useRef<number | null>(null)
  const untilRef = useRef<number | null>(null)
  // Counts operations in flight rather than a flag, so a relink that ends
  // inside another operation does not mark the link idle under it.
  const [inFlight, setInFlight] = useState(0)

  const pillKey = pageId ? `ble-tx:${pageId}` : null

  // A page that goes away takes its pill with it.
  useEffect(() => {
    if (!pillKey) return
    return () => publish(pillKey, null)
  }, [pillKey, publish])

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setInFlight((n) => n + 1)
    try { return await work() } finally { setInFlight((n) => n - 1) }
  }, [])

  /** Scan for the DUT until it is back. The connection pill follows. */
  const relink = useCallback(async (signal?: AbortSignal) => {
    setPhase({ kind: 'relinking' })
    const t0 = performance.now()
    try {
      const st = await ble.relink(RELINK_TIMEOUT_S, { signal })
      // Timed, because the reconnect is the one step of a point nothing on
      // this side can shorten; the log is where to see whether it is worth
      // chasing on the BLE stack's side.
      log('DUT', `BLE relinked to ${st.address ?? 'DUT'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
      setPhase({ kind: 'idle' })
    } catch (e) {
      const message = (e as Error).message
      if (!signal?.aborted) setPhase({ kind: 'lost', message })
      throw e
    } finally {
      refetchConnection()
    }
  }, [log, refetchConnection])

  const remember = useCallback((p: number | null) => {
    powerRef.current = p
    setPowerState(p)
  }, [])

  const readPower = useCallback((signal?: AbortSignal) => track(async () => {
    const r = await device.bleTxPowerRead({ signal })
    if (r.param == null) {
      // Logged with the bytes: the reply layout comes from the DUT's read
      // convention, not a capture, and this is where a mismatch would show.
      log('DUT', `BLE tone power read: ${r.error ?? 'no value'}`
        + (r.data_hex ? ` · data ${r.data_hex}` : ''), 'warn')
    } else {
      log('DUT', `BLE tone power read: ${r.param}`)
    }
    remember(r.param)
    return r.param
  }), [log, remember, track])

  const setPower = useCallback((param: number, signal?: AbortSignal) => track(async () => {
    setPhase({ kind: 'setting-power', param })
    let r: BleTxPowerResponse
    try {
      r = await device.bleTxPower({ param }, { signal })
    } catch (e) {
      setPhase({ kind: 'idle' })
      throw e
    }
    onFrame?.(r.reset ?? r.set)
    log('DUT', `BLE tone power ${param}: set ${describe(r.set)}`
      + (r.reset ? ` · save-and-reset ${describe(r.reset)}` : ''))
    if (!r.released) {
      // The set was refused and nothing was reset: the DUT is where it was,
      // still on the link, and on whatever power it had before.
      setPhase({ kind: 'idle' })
      throw new Error(r.set.acknowledged
        ? `tone power ${param} refused (status ${r.set.status})`
        : `tone power ${param} not acknowledged — ${r.set.error ?? 'no reply'}`)
    }
    // Unknown until the DUT is back and answering: a reset that did not
    // happen would leave it on the old power with the belief saying otherwise.
    remember(null)
    refetchConnection()
    setPhase({ kind: 'rebooting', param })
    await relink(signal)

    // Confirmed by reading it back, which is the DUT's word rather than ours.
    const read = await readPower(signal)
    if (read === param) return r
    if (read != null) {
      throw new Error(`the DUT reports tone power ${read} after the reset, not ${param}`)
    }
    // The read could not be trusted. Fall back to the reset's own reply: an
    // acknowledged one means the set was persisted. An unanswered one is
    // doubtful, and a power that is only maybe set is not one to measure at.
    if (r.reset?.acknowledged && r.reset.ok) {
      remember(param)
      return r
    }
    throw new Error(`tone power ${param} could not be confirmed after the reset; send again to retry`)
  }), [log, onFrame, readPower, refetchConnection, relink, remember, track])

  const ensurePower = useCallback(async (param: number, signal?: AbortSignal) => {
    // A read is a frame; a reset is a reboot and a reconnect. Asking first
    // turns the first Send after a page load into one frame when the DUT is
    // already on the power asked for.
    const known = powerRef.current ?? await readPower(signal)
    if (known === param) return false
    await setPower(param, signal)
    return true
  }, [readPower, setPower])

  const tone = useCallback((req: BleToneRequest, signal?: AbortSignal) => track(async () => {
    // Our side's estimate of when the tone ends. Taken before the request
    // rather than after the reply: the tone is on air as soon as the frame
    // lands, and an estimate that runs late can only relink a moment early,
    // where one that runs short would try to connect to a DUT still on air.
    const sentAt = Date.now()
    const r = await device.bleTone(req, { signal })
    onFrame?.(r)
    log('DUT', `BLE tone ch ${req.channel} (${channelMhz(req.channel)} MHz) ${req.duration_s} s: ${describe(r)}`)
    refetchConnection()
    if (r.acknowledged && !r.ok) {
      // Refused outright, so nothing is on air -- but the backend released
      // the link regardless, and the DUT has to be fetched back.
      await relink(signal)
      throw new Error(`tone refused (status ${r.status})`)
    }
    const untilMs = sentAt + r.duration_s * 1000
    untilRef.current = untilMs
    setPhase({ kind: 'on-air', channel: req.channel, untilMs })
    if (pillKey) {
      publish(pillKey, {
        kind: 'ble',
        label: 'BLE TX',
        detail: `ch ${req.channel} · ${channelMhz(req.channel)} MHz`,
        pageId: pageId!,
        untilMs,
        note: 'Presumed, not read back: the DUT is off the link while it transmits. '
          + 'Ends on its own when the duration runs out.',
      })
    }
    return r
  }), [log, onFrame, pageId, pillKey, publish, refetchConnection, relink, track])

  const finishTone = useCallback((signal?: AbortSignal) => track(async () => {
    const until = untilRef.current
    if (until == null) return
    const wait = until + TONE_END_GRACE_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
    // Stopped while waiting: the tone is still on air and stays recorded, so
    // the caller can come back to it.
    if (signal?.aborted) return
    untilRef.current = null
    if (pillKey) publish(pillKey, null)
    await relink(signal)
  }), [pillKey, publish, relink, track])

  const onAirUntil = useCallback(() => untilRef.current, [])

  return useMemo(() => ({
    phase, power, readPower, setPower, ensurePower, tone, finishTone, onAirUntil,
    busy: inFlight > 0,
  }), [phase, power, readPower, setPower, ensurePower, tone, finishTone, onAirUntil, inFlight])
}
