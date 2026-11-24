/**
 * The run half of a sweep panel (LoRa CW / modulated, LTE CW / modulated,
 * BLE CW), shared.
 *
 * The run is the backend's: a page's sweep is a one-step Test Sequence
 * (backend/sequence/runner.py), the same code a Test Sequence's step runs.
 * The panel plans it -- its test turns the settings into points
 * (`SweepTest.wire`) -- and this sends it, polls it, copies its rows into the
 * table and reports its end. It used to loop here, in the browser, and a
 * closed tab ended it mid-point with the DUT possibly still keyed; now the
 * run goes on, and the page picks it back up when it is opened again.
 *
 * What stays here is about the page: the results, mirrored into the page
 * snapshot; preflight; Stop; CSV import; the top bar's "Run" pill; and the
 * controls the page header draws the Run / Stop buttons from.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNotify } from '../../context/NotifyContext'
import { usePathLoss } from '../../context/PathLossContext'
import { usePublishLiveOutput } from '../../context/liveOutput'
import { sequenceApi, type SequenceStatus, type SequenceStepIn } from '../../api/sequence'
import { tallyVerdicts } from '../../lib/verdict'
import { useSnapshotState } from '../../store/useSnapshotState'
import type { JudgedRow } from './sweepTest'
import type { Preflight } from './useInstrumentPreflight'
import { useRunReporter } from './useRunReporter'
import { SEQUENCE_STATUS_KEY, useActiveRun, useSequenceStatus } from '../../lib/useRunStatus'

/**
 * What the page header needs to drive the run.
 *
 * The run lives in the panel, but its buttons belong in the header next to
 * the manual tab's Send/Stop, so switching tabs does not move the primary
 * action to a different part of the screen.
 */
export interface AutomationControls {
  running: boolean
  canRun: boolean
  /** "3/40", for the label while running. */
  progress: string
  onRun: () => void
  onStop: () => void
  /** Size of the plan and its time estimate, for the Settings check on the
   *  page's course. */
  totalPoints: number
  plannedMs: number
  /** Frequencies the plan measures at, for the Path loss check. */
  freqsMhz: number[]
}

export type { JudgedRow } from './sweepTest'

export interface AutomationRunOptions<Item, Row extends JudgedRow> {
  /** The reporter's name for this run, e.g. "TX CW automation". */
  reporterName: string
  /** The top bar's "Run" pill: its id, the detail before "3/40", the page.
   *  The id is also the run's step id on the backend, which is how a page
   *  knows a run as its own. */
  live: { id: string; detail: string; pageId: string }
  /** Results as the page snapshot holds them, and how to write them back. */
  loadResults: () => Row[]
  saveResults: (rows: Row[]) => void
  plan: Item[]
  /** The frequency a point measures at, in MHz. */
  freqMhz: (item: Item) => number
  plannedMs: number
  /** Beyond a non-empty plan: every row valid, the power source set, ... */
  ready: boolean
  preflight: Preflight
  /** The run as the backend takes it, without its id: built as Run is
   *  pressed, from the settings then. */
  wire: () => Omit<SequenceStepIn, 'uid'>
  /** A reason the run cannot go at all, checked before preflight. */
  refuse?: () => string | null
  /** Not a page of its own (a Test Sequence step's editor): never runs, and
   *  does not follow the page's run. */
  passive?: boolean
  /** Run-level state the panel resets as a run starts. */
  onStart?: () => void
  /** The run has ended, however -- for the panel to drop what it believed
   *  about the radio (the backend leaves it idle). */
  onEnd?: () => void
  /** Reads an exported CSV back into rows. */
  parseCsv: (text: string) => Row[]
  onControlsChange?: (c: AutomationControls) => void
}

