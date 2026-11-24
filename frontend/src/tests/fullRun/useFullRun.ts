/**
 * The Test Sequence's run half: preflight, the sequence, the re-cable prompt,
 * Stop, and the top bar's pill. The page owns the plan; this owns a run of it.
 *
 * Each step runs through `runSweep` -- the code its own page's panel runs --
 * with that step's settings. The radios a step talks through (the BLE link,
 * the LTE modem) are held here, one of each, so consecutive steps share them
 * the way the two tabs of a test page do.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathLoss } from '../../context/PathLossContext'
import { usePublishLiveOutput } from '../../context/liveOutput'
import type { InstrumentId } from '../../context/InstrumentsContext'
import { device } from '../../api/device'
import { claimRun } from '../../lib/runLock'
import { tallyVerdicts } from '../../lib/verdict'
import type { FullRunStep, StepResult } from '../../store/fullRunStore'
import { useBleLink } from '../ble/useBleLink'
import { useLteModem } from '../lte/useLteModem'
import { runSweep, type JudgedRow } from '../engine/runSweep'
import type { RunReporter } from '../engine/useRunReporter'
import { useRunReporter } from '../engine/useRunReporter'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import type { SetupId } from '../engine/sweepTest'
import type { Protocol } from '../types'
import { suiteTest } from './catalog'
import { runSuite, stepVerdict, type SuiteState } from './runSuite'

export const FULL_RUN_ID = 'full-run'

/** A step as the sequence sees it: the plan's step and the setup it needs. */
type Step = FullRunStep & { setup: SetupId }

/** The open re-cable prompt. */
export interface RecablePrompt {
  /** The step it is for, and its place among the steps that run. */
  uid: string
  index: number
  from: SetupId | null
  to: SetupId
  answer: (ok: boolean) => void
}

/** Where the step in flight is. */
export interface LiveStep {
  uid: string
  /** Its place among the steps that run (switched-off ones are not). */
  index: number
  /** Points finished, of planned. */
  done: number
  total: number
}

interface Options {
  steps: FullRunStep[]
  bench: SetupId | null
  onBench: (s: SetupId) => void
  /** A step's result, as it lands -- and its rows while it is running. */
  onResult: (uid: string, r: StepResult) => void
  /** Called as a run starts, to clear the last run's results. */
  onStart: () => void
}

/** A reporter that writes a step's lines into the sequence's log, prefixed,
 *  and leaves the toasts and the end-of-run modal to the run as a whole -- a
 *  seven-step run would otherwise pop seven completion modals. */
function stepReporter(run: RunReporter, prefix: string): RunReporter {
  return {
    started: (total) => run.note(`${prefix} — started${total == null ? '' : `, ${total} points`}`),
    finished: (s) => run.note(
      `${prefix} — finished, ${s.completed}/${s.total} points`
      + (s.errors ? `, ${s.errors} errors` : ''),
      s.errors ? 'warn' : 'info',
    ),
    stopped: (s) => run.note(`${prefix} — stopped after ${s.completed}/${s.total} points`, 'warn'),
    failed: (m) => run.note(`${prefix} — ${m}`, 'error'),
    note: (m, level) => run.note(`${prefix} · ${m}`, level),
  }
}

