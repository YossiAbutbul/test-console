/**
 * The Test Sequence's run half: preflight, the start, the re-cable prompt,
 * Stop, and the top bar's pill. The page owns the plan; this owns a run of it.
 *
 * The run itself is the backend's (backend/sequence/runner.py): this sends
 * each step's points as its test plans them (`SweepTest.wire`), then polls.
 * A closed or reloaded tab does not end it -- the next mount polls once,
 * finds it running and picks it back up, rows and prompt included -- and the
 * backend refuses any other run, or a manual DUT command, while it goes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathLoss } from '../../context/PathLossContext'
import { POLL_IDLE_MS, POLL_RUNNING_MS } from '../../lib/useRunStatus'
import { usePublishLiveOutput } from '../../context/liveOutput'
import type { InstrumentId } from '../../context/InstrumentsContext'
import {
  sequenceApi, type SequenceStatus, type SequenceStepIn, type SequenceStepOutcome,
} from '../../api/sequence'
import type { FullRunStep, StepResult } from '../../store/fullRunStore'
import { useBleLink } from '../ble/useBleLink'
import { useLteModem } from '../lte/useLteModem'
import { useRunReporter } from '../engine/useRunReporter'
import { useInstrumentPreflight } from '../engine/useInstrumentPreflight'
import { wireStep, type SetupId } from '../engine/sweepTest'
import { suiteTest } from './catalog'
import { stepVerdict, type StepOutcome } from './suiteVerdict'

export const FULL_RUN_ID = 'full-run'

/** The step id a sweep page's own run goes by (`useAutomationRun`'s live id). */
const PAGE_RUN_PREFIX = 'run:'


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
  /** Called as a run starts (or is picked back up), to clear the last run's results. */
  onStart: () => void
}

/** A step's outcome as the page's tables read it. A step still running is
 *  judged on what it has so far. */
function outcomeOf(o: SequenceStepOutcome): StepOutcome {
  const tally = { pass: o.passed, fail: o.failed, errors: o.errors, measured: o.measured }
  return {
    verdict: o.verdict === 'running' ? stepVerdict(tally) : o.verdict,
    pass: o.passed, fail: o.failed, measured: o.measured, planned: o.planned, errors: o.errors, ms: o.ms,
    ...(o.message ? { message: o.message } : {}),
  }
}

