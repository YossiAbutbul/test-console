/**
 * The run half of a sweep panel (LoRa CW / modulated, LTE CW / modulated,
 * BLE CW), shared.
 *
 * The five panels were one file copied five times: about 55 % of their lines
 * appeared in every copy, and a fix to one (the uncalibrated-path-loss note,
 * the verdict summary, the stale-results reset) had to be carried to the
 * others by hand. What differs between them -- the row schema, the command a
 * point sends, what readies the radio -- stays in each panel and comes in
 * through the options. What is the same lives here:
 *
 *  - the results, mirrored into the page snapshot and into a ref so the
 *    end-of-run summary can count them without waiting for a render;
 *  - preflight, abort, `runSequence`, and the notes a run ends with;
 *  - Stop, CSV import, the top bar's "Run" pill, and the controls the page
 *    header draws the Run / Stop buttons from.
 *
 * Pinned by each panel's characterisation test (`*AutomationPanel.test.tsx`),
 * which snapshots what a run sends the DUT and the instruments.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNotify } from '../../context/NotifyContext'
import { usePathLoss } from '../../context/PathLossContext'
import { usePublishLiveOutput } from '../../context/liveOutput'
import { claimRun } from '../../lib/runLock'
import { tallyVerdicts } from '../../lib/verdict'
import { useSnapshotState } from '../../store/useSnapshotState'
import { runSweep } from './runSweep'
import type { Preflight } from './useInstrumentPreflight'
import { useRunReporter } from './useRunReporter'

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

export type { JudgedRow, PointContext, RunContext, RunSteps } from './runSweep'
import type { JudgedRow, RunSteps } from './runSweep'

export interface AutomationRunOptions<Item, Row extends JudgedRow> {
  /** The reporter's name for this run, e.g. "TX CW automation". */
  reporterName: string
  /** The top bar's "Run" pill: its id, the detail before "3/40", the page. */
  live: { id: string; detail: string; pageId: string }
  /** Results as the page snapshot holds them, and how to write them back. */
  loadResults: () => Row[]
  saveResults: (rows: Row[]) => void
  plan: Item[]
  /** The frequency a point measures at, in MHz. */
  freqMhz: (item: Item) => number
  /** How the uncalibrated-path-loss note lists a frequency. */
  formatFreq?: (mhz: number) => string
  plannedMs: number
  /** Beyond a non-empty plan: every row valid, the power source set, ... */
  ready: boolean
  preflight: Preflight
  blankRow: (item: Item) => Row
  /** Builds the run's steps (`measure`, `before`, `after`, ...), once per
   *  run, after `onStart`. See `RunSteps`. */
  createRun: () => RunSteps<Item, Row>
  stepTimeoutMs: number
  /** A reason the run cannot go at all, checked before preflight. */
  refuse?: () => string | null
  /** Run-level state the panel resets as a run starts. */
  onStart?: () => void
  /** Reads an exported CSV back into rows. */
  parseCsv: (text: string) => Row[]
  onControlsChange?: (c: AutomationControls) => void
}

export function useAutomationRun<Item, Row extends JudgedRow>(o: AutomationRunOptions<Item, Row>) {
  const { defaultDb } = usePathLoss()
  const notify = useNotify()
  const reporter = useRunReporter(o.reporterName, 'Automation')

  const [results, setResults] = useSnapshotState<Row[]>(o.loadResults, o.saveResults)
  // Mirrored so the end-of-run summary can count verdicts without waiting for
  // a re-render to publish the last point.
  const resultsRef = useRef<Row[]>(results)
  const [running, setRunning] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  // Replaced per run. Stop aborts it, which cancels the in-flight request and
  // wakes the settle delay immediately.
  const abortRef = useRef(new AbortController())

  const replaceResults = useCallback((rows: Row[]) => {
    resultsRef.current = rows
    setResults(rows)
  }, [setResults])

  const totalPoints = o.plan.length
  // runSequence reports the 1-based point in hand, so the points already
  // finished are one fewer.
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
    detail: `${o.live.detail} ${progressIdx}/${totalPoints}`,
    pageId: o.live.pageId,
  } : null)

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

  // The run in flight's own steps, for Stop.
  const stepsRef = useRef<RunSteps<Item, Row> | null>(null)

  const runM = useMutation({
    mutationFn: async () => {
      const refusal = o.refuse?.()
      if (refusal) {
        reporter.note(refusal, 'warn')
        return
      }
      if (!(await o.preflight.run())) {
        reporter.note('cancelled — instruments not ready', 'warn')
        return
      }
      const release = claimRun(o.live.id, o.live.detail)
      if (typeof release === 'string') {
        reporter.note(release, 'warn')
        return
      }
      const abort = new AbortController()
      abortRef.current = abort
      o.onStart?.()
      const steps = o.createRun()
      stepsRef.current = steps
      setRunning(true)
      replaceResults([])
      setProgressIdx(0)
      try {
        await runSweep<Item, Row>({
          plan: o.plan,
          steps,
          blankRow: o.blankRow,
          abort,
          reporter,
          stepTimeoutMs: o.stepTimeoutMs,
          freqMhz: o.freqMhz,
          formatFreq: o.formatFreq,
          defaultDb,
          onRows: replaceResults,
          onProgress: setProgressIdx,
          preview: (row) => setResults([...resultsRef.current, { ...row }]),
        })
      } finally {
        release()
        setRunning(false)
        // A row shown early (`preview`) whose run was stopped before it
        // finished is not part of the results; put the table back to what was
        // recorded.
        setResults(resultsRef.current)
      }
    },
    onError: (e: Error) => reporter.failed(e.message),
  })

  // One identity across renders: the controls effect below publishes it
  // upward, and a fresh callback every render would re-publish -- and
  // re-render the page -- every render.
  const onStop = useCallback(() => {
    // Aborting cancels the in-flight request and wakes the settle delay, so
    // the loop notices immediately rather than at the end of the point.
    abortRef.current.abort()
    stepsRef.current?.onStop?.(reporter)
  }, [reporter])

  const runMutate = runM.mutate
  const onRun = useCallback(() => { runMutate() }, [runMutate])

  // Publish the run state upward so the header can render the buttons. Only
  // primitives and stable callbacks are in the dependency list, so this settles
  // after one pass rather than looping on a fresh object each render.
  const { onControlsChange, ready, plannedMs } = o
  useEffect(() => {
    onControlsChange?.({
      running,
      canRun: totalPoints > 0 && ready,
      progress: `${progressIdx}/${totalPoints}`,
      onRun,
      onStop,
      totalPoints,
      plannedMs,
      freqsMhz: planFreqs,
    })
  }, [running, totalPoints, ready, progressIdx, onRun, onStop, onControlsChange, plannedMs, planFreqs])

  return {
    reporter,
    results,
    /** Replace the table (and the ref the summary reads). */
    replaceResults,
    running,
    progressIdx,
    completedPoints,
    totalPoints,
    importFile,
  }
}
