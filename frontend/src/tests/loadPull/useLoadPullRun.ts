import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MIN_SETTLE_MS } from '../../lib/settle'
import type { useLog } from '../../context/LogContext'
import type { usePathLoss } from '../../context/PathLossContext'
import type { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { useRunReporter } from '../engine/useRunReporter'
import type { LoadPullResultRow } from '../../store/loadPullPageStore'
import { loadPullApi, type LoadPullRunConfig, type LoadPullRunStatus } from '../../api/loadPull'
import { useAttPrompt } from './AttPrompt'

/**
 * The VNA span around each frequency, as a fraction of it either side, sent
 * with the run (vna_half_span_frac on the backend):
 * 1000 MHz is read on a 995-1005 MHz sweep.
 *
 * The run used to read on whatever span the analyzer was left on, often its
 * full range, where the marker snaps to the nearest of a few hundred points --
 * 900.21 MHz answering for 902.3 on a 201-point 3 GHz sweep. Zoomed, the same
 * points sit tens of kHz apart.
 */
export const VNA_HALF_SPAN_FRAC = 0.005

/** Plan-key prefix of a one-point remeasure run, which the page keeps out of
 *  the table and the run reports. */
export const REMEASURE_KEY = 'remeasure:'

/** Epoch seconds of the run the table holds, for the workbook's Run sheet. */
export type RunTimes = { started_at: number; finished_at: number | null } | null

/**
 * The Load Pull page's side of the backend run: its status, polled; the rows
 * it takes, copied into the table; its attenuator prompts, answered; its end,
 * reported; and Remeasure, a one-point run of its own. Moved out of
 * LoadPullPage as it stood -- same intervals, same conditions, same effects.
 */
export function useLoadPullRun({
  isLte, active, results, setResults, runKey, runTimesRef, log, reporter,
  dutConnected, pathAck, settleMs, settleEffectiveMs, paMode, preflight, lossAt, powerFields,
}: {
  isLte: boolean
  active: boolean | undefined
  results: LoadPullResultRow[]
  setResults: Dispatch<SetStateAction<LoadPullResultRow[]>>
  /** The plan the rows in `results` belong to; see the page's `planKey`. */
  runKey: string | null
  runTimesRef: MutableRefObject<RunTimes>
  log: ReturnType<typeof useLog>['log']
  reporter: ReturnType<typeof useRunReporter>
  dutConnected: boolean
  pathAck: boolean
  settleMs: number | null
  settleEffectiveMs: number
  paMode: number
  preflight: ReturnType<typeof useInstrumentPreflight>
  lossAt: ReturnType<typeof usePathLoss>['lossAt']
  powerFields: Pick<LoadPullRunConfig, 'power_source' | 'spectrum'>
}) {
  // ---------- The run, driven by the backend ----------
  //
  // The loop used to run in this page and died with the tab: twice at ~890
  // points of an attenuator sweep Chrome killed the page mid-run. The backend
  // drives it now (backend/loadpull/runner.py). This page sends the plan,
  // polls the run, copies its rows into the table and answers its attenuator
  // prompts, and a reloaded page picks the run back up on its first poll.
  const radio: 'LoRa' | 'LTE' = isLte ? 'LTE' : 'LoRa'
  const [runStatus, setRunStatus] = useState<LoadPullRunStatus | null>(null)
  /** The backend run, when it is this page's radio. */
  const mine = runStatus?.radio === radio ? runStatus : null
  const running = mine?.state === 'running'
  /** The other Load Pull page's run holds the rig: one run at a time. */
  const otherRunning = runStatus?.state === 'running' && runStatus.radio !== radio
  const attPrompt = useAttPrompt()

  // Poll the run: every second while one is live, every few while this page
  // is on screen (to notice a run started from another tab), and once on
  // mount, so a page reloaded mid-run re-attaches whichever page it lands on.
  const pollMs = running ? 1000 : active ? (otherRunning ? 1000 : 3000) : 0
  const pollStatus = useCallback(async () => {
    try { setRunStatus(await loadPullApi.status()) } catch { /* backend down: keep the last */ }
  }, [])
  // The compiler lint flags the poll's setState; it is the effect as it ran in
  // LoadPullPage (where that lint never reached it), kept so the first poll
  // still lands on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void pollStatus() }, [pollStatus])
  useEffect(() => {
    if (!pollMs) return
    const id = window.setInterval(() => { void pollStatus() }, pollMs)
    return () => window.clearInterval(id)
  }, [pollMs, pollStatus])

  // Copy new rows into the table -- only for the run these rows belong to
  // (same plan key), and appended after the rows a Continue started from.
  const resultsRef = useRef(results)
  useEffect(() => { resultsRef.current = results }, [results])
  const runRows = mine?.rows ?? 0
  const runBase = mine?.start_index ?? 0
  const runPlanKey = mine?.plan_key ?? null
  useEffect(() => {
    if (runPlanKey == null || runPlanKey !== runKey) return
    const have = resultsRef.current.length - runBase
    if (have < 0 || runRows <= have) return
    let stale = false
    loadPullApi.rows(have)
      .then((rows) => {
        if (stale || rows.length === 0) return
        // Appended only onto the table the request was made from, so two
        // overlapping fetches cannot add the same rows twice.
        setResults((prev) => (prev.length === runBase + have ? [...prev, ...rows] : prev))
      })
      .catch(() => { /* the next poll tries again */ })
    return () => { stale = true }
  }, [runRows, runBase, runPlanKey, runKey, setResults])

  // The attenuator prompt: shown once per prompt the run raises, answered back.
  // One answered from another tab disappears from the status, and this copy
  // closes; the stale answer it posts is ignored by the backend.
  const promptSeqRef = useRef(0)
  const prompt = mine?.att_prompt ?? null
  const promptSeq = prompt?.seq ?? 0
  useEffect(() => {
    if (!prompt) {
      if (promptSeqRef.current) attPrompt.cancel()
      return
    }
    if (prompt.seq === promptSeqRef.current) return
    promptSeqRef.current = prompt.seq
    const seq = prompt.seq
    void attPrompt.ask(prompt.db, prompt.cycle, prompt.cycles, prompt.upcoming ?? []).then((a) => {
      if (a.db != null) log('LoadPull', `attenuator set to ${a.db} dB (asked ${prompt.db} dB)`)
      loadPullApi.answerPrompt(seq, a.proceed, a.db)
        .then(setRunStatus)
        .catch((e: Error) => reporter.note(`could not answer the attenuator prompt: ${e.message}`, 'error'))
    })
  }, [promptSeq]) // eslint-disable-line react-hooks/exhaustive-deps

  // Report the end of a run once, whichever way it ended.
  const lastStateRef = useRef<string | null>(null)
  const runState = mine?.state ?? null
  useEffect(() => {
    const prev = lastStateRef.current
    lastStateRef.current = runState
    if (prev !== 'running' || runState === 'running' || !mine) return
    // A remeasure reports in its own dialog, not as a run finishing.
    if (mine.plan_key?.startsWith(REMEASURE_KEY)) return
    if (runTimesRef.current) {
      runTimesRef.current.finished_at = mine.finished_at ?? Date.now() / 1000
    }
    // Points jumped over at the attenuator prompt were never going to be
    // measured, so they are not "of" the total either.
    const summary = {
      completed: mine.rows, total: mine.total - mine.start_index - (mine.skipped ?? 0), errors: mine.errors,
    }
    if (runState === 'done') reporter.finished(summary)
    else if (runState === 'cancelled') {
      reporter.stopped(summary)
      if (mine.error) reporter.note(mine.error, 'warn')
    } else if (runState === 'error') reporter.failed(mine.error ?? 'run failed')
  }, [runState]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A run the backend has just taken, from Run or Continue: the prompt and
   *  end-of-run trackers start over, and the status is the run's. */
  const adoptRun = (status: LoadPullRunStatus) => {
    promptSeqRef.current = 0
    lastStateRef.current = 'running'
    setRunStatus(status)
  }

  // Remeasure: one saved point taken again, from the Smith chart. It runs as
  // a one-point run on the backend, so the move, VNA read, attenuator prompt,
  // Stop and E-STOP all behave as in a run; its own plan key keeps its row
  // out of the table until Use new puts it in place of the old one.
  const [remeasureIdx, setRemeasureIdx] = useState<number | null>(null)
  const [remeasureFresh, setRemeasureFresh] = useState<LoadPullResultRow | null>(null)
  const [remeasureErr, setRemeasureErr] = useState<string | null>(null)
  const [remeasureKey, setRemeasureKey] = useState<string | null>(null)
  const openRemeasure = useCallback((idx: number) => {
    setRemeasureIdx(idx)
    setRemeasureFresh(null)
    setRemeasureErr(null)
  }, [])
  const remeasureRow = remeasureIdx != null ? results[remeasureIdx] ?? null : null
  const remeasuring = running && remeasureKey != null && mine?.plan_key === remeasureKey
  const remeasureBlocked = otherRunning ? `The ${isLte ? 'LoRa' : 'LTE'} Load Pull run is going`
    : running && !remeasuring ? 'A run is going'
      : !dutConnected ? 'Connect the DUT over BLE first'
        : !pathAck ? 'Confirm the RF path first'
          : settleMs == null ? `Set the settle (min ${MIN_SETTLE_MS} ms) first`
            : null
  const remeasureM = useMutation({
    mutationFn: async (idx: number) => {
      const r = results[idx]
      if (!r || r.freq_mhz == null || r.power_dbm_setting == null) throw new Error('this row has no settings to remeasure at')
      if (!(await preflight.run())) throw new Error('cancelled, instruments not ready')
      // The row's own settings, not today's plan: the fields may have
      // changed since it was taken. Settle and PA mode are the page's now.
      const key = `${REMEASURE_KEY}${idx}:${Date.now()}`
      const l = lossAt(r.freq_mhz)
      const status = await loadPullApi.start({
        radio,
        points: [{
          pos: r.pos_pulses, freq_mhz: r.freq_mhz, earfcn: r.earfcn ?? null,
          power_dbm: r.power_dbm_setting, att_db: r.att_db ?? null,
        }],
        start_index: 0,
        settle_ms: settleEffectiveMs,
        ...(isLte ? {} : { pa_mode: paMode }),
        path_loss: [{ freq_mhz: r.freq_mhz, db: l.db, calibrated: l.calibrated }],
        ...powerFields,
        vna_half_span_frac: VNA_HALF_SPAN_FRAC,
        plan_key: key,
      })
      promptSeqRef.current = 0
      lastStateRef.current = 'running'
      setRemeasureKey(key)
      setRemeasureFresh(null)
      setRemeasureErr(null)
      setRunStatus(status)
      log('LoadPull', `remeasuring point #${idx + 1}`)
    },
    onError: (e: Error) => setRemeasureErr(e.message),
  })
  // Its reading, once the one-point run has ended.
  const remeasureState = remeasureKey != null && mine?.plan_key === remeasureKey ? mine.state : null
  useEffect(() => {
    if (!remeasureKey || !remeasureState || remeasureState === 'running') return
    // As it ran in LoadPullPage, where the compiler lint never reached it:
    // the key is dropped the render the one-point run is seen to end.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemeasureKey(null)
    if (remeasureState !== 'done') {
      setRemeasureErr(remeasureState === 'cancelled' ? (mine?.error ?? 'Stopped') : (mine?.error ?? 'Remeasure failed'))
      return
    }
    loadPullApi.rows(0)
      .then((rows) => {
        if (rows[0]) setRemeasureFresh(rows[0])
        else setRemeasureErr('No reading came back')
      })
      .catch((e: Error) => setRemeasureErr(`could not fetch the reading: ${e.message}`))
  }, [remeasureState]) // eslint-disable-line react-hooks/exhaustive-deps
  const takeRemeasured = () => {
    if (remeasureIdx == null || !remeasureFresh) return
    const idx = remeasureIdx
    const fresh = remeasureFresh
    setResults((prev) => prev.map((r, i) => (i === idx ? fresh : r)))
    log('LoadPull', `point #${idx + 1} replaced with its remeasurement`)
    setRemeasureIdx(null)
  }

  return {
    radio, runStatus, setRunStatus, mine, running, otherRunning, attPrompt, adoptRun,
    remeasureIdx, setRemeasureIdx, remeasureFresh, remeasureErr, remeasureRow,
    remeasuring, remeasureBlocked, remeasureM, openRemeasure, takeRemeasured,
  }
}