export function useFullRun({ steps, bench, onBench, onResult, onStart }: Options) {
  const { points: lossPoints, defaultDb } = usePathLoss()
  const reporter = useRunReporter('Test Sequence', 'Automation', 'steps')
  // For the steps' editors, which send manual commands through them; a run
  // does not -- the backend drives the radios itself.
  const link = useBleLink({ pageId: FULL_RUN_ID })
  const modem = useLteModem({ pageId: FULL_RUN_ID })

  const [polled, setStatus] = useState<SequenceStatus | null>(null)
  // A sweep page's run is a one-step sequence on the same runner, its step
  // named after the page ("run:power"): that one is the page's to show, not
  // this one's -- here it only holds the rig, and the Run key says so.
  const status = polled && !polled.steps.some((o) => o.uid.startsWith(PAGE_RUN_PREFIX)) ? polled : null
  const running = status?.state === 'running'

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

  const live: LiveStep | null = running && status?.current ? { ...status.current } : null
  const runCount = status?.steps.length ?? 0
  usePublishLiveOutput(`run:${FULL_RUN_ID}`, running && live ? {
    kind: 'run',
    label: 'Run',
    detail: `Sequence ${live.index + 1}/${runCount}`,
    pageId: FULL_RUN_ID,
  } : null)

  // The latest of everything the run reads, so the callbacks keep one identity.
  const latest = useRef({ steps, bench, onBench, onResult, onStart, lossPoints, defaultDb, preflight })
  useEffect(() => {
    latest.current = { steps, bench, onBench, onResult, onStart, lossPoints, defaultDb, preflight }
  })

  /**
   * What this page has taken from the run it watches: each step's rows, the
   * last note it logged, the last outcome it published. Null when it watches
   * none -- a run that ended before this page mounted is not reported again.
   */
  const watch = useRef<{
    /** The run's start, which tells one run from the next. */
    startedAt: number | null
    rows: Map<string, unknown[]>
    fetching: Set<string>
    published: Map<string, string>
    noteSeq: number
  } | null>(null)
  const prevState = useRef<string | null>(null)

  const watchRun = (startedAt: number | null, noteSeq: number) => {
    watch.current = { startedAt, rows: new Map(), fetching: new Set(), published: new Map(), noteSeq }
  }

  const poll = useCallback(async () => {
    try { setStatus(await sequenceApi.status()) } catch { /* backend down: keep the last */ }
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first poll lands on mount, to re-attach a run
  useEffect(() => { void poll() }, [poll])
  useEffect(() => {
    const id = window.setInterval(() => { void poll() }, running ? POLL_RUNNING_MS : POLL_IDLE_MS)
    return () => window.clearInterval(id)
  }, [running, poll])

  // Each status: adopt a run found going, log its new notes, copy its rows
  // into the steps' results, follow the bench, and report its end once.
  useEffect(() => {
    if (!status) return
    const L = latest.current
    const from = prevState.current
    prevState.current = status.state

    if (status.state === 'running' && watch.current?.startedAt !== status.started_at) {
      // Started from another tab, or before this one reloaded: picked up as
      // it is now, without replaying the notes that tab already logged.
      watchRun(status.started_at, status.notes.at(-1)?.seq ?? 0)
      L.onStart()
      reporter.started(status.steps.length)
    }
    const w = watch.current
    if (!w || w.startedAt !== status.started_at) return

    for (const n of status.notes) {
      if (n.seq <= w.noteSeq) continue
      w.noteSeq = n.seq
      reporter.note(n.message, n.level)
    }
    if (status.bench && status.bench !== L.bench) L.onBench(status.bench)

    for (const o of status.steps) {
      if (o.verdict === 'not-run') continue
      const have = w.rows.get(o.uid) ?? []
      const publish = (rows: unknown[]) => {
        const key = `${o.verdict}:${o.measured}:${o.ms}:${rows.length}`
        if (w.published.get(o.uid) === key) return
        w.published.set(o.uid, key)
        latest.current.onResult(o.uid, { outcome: outcomeOf(o), rows })
      }
      if (o.measured <= have.length) { publish(have); continue }
      if (w.fetching.has(o.uid)) continue
      w.fetching.add(o.uid)
      sequenceApi.rows(o.uid, have.length)
        .then((more) => {
          if (watch.current !== w) return
          const rows = [...(w.rows.get(o.uid) ?? []), ...more]
          w.rows.set(o.uid, rows)
          publish(rows)
        })
        .catch(() => { /* the next poll tries again */ })
        .finally(() => w.fetching.delete(o.uid))
    }

    if (from === 'running' && status.state !== 'running') {
      const ran = status.steps.filter((o) => o.verdict !== 'not-run')
      const judged = ran.filter((o) => o.verdict === 'pass' || o.verdict === 'fail')
      const summary = {
        completed: ran.length,
        total: status.steps.length,
        errors: ran.filter((o) => o.verdict === 'error').length,
        verdicts: {
          pass: judged.filter((o) => o.verdict === 'pass').length,
          fail: judged.filter((o) => o.verdict === 'fail').length,
          total: judged.length,
        },
      }
      if (status.state === 'error') reporter.failed(status.error ?? 'a step could not go on')
      else if (status.state === 'cancelled') reporter.stopped(summary)
      else reporter.finished(summary)
    }
  }, [status, reporter])

  const start = useCallback(async () => {
    const L = latest.current
    const out: SequenceStepIn[] = []
    // Steps switched off stay in the plan but are not run, and do not count
    // towards a re-cable: the bench moves only for what actually runs.
    for (const s of L.steps.filter((x) => x.enabled !== false)) {
      const n = out.length + 1
      const t = suiteTest(s.testId)
      if (!t) {
        reporter.note(`step ${n}: unknown test "${s.testId}"`, 'error')
        return
      }
      const r = t.resolve(s.settings)
      const problem = t.problem(r)
      if (problem) {
        reporter.note(`step ${n} (${t.label}): ${problem}`, 'error')
        return
      }
      out.push({ uid: s.uid, ...wireStep(t, r, s.name?.trim() || t.label) })
    }
    if (out.length === 0) return
    if (!(await L.preflight.run())) {
      reporter.note('cancelled — instruments not ready', 'warn')
      return
    }
    let st: SequenceStatus
    try {
      st = await sequenceApi.start({
        steps: out,
        bench: L.bench,
        path_loss: {
          default_db: L.defaultDb,
          points: L.lossPoints.map((p) => ({ freq_mhz: p.freqMhz, db: p.db })),
        },
      })
    } catch (e) {
      // Another run holds the rig (409), or a step's points were refused.
      reporter.note((e as Error).message, 'warn')
      return
    }
    watchRun(st.started_at, 0)
    L.onStart()
    reporter.started(out.length)
    prevState.current = null
    setStatus(st)
  }, [reporter])

  const stop = useCallback(() => {
    sequenceApi.cancel()
      .then(setStatus)
      .catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
  }, [reporter])

  const p = running ? status?.prompt ?? null : null
  const prompt: RecablePrompt | null = useMemo(() => p && {
    uid: p.step_uid,
    index: Math.max(0, status?.steps.findIndex((o) => o.uid === p.step_uid) ?? 0),
    from: p.from_setup,
    to: p.to_setup,
    answer: (ok: boolean) => {
      sequenceApi.recable(p.seq, ok)
        .then(setStatus)
        .catch((e: Error) => reporter.note(`could not answer the re-cable prompt: ${e.message}`, 'error'))
    },
  }, [p, status?.steps, reporter])

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