export function useAutomationRun<Item, Row extends JudgedRow>(o: AutomationRunOptions<Item, Row>) {
  const { points: lossPoints, defaultDb } = usePathLoss()
  const notify = useNotify()
  const reporter = useRunReporter(o.reporterName, 'Automation')
  const queryClient = useQueryClient()
  const uid = o.live.id

  const [results, setResults] = useSnapshotState<Row[]>(o.loadResults, o.saveResults)
  // Mirrored so a rows fetch appends to what is there now, not to what was
  // there when the poll that asked for it rendered.
  const resultsRef = useRef<Row[]>(results)
  const replaceResults = useCallback((rows: Row[]) => {
    resultsRef.current = rows
    setResults(rows)
  }, [setResults])

  const status = useSequenceStatus()
  const activeRun = useActiveRun()
  /** The backend's run, when it is this page's. */
  const mine = !o.passive && status?.steps.length === 1 && status.steps[0].uid === uid ? status : null
  const running = mine?.state === 'running'
  /** Another run holds the rig: a Test Sequence, another page's sweep,
   *  Load Pull... The backend would refuse a start (409); this says so first. */
  const otherRun = !running && activeRun ? activeRun : null

  const totalPoints = o.plan.length
  const runTotal = mine?.steps[0].planned ?? totalPoints
  const progressIdx = running && mine?.current ? mine.current.done + 1 : 0
  const completedPoints = Math.max(0, progressIdx - 1)
  // Joined into a key so the list keeps its identity between renders; the
  // controls effect below would otherwise re-publish on every one.
  const planFreqKey = [...new Set(o.plan.map(o.freqMhz))].join(',')
  const planFreqs = useMemo(
    () => (planFreqKey ? planFreqKey.split(',').map(Number) : []),
    [planFreqKey],
  )

  // A "Run" pill in the top bar, so a sweep left running on this page is
  // visible from every other one.
  usePublishLiveOutput(o.live.id, running ? {
    kind: 'run',
    label: 'Run',
    detail: `${o.live.detail} ${progressIdx}/${runTotal}`,
    pageId: o.live.pageId,
  } : null)

  /**
   * The run this page follows, told apart from the next by its start time;
   * the last note it logged; a rows fetch in flight. Null when it follows
   * none: a run that ended before this page mounted is not reported again,
   * and its rows are already in the page's snapshot.
   */
  const watch = useRef<{ startedAt: number | null; noteSeq: number; fetching: boolean } | null>(null)
  const prevState = useRef<string | null>(null)
  const latest = useRef(o)
  useEffect(() => { latest.current = o })

  useEffect(() => {
    if (!mine) return
    const from = prevState.current
    prevState.current = mine.state
    if (mine.state === 'running' && watch.current?.startedAt !== mine.started_at) {
      // Started before this page reloaded, or from another tab: picked up as
      // it is now, its rows fetched from the first.
      watch.current = { startedAt: mine.started_at, noteSeq: mine.notes.at(-1)?.seq ?? 0, fetching: false }
      replaceResults([])
      reporter.started(mine.steps[0].planned)
    }
    const w = watch.current
    if (!w || w.startedAt !== mine.started_at) return

    for (const n of mine.notes) {
      if (n.seq <= w.noteSeq) continue
      w.noteSeq = n.seq
      reporter.note(n.message, n.level)
    }

    const step = mine.steps[0]
    const have = resultsRef.current.length
    if (step.measured > have && !w.fetching) {
      w.fetching = true
      sequenceApi.rows(uid, have)
        .then((more) => {
          if (watch.current !== w || resultsRef.current.length !== have) return
          replaceResults([...resultsRef.current, ...(more as unknown as Row[])])
        })
        .catch(() => { /* the next poll tries again */ })
        .finally(() => { w.fetching = false })
    }

    if (from === 'running' && mine.state !== 'running') {
      latest.current.onEnd?.()
      const summary = {
        completed: step.measured,
        total: step.planned,
        errors: step.errors,
        verdicts: { pass: step.passed, fail: step.failed, total: step.passed + step.failed },
      }
      if (mine.state === 'error') reporter.failed(mine.error ?? step.message ?? 'the run could not go on')
      else if (mine.state === 'cancelled') reporter.stopped(summary)
      else reporter.finished(summary)
    }
  }, [mine, uid, reporter, replaceResults])

  /**
   * Load a results CSV this panel exported.
   *
   * Replaces the table outright rather than appending: the file is a record of
   * one run, and merging it into another run's points would produce a table
   * that never existed.
   */
  const importFile = async (f: File) => {
    try {
      const imported = o.parseCsv(await f.text())
      replaceResults(imported)
      const t = tallyVerdicts(imported)
      const summary = `${imported.length} point${imported.length === 1 ? '' : 's'}`
        + (t.total > 0 ? ` · ${t.pass}/${t.total} within limits` : '')
      reporter.note(`Imported ${summary} from ${f.name}`)
      notify.success(`Imported ${summary}`)
    } catch (e) {
      const message = (e as Error).message
      reporter.note(`Import failed: ${message}`, 'error')
      notify.error(message, { title: 'Import failed' })
    }
  }

  const publish = useCallback((s: SequenceStatus) => {
    queryClient.setQueryData(SEQUENCE_STATUS_KEY, s)
    void queryClient.invalidateQueries({ queryKey: ['runs', 'active'] })
  }, [queryClient])

  const runM = useMutation({
    mutationFn: async () => {
      const L = latest.current
      const refusal = L.passive ? 'these are a Test Sequence step’s settings' : L.refuse?.()
      if (refusal) {
        reporter.note(refusal, 'warn')
        return
      }
      if (!(await L.preflight.run())) {
        reporter.note('cancelled — instruments not ready', 'warn')
        return
      }
      const step: SequenceStepIn = { ...L.wire(), uid }
      // The bench is taken to be cabled for this page's test: a page's own
      // run never stopped to ask, and the operator is at it.
      const st = await sequenceApi.start({
        steps: [step],
        bench: step.setup,
        path_loss: { default_db: defaultDb, points: lossPoints.map((p) => ({ freq_mhz: p.freqMhz, db: p.db })) },
      })
      L.onStart?.()
      watch.current = { startedAt: st.started_at, noteSeq: 0, fetching: false }
      prevState.current = null
      replaceResults([])
      reporter.started(step.points.length)
      publish(st)
    },
    // Refused by the backend (another run holds the rig, a bad point) or the
    // backend not there: nothing ran.
    onError: (e: Error) => reporter.note(e.message, 'warn'),
  })

  // One identity across renders: the controls effect below publishes it
  // upward, and a fresh callback every render would re-publish -- and
  // re-render the page -- every render.
  const onStop = useCallback(() => {
    sequenceApi.cancel()
      .then(publish)
      .catch((e: Error) => reporter.note(`stop failed: ${e.message}`, 'error'))
  }, [publish, reporter])

  const runMutate = runM.mutate
  const onRun = useCallback(() => { runMutate() }, [runMutate])

  // Publish the run state upward so the header can render the buttons. Only
  // primitives and stable callbacks are in the dependency list, so this settles
  // after one pass rather than looping on a fresh object each render.
  const { onControlsChange, ready, plannedMs } = o
  useEffect(() => {
    onControlsChange?.({
      running,
      canRun: totalPoints > 0 && ready && !otherRun,
      progress: `${progressIdx}/${runTotal}`,
      onRun,
      onStop,
      totalPoints,
      plannedMs,
      freqsMhz: planFreqs,
    })
  }, [running, totalPoints, runTotal, ready, otherRun, progressIdx, onRun, onStop, onControlsChange, plannedMs, planFreqs])

  return {
    reporter,
    results,
    /** Replace the table (and the ref the fetches append to). */
    replaceResults,
    running,
    progressIdx,
    completedPoints,
    totalPoints: running ? runTotal : totalPoints,
    /** The run holding the rig when it is not this page's, for the panel to
     *  say why Run is off. */
    otherRun,
    importFile,
  }
}