export function useFullRun({ steps, bench, onBench, onResult, onStart }: Options) {
  const { lossAt, defaultDb } = usePathLoss()
  const reporter = useRunReporter('Test Sequence', 'Automation', 'steps')
  const link = useBleLink({ pageId: FULL_RUN_ID })
  const modem = useLteModem({ pageId: FULL_RUN_ID })

  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<LiveStep | null>(null)
  const [prompt, setPrompt] = useState<RecablePrompt | null>(null)
  const abortRef = useRef(new AbortController())
  const stepStopRef = useRef<((r: RunReporter) => void) | null>(null)

  // Every instrument any step reads, connected once before the first step
  // rather than step by step: a preflight dialog half-way through an
  // unattended run would hold the bench until someone came back.
  const instruments = useMemo(() => {
    const set = new Set<InstrumentId>()
    for (const s of steps) {
      if (s.enabled === false) continue
      const t = suiteTest(s.testId)
      if (t) for (const id of t.instruments(t.resolve(s.settings))) set.add(id)
    }
    return [...set]
  }, [steps])
  const preflight = useInstrumentPreflight(instruments)

  const runCount = steps.filter((s) => s.enabled !== false).length
  usePublishLiveOutput(`run:${FULL_RUN_ID}`, running && live ? {
    kind: 'run',
    label: 'Run',
    detail: `Sequence ${live.index + 1}/${runCount}`,
    pageId: FULL_RUN_ID,
  } : null)

  // The latest of everything the run reads, so `start` keeps one identity.
  const latest = useRef({ steps, bench, onBench, onResult, onStart, lossAt, defaultDb, link, modem, preflight })
  useEffect(() => {
    latest.current = { steps, bench, onBench, onResult, onStart, lossAt, defaultDb, link, modem, preflight }
  })

  const start = useCallback(async () => {
    const L = latest.current
    const plan: Step[] = []
    // Steps switched off stay in the plan but are not run, and do not count
    // towards a re-cable: the bench moves only for what actually runs.
    for (const s of L.steps.filter((x) => x.enabled !== false)) {
      const t = suiteTest(s.testId)
      if (!t) {
        reporter.note(`step ${plan.length + 1}: unknown test "${s.testId}"`, 'error')
        return
      }
      plan.push({ ...s, setup: t.setup })
    }
    if (plan.length === 0) return
    if (!(await L.preflight.run())) {
      reporter.note('cancelled — instruments not ready', 'warn')
      return
    }
    const release = claimRun(`run:${FULL_RUN_ID}`, 'Test Sequence')
    if (typeof release === 'string') {
      reporter.note(release, 'warn')
      return
    }
    const abort = new AbortController()
    abortRef.current = abort
    L.onStart()
    setRunning(true)
    reporter.started(plan.length)
    // Each step's rows as they land, for its result at the end.
    const rowsBy = new Map<string, JudgedRow[]>()
    // The protocols whose steps started, for leaving the rig idle after.
    const used = new Set<Protocol>()
    let idled = false
    /**
     * Leave the rig idle once the sequence is over, however it ended.
     *
     * Each step already tidies up after itself, but to its page's rules: the
     * LTE run leaves the modem powered, as the LTE pages do, because the
     * operator is still at that page and the key is theirs. A sequence's end
     * is the end of the bench's use, so everything it started is switched
     * off. Each part on its own: one that fails does not keep the others on.
     */
    const leaveIdle = async () => {
      if (idled) return
      idled = true
      const cur = latest.current
      const done: string[] = []
      if (used.has('LoRa')) {
        try { await device.stop(); done.push('LoRa TX off') } catch (e) {
          reporter.note(`LoRa stop at the end failed: ${(e as Error).message}`, 'error')
        }
      }
      if (used.has('LTE')) {
        try {
          const live = cur.modem.getRunning()
          if (live) { try { await live.abort() } catch { /* the power-off ends it too */ } }
          await cur.modem.powerOff()
          done.push('LTE modem off')
        } catch (e) {
          reporter.note(`LTE modem off at the end failed: ${(e as Error).message}`, 'error')
        }
      }
      if (used.has('BLE')) {
        try { await cur.link.finishTone(); done.push('BLE back on the link') } catch (e) {
          reporter.note(`BLE did not come back at the end: ${(e as Error).message}`, 'error')
        }
      }
      if (done.length) reporter.note(`rig left idle: ${done.join(', ')}`)
    }
    try {
      const result = await runSuite<Step>({
        steps: plan,
        bench: L.bench,
        abort,
        onBench: (b) => latest.current.onBench(b),
        onState: (st: SuiteState) => {
          if (st.kind !== 'recable') setPrompt(null)
        },
        confirmSetup: (from, to, step, index, signal) => new Promise<boolean>((resolve) => {
          const answer = (ok: boolean) => { setPrompt(null); resolve(ok) }
          signal.addEventListener('abort', () => answer(false), { once: true })
          setPrompt({ uid: step.uid, index, from, to, answer })
        }),
        runStep: async (step, index, signal) => {
          const t = suiteTest(step.testId)!
          used.add(t.protocol)
          const r = t.resolve(step.settings)
          const items = t.plan(r)
          const problem = t.problem(r)
          if (problem) throw new Error(`step ${index + 1} (${t.label}): ${problem}`)
          const cur = latest.current
          const run = t.createRun(r, { lossAt: cur.lossAt, link: cur.link, modem: cur.modem })
          stepStopRef.current = run.onStop ?? null
          const sr = stepReporter(reporter, `step ${index + 1} · ${step.name?.trim() || t.label}`)
          setLive({ uid: step.uid, index, done: 0, total: items.length })
          let rows: JudgedRow[]
          const publish = (rs: JudgedRow[]) => {
            rowsBy.set(step.uid, rs)
            const tl = tallyVerdicts(rs)
            const errors = rs.filter((x) => !!x.error).length
            latest.current.onResult(step.uid, {
              outcome: {
                verdict: stepVerdict({ ...tl, errors, measured: rs.length }),
                pass: tl.pass, fail: tl.fail, measured: rs.length, planned: items.length, errors, ms: 0,
              },
              rows: rs,
            })
          }
          try {
            rows = await runSweep({
              plan: items,
              steps: run,
              blankRow: t.blankRow,
              abort,
              reporter: sr,
              stepTimeoutMs: t.stepTimeoutMs(r),
              freqMhz: t.freqMhz,
              formatFreq: t.formatFreq,
              defaultDb: cur.defaultDb,
              onRows: publish,
              onProgress: (n) => setLive({ uid: step.uid, index, done: Math.max(0, n - 1), total: items.length }),
            })
          } finally {
            stepStopRef.current = null
          }
          if (signal.aborted) sr.note('stopped')
          const tl = tallyVerdicts(rows)
          const errors = rows.filter((x) => !!x.error).length
          return {
            verdict: stepVerdict({ ...tl, errors, measured: rows.length }),
            pass: tl.pass, fail: tl.fail, measured: rows.length, planned: items.length, errors,
          }
        },
      })
      await leaveIdle()
      result.outcomes.forEach((o, i) => {
        if (o.verdict === 'not-run') return
        const uid = plan[i].uid
        latest.current.onResult(uid, { outcome: o, rows: rowsBy.get(uid) ?? [] })
      })
      const ran = result.outcomes.filter((o) => o.verdict !== 'not-run')
      const judged = ran.filter((o) => o.verdict === 'pass' || o.verdict === 'fail')
      const summary = {
        completed: ran.length,
        total: plan.length,
        errors: ran.filter((o) => o.verdict === 'error').length,
        verdicts: {
          pass: judged.filter((o) => o.verdict === 'pass').length,
          fail: judged.filter((o) => o.verdict === 'fail').length,
          total: judged.length,
        },
      }
      if (result.ended === 'error') {
        const failed = result.outcomes.find((o) => o.message)
        reporter.failed(failed?.message ?? 'a step could not go on')
      } else if (result.ended) {
        if (result.ended === 'declined') reporter.note('stopped at a re-cable prompt', 'warn')
        reporter.stopped(summary)
      } else {
        reporter.finished(summary)
      }
    } catch (e) {
      await leaveIdle()
      reporter.failed((e as Error).message)
    } finally {
      release()
      setPrompt(null)
      setLive(null)
      setRunning(false)
    }
  }, [reporter])

  const stop = useCallback(() => {
    abortRef.current.abort()
    stepStopRef.current?.(reporter)
  }, [reporter])

  return {
    running,
    live,
    prompt,
    start,
    stop,
    link,
    modem,
    preflightDialog: preflight.dialog,
  }
}
